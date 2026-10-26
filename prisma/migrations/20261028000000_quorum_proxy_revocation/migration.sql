-- Owner decision of 2026-10-26, D-55: an owner revokes a proxy they granted (or the board at the desk revokes it for
-- them) before the meeting closes. The revocation is a NEW append-only row; the Proxy row is never updated. The
-- generated half mirrors prisma/schema/quorum.prisma (CI's `prisma migrate diff`); the hand-written half adds the
-- instant CHECK, the append-only trigger, the guard (same meeting, meeting open, not already revoked by the import),
-- the archived-org door for the new table, and quorum_app's grants.

-- CreateEnum
CREATE TYPE "RevocationChannel" AS ENUM ('GRANTOR', 'DESK');

-- CreateTable
CREATE TABLE "ProxyRevocation" (
    "id" UUID NOT NULL,
    "proxyId" UUID NOT NULL,
    "meetingId" UUID NOT NULL,
    "revokedAt" CHAR(19) NOT NULL,
    "channel" "RevocationChannel" NOT NULL,
    "byUserId" UUID,
    "reason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProxyRevocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProxyRevocation_proxyId_key" ON "ProxyRevocation"("proxyId");

-- AddForeignKey
ALTER TABLE "ProxyRevocation" ADD CONSTRAINT "ProxyRevocation_proxyId_fkey" FOREIGN KEY ("proxyId") REFERENCES "Proxy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProxyRevocation" ADD CONSTRAINT "ProxyRevocation_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===================================================================================================================
-- Hand-written half.
-- ===================================================================================================================

-- D-8: the revocation instant is on the meeting axis, the engine's regex.
ALTER TABLE "ProxyRevocation" ADD CONSTRAINT "ProxyRevocation_revokedAt_instant" CHECK ("revokedAt" ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$');
-- D-55: a desk revocation says why (the grantor is not the one at the keyboard).
ALTER TABLE "ProxyRevocation" ADD CONSTRAINT "ProxyRevocation_desk_has_reason" CHECK ("channel" <> 'DESK' OR btrim("reason") <> '');

-- D-19: append-only.
CREATE TRIGGER "ProxyRevocation_append_only" BEFORE UPDATE OR DELETE ON "ProxyRevocation" FOR EACH ROW EXECUTE FUNCTION quorum_append_only();

-- D-55: a revocation names a proxy of its own meeting, the meeting is still open (D-34's door, same words so the
-- mapper reads it as MeetingClosed), and the proxy was not already revoked by the import (Proxy.revokedAt). The
-- unique index on proxyId is the "once" for revocations written here.
CREATE FUNCTION quorum_proxy_revocation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_meeting UUID;
  v_revoked CHAR(19);
BEGIN
  SELECT p."meetingId", p."revokedAt" INTO v_meeting, v_revoked FROM "Proxy" p WHERE p.id = NEW."proxyId";
  IF v_meeting IS DISTINCT FROM NEW."meetingId" THEN
    RAISE EXCEPTION 'proxy % belongs to meeting %, not % (D-55)', NEW."proxyId", v_meeting, NEW."meetingId";
  END IF;
  IF EXISTS (SELECT 1 FROM "Meeting" m WHERE m.id = NEW."meetingId" AND m."closedAt" IS NOT NULL) THEN
    RAISE EXCEPTION 'meeting % is closed; no proxy can be revoked (D-55)', NEW."meetingId";
  END IF;
  IF v_revoked IS NOT NULL THEN
    RAISE EXCEPTION 'proxy % was already revoked at % (D-55)', NEW."proxyId", v_revoked;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ProxyRevocation_guard" BEFORE INSERT ON "ProxyRevocation" FOR EACH ROW EXECUTE FUNCTION quorum_proxy_revocation_guard();

-- D-43's second door, extended to the new table (CREATE OR REPLACE keeps every existing trigger pointing at it).
CREATE OR REPLACE FUNCTION quorum_refuse_archived_org() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_org UUID;
BEGIN
  IF TG_TABLE_NAME IN ('Unit', 'Owner', 'Meeting', 'DuesRun', 'Violation') THEN
    v_org := NEW."orgId";
  ELSIF TG_TABLE_NAME IN ('UnitShare', 'Ownership', 'LedgerEntry') THEN
    SELECT u."orgId" INTO v_org FROM "Unit" u WHERE u.id = NEW."unitId";
  ELSIF TG_TABLE_NAME IN ('Proxy', 'Ballot', 'ProxyRevocation') THEN
    SELECT m."orgId" INTO v_org FROM "Meeting" m WHERE m.id = NEW."meetingId";
  ELSIF TG_TABLE_NAME = 'ViolationEvent' THEN
    SELECT v."orgId" INTO v_org FROM "Violation" v WHERE v.id = NEW."violationId";
  ELSE
    RAISE EXCEPTION 'quorum_refuse_archived_org does not know table %', TG_TABLE_NAME;
  END IF;
  IF v_org IS NOT NULL AND EXISTS (SELECT 1 FROM "OrgArchive" a WHERE a."orgId" = v_org) THEN
    RAISE EXCEPTION 'org % is archived; nothing new is written (D-43)', v_org;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ProxyRevocation_not_archived" BEFORE INSERT ON "ProxyRevocation" FOR EACH ROW EXECUTE FUNCTION quorum_refuse_archived_org();

-- D-33 grants: read and append; nothing more.
GRANT SELECT, INSERT ON "ProxyRevocation" TO quorum_app;
