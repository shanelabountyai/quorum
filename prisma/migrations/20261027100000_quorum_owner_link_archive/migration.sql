-- Owner decisions of 2026-10-26: D-39 (OwnerLink written on invite acceptance; the desk operator sealed in the
-- link) and D-43 (an org with append-only history is archived, never deleted). The generated half mirrors
-- prisma/schema/quorum.prisma (CI's `prisma migrate diff` proves it); the hand-written half is the Invite trigger,
-- the archive's append-only trigger and second door, quorum_app's grants, and quorum_cast_ballot with the operator.

-- AlterTable
ALTER TABLE "BallotSecret" ADD COLUMN "enteredById" UUID;

-- CreateTable
CREATE TABLE "OwnerLink" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "inviteId" UUID,
    "linkedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OwnerLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgArchive" (
    "orgId" UUID NOT NULL,
    "archivedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedById" UUID,
    "reason" TEXT NOT NULL,

    CONSTRAINT "OrgArchive_pkey" PRIMARY KEY ("orgId")
);

-- CreateIndex
CREATE UNIQUE INDEX "OwnerLink_ownerId_key" ON "OwnerLink"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "OwnerLink_orgId_userId_key" ON "OwnerLink"("orgId", "userId");

-- AddForeignKey
ALTER TABLE "OwnerLink" ADD CONSTRAINT "OwnerLink_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerLink" ADD CONSTRAINT "OwnerLink_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerLink" ADD CONSTRAINT "OwnerLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgArchive" ADD CONSTRAINT "OrgArchive_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===================================================================================================================
-- Hand-written half.
-- ===================================================================================================================

-- D-43: the archive is permanent and append-only; quorum_append_only() is the init migration's function.
CREATE TRIGGER "OrgArchive_append_only" BEFORE UPDATE OR DELETE ON "OrgArchive" FOR EACH ROW EXECUTE FUNCTION quorum_append_only();

-- D-43, the second door: nothing new is written for an archived org, whichever path the write takes. The clone's
-- write paths refuse first with OrgArchived (src/meetings/archive.ts); this is what holds if one forgets.
CREATE FUNCTION quorum_refuse_archived_org() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_org UUID;
BEGIN
  IF TG_TABLE_NAME IN ('Unit', 'Owner', 'Meeting') THEN
    v_org := NEW."orgId";
  ELSIF TG_TABLE_NAME IN ('UnitShare', 'Ownership', 'LedgerEntry') THEN
    SELECT u."orgId" INTO v_org FROM "Unit" u WHERE u.id = NEW."unitId";
  ELSIF TG_TABLE_NAME IN ('Proxy', 'Ballot') THEN
    SELECT m."orgId" INTO v_org FROM "Meeting" m WHERE m.id = NEW."meetingId";
  ELSE
    RAISE EXCEPTION 'quorum_refuse_archived_org does not know table %', TG_TABLE_NAME;
  END IF;
  IF v_org IS NOT NULL AND EXISTS (SELECT 1 FROM "OrgArchive" a WHERE a."orgId" = v_org) THEN
    RAISE EXCEPTION 'org % is archived; nothing new is written (D-43)', v_org;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Unit_not_archived"        BEFORE INSERT ON "Unit"        FOR EACH ROW EXECUTE FUNCTION quorum_refuse_archived_org();
CREATE TRIGGER "Owner_not_archived"       BEFORE INSERT ON "Owner"       FOR EACH ROW EXECUTE FUNCTION quorum_refuse_archived_org();
CREATE TRIGGER "Meeting_not_archived"     BEFORE INSERT ON "Meeting"     FOR EACH ROW EXECUTE FUNCTION quorum_refuse_archived_org();
CREATE TRIGGER "UnitShare_not_archived"   BEFORE INSERT ON "UnitShare"   FOR EACH ROW EXECUTE FUNCTION quorum_refuse_archived_org();
CREATE TRIGGER "Ownership_not_archived"   BEFORE INSERT ON "Ownership"   FOR EACH ROW EXECUTE FUNCTION quorum_refuse_archived_org();
CREATE TRIGGER "LedgerEntry_not_archived" BEFORE INSERT ON "LedgerEntry" FOR EACH ROW EXECUTE FUNCTION quorum_refuse_archived_org();
CREATE TRIGGER "Proxy_not_archived"       BEFORE INSERT ON "Proxy"       FOR EACH ROW EXECUTE FUNCTION quorum_refuse_archived_org();
CREATE TRIGGER "Ballot_not_archived"      BEFORE INSERT ON "Ballot"      FOR EACH ROW EXECUTE FUNCTION quorum_refuse_archived_org();

-- D-39 (a): the link is written when an invite is ACCEPTED (acceptedAt NULL -> set) and its email equals an owner's
-- email in that org, case-insensitively, for the accepting user (acceptInvite requires the invite email to be the
-- signed-in user's). The template's acceptInvite is template-owned and untouched; this trigger is clone-owned.
-- Never links by name, never links an email that matches no owner, never links into an archived org, and never
-- moves an existing link (ON CONFLICT DO NOTHING). Two owner rows with one email: the lowest ownerId wins, stated.
-- SECURITY DEFINER: the runtime login (D-42) has no INSERT on OwnerLink; only this trigger writes it.
CREATE FUNCTION quorum_link_owner_on_invite() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD."acceptedAt" IS NULL AND NEW."acceptedAt" IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM "OrgArchive" a WHERE a."orgId" = NEW."orgId") THEN
    INSERT INTO "OwnerLink" (id, "orgId", "ownerId", "userId", "inviteId")
    SELECT gen_random_uuid(), o."orgId", o.id, u.id, NEW.id
    FROM "Owner" o JOIN "User" u ON lower(u.email) = lower(NEW.email)
    WHERE o."orgId" = NEW."orgId" AND o.email <> '' AND lower(o.email) = lower(NEW.email)
    ORDER BY o."ownerId"
    LIMIT 1
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER "Invite_link_owner" AFTER UPDATE OF "acceptedAt" ON "Invite" FOR EACH ROW EXECUTE FUNCTION quorum_link_owner_on_invite();
REVOKE ALL ON FUNCTION quorum_link_owner_on_invite() FROM PUBLIC;

-- D-33 grants for the new tables: the application reads links and archives; it archives through an INSERT; it never
-- writes a link (the trigger does).
GRANT SELECT ON "OwnerLink", "OrgArchive" TO quorum_app;
GRANT INSERT ON "OrgArchive" TO quorum_app;

-- D-39 (b): quorum_cast_ballot gains the operator (p_entered_by), written into the sealed link and nowhere else.
-- Dropped and recreated rather than overloaded, so there is still exactly one function that writes a ballot.
DROP FUNCTION quorum_cast_ballot(UUID, TEXT, CHAR, INTEGER, CHAR, BOOLEAN, TEXT, CHAR, CHAR, "BallotCode", UUID, TEXT, UUID, TEXT, UUID, TEXT, UUID);

CREATE FUNCTION quorum_cast_ballot(
  p_meeting UUID, p_ballot_id TEXT, p_unit_hash CHAR(64), p_bps_as_of INTEGER, p_cast_at CHAR(19), p_via_proxy BOOLEAN,
  p_choices_canonical TEXT, p_nonce_hash CHAR(64), p_receipt CHAR(64),
  p_code "BallotCode", p_supersedes UUID,
  p_unit_ref TEXT, p_unit_id UUID, p_cast_by_ref TEXT, p_cast_by_id UUID, p_via_proxy_ref TEXT, p_via_proxy_id UUID,
  p_entered_by UUID
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_id UUID := gen_random_uuid();
  v_prev_seq INTEGER;
BEGIN
  IF EXISTS (SELECT 1 FROM "Meeting" m WHERE m.id = p_meeting AND m."closedAt" IS NOT NULL) THEN
    RAISE EXCEPTION 'meeting % is closed; no ballot can be recorded (D-34)', p_meeting;
  END IF;
  IF p_supersedes IS NOT NULL AND p_code IS NOT NULL THEN
    RAISE EXCEPTION 'only a COUNTED direct ballot supersedes (E-9)';
  END IF;
  INSERT INTO "Ballot" (id, "meetingId", "ballotId", "unitHash", "bpsAsOf", "castAt", "viaProxy", "choicesCanonical", "nonceHash", "receipt")
  VALUES (v_id, p_meeting, p_ballot_id, p_unit_hash, p_bps_as_of, p_cast_at, p_via_proxy, p_choices_canonical, p_nonce_hash, p_receipt);
  INSERT INTO "BallotSecret" ("ballotId", "meetingId", "unitRef", "unitId", "castByRef", "castById", "viaProxyRef", "viaProxyId", "enteredById")
  VALUES (v_id, p_meeting, p_unit_ref, p_unit_id, p_cast_by_ref, p_cast_by_id, COALESCE(p_via_proxy_ref, ''), p_via_proxy_id, p_entered_by);
  INSERT INTO "BallotStatusEvent" ("ballotId", seq, status, code, at, "causeBallotId")
  VALUES (v_id, 1, CASE WHEN p_code IS NULL THEN 'COUNTED'::"BallotStatus" ELSE 'REJECTED'::"BallotStatus" END, p_code, p_cast_at, NULL);
  IF p_supersedes IS NOT NULL THEN
    SELECT max(e.seq) INTO v_prev_seq FROM "BallotStatusEvent" e WHERE e."ballotId" = p_supersedes;
    IF v_prev_seq IS NULL THEN
      RAISE EXCEPTION 'superseded ballot % has no label', p_supersedes;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM "Ballot" b WHERE b.id = p_supersedes AND b."meetingId" = p_meeting AND b."viaProxy") THEN
      RAISE EXCEPTION 'superseded ballot % is not a proxy ballot of meeting % (E-9)', p_supersedes, p_meeting;
    END IF;
    INSERT INTO "BallotStatusEvent" ("ballotId", seq, status, code, at, "causeBallotId")
    VALUES (p_supersedes, v_prev_seq + 1, 'REJECTED', 'PROXY_SUPERSEDED_BY_OWNER', p_cast_at, v_id);
  END IF;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION quorum_cast_ballot(UUID, TEXT, CHAR, INTEGER, CHAR, BOOLEAN, TEXT, CHAR, CHAR, "BallotCode", UUID, TEXT, UUID, TEXT, UUID, TEXT, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION quorum_cast_ballot(UUID, TEXT, CHAR, INTEGER, CHAR, BOOLEAN, TEXT, CHAR, CHAR, "BallotCode", UUID, TEXT, UUID, TEXT, UUID, TEXT, UUID, UUID) TO quorum_app;
