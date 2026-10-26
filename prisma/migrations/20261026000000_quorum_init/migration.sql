-- Quorum's first migration (Phase 2, task 2.1). The generated half mirrors prisma/schema/quorum.prisma (CI runs
-- `prisma migrate diff --from-migrations --to-schema --exit-code` to prove they agree); the hand-written half
-- is everything Prisma cannot say: the D-8 CHECKs, the append-only triggers (D-19), the close/seal trigger
-- (D-20), the quorum_app role and its grants (D-33), and the three SECURITY DEFINER functions that are the only
-- way a ballot or a result reaches a table. The billing tables leave the history here (D-27 c).

-- DropTable: billing was removed by the module manifest (D-5, D-27 c); its tables were still in the history.
ALTER TABLE "BillingAccount" DROP CONSTRAINT IF EXISTS "BillingAccount_orgId_fkey";
DROP TABLE IF EXISTS "BillingAccount";
DROP TABLE IF EXISTS "StripeEvent";

-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "BallotStatus" AS ENUM ('COUNTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "BallotCode" AS ENUM ('UNKNOWN_UNIT', 'EARLY', 'LATE', 'PROXY_UNKNOWN', 'PROXY_UNIT_MISMATCH', 'PROXY_GRANTOR_NOT_OWNER', 'PROXY_LATE', 'PROXY_REVOKED', 'PROXY_CHAIN', 'PROXY_HOLDER_MISMATCH', 'PROXY_HOLDER_NOT_MEMBER', 'NOT_OWNER', 'INELIGIBLE_DELINQUENT', 'DUPLICATE_UNIT', 'PROXY_SUPERSEDED_BY_OWNER');

-- CreateEnum
CREATE TYPE "LedgerKind" AS ENUM ('CHARGE', 'PAYMENT', 'FINE');

-- CreateTable
CREATE TABLE "Unit" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "unitId" TEXT NOT NULL,
    "unitType" TEXT NOT NULL DEFAULT '',
    "building" TEXT NOT NULL DEFAULT '',
    "floor" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitShare" (
    "id" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "shareBps" INTEGER NOT NULL,
    "effectiveFrom" CHAR(10) NOT NULL,

    CONSTRAINT "UnitShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Owner" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "Owner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ownership" (
    "id" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "fromDate" CHAR(10) NOT NULL,
    "toDate" CHAR(10),

    CONSTRAINT "Ownership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "entryId" TEXT NOT NULL,
    "kind" "LedgerKind" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "date" CHAR(10) NOT NULL,
    "memo" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Meeting" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "meetingId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "definition" JSONB NOT NULL,
    "definitionHash" CHAR(64) NOT NULL,
    "salt" CHAR(32) NOT NULL,
    "status" "MeetingStatus" NOT NULL DEFAULT 'OPEN',
    "closedAt" CHAR(19),
    "sealedAt" TIMESTAMPTZ(6),
    "totalUnits" INTEGER,
    "totalShareBps" INTEGER,
    "merkleRoot" CHAR(64),
    "quorum" JSONB,
    "commitment" CHAR(64),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Proxy" (
    "id" UUID NOT NULL,
    "meetingId" UUID NOT NULL,
    "proxyId" TEXT NOT NULL,
    "grantorUnitId" UUID NOT NULL,
    "grantorOwnerId" UUID NOT NULL,
    "holderOwnerId" UUID NOT NULL,
    "receivedAt" CHAR(19) NOT NULL,
    "revokedAt" CHAR(19),

    CONSTRAINT "Proxy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ballot" (
    "id" UUID NOT NULL,
    "meetingId" UUID NOT NULL,
    "ballotId" TEXT NOT NULL,
    "unitHash" CHAR(64) NOT NULL,
    "bpsAsOf" INTEGER NOT NULL,
    "castAt" CHAR(19) NOT NULL,
    "viaProxy" BOOLEAN NOT NULL,
    "choicesCanonical" TEXT NOT NULL,
    "nonceHash" CHAR(64) NOT NULL,
    "receipt" CHAR(64) NOT NULL,

    CONSTRAINT "Ballot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BallotStatusEvent" (
    "id" BIGSERIAL NOT NULL,
    "ballotId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "status" "BallotStatus" NOT NULL,
    "code" "BallotCode",
    "at" CHAR(19) NOT NULL,
    "causeBallotId" UUID,

    CONSTRAINT "BallotStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BallotSecret" (
    "ballotId" UUID NOT NULL,
    "meetingId" UUID NOT NULL,
    "unitRef" TEXT NOT NULL,
    "unitId" UUID,
    "castByRef" TEXT NOT NULL,
    "castById" UUID,
    "viaProxyRef" TEXT NOT NULL DEFAULT '',
    "viaProxyId" UUID,

    CONSTRAINT "BallotSecret_pkey" PRIMARY KEY ("ballotId")
);

-- CreateTable
CREATE TABLE "ContestResult" (
    "id" UUID NOT NULL,
    "meetingId" UUID NOT NULL,
    "contestId" TEXT NOT NULL,
    "tally" JSONB NOT NULL,
    "commitment" CHAR(64) NOT NULL,

    CONSTRAINT "ContestResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Unit_orgId_unitId_key" ON "Unit"("orgId", "unitId");

-- CreateIndex
CREATE UNIQUE INDEX "UnitShare_unitId_effectiveFrom_key" ON "UnitShare"("unitId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "Owner_orgId_ownerId_key" ON "Owner"("orgId", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "Ownership_unitId_ownerId_fromDate_key" ON "Ownership"("unitId", "ownerId", "fromDate");

-- CreateIndex
CREATE INDEX "LedgerEntry_unitId_date_idx" ON "LedgerEntry"("unitId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_unitId_entryId_key" ON "LedgerEntry"("unitId", "entryId");

-- CreateIndex
CREATE UNIQUE INDEX "Meeting_orgId_meetingId_key" ON "Meeting"("orgId", "meetingId");

-- CreateIndex
CREATE UNIQUE INDEX "Proxy_meetingId_proxyId_key" ON "Proxy"("meetingId", "proxyId");

-- CreateIndex
CREATE INDEX "Ballot_meetingId_unitHash_idx" ON "Ballot"("meetingId", "unitHash");

-- CreateIndex
CREATE UNIQUE INDEX "Ballot_meetingId_ballotId_key" ON "Ballot"("meetingId", "ballotId");

-- CreateIndex
CREATE UNIQUE INDEX "Ballot_meetingId_receipt_key" ON "Ballot"("meetingId", "receipt");

-- CreateIndex
CREATE UNIQUE INDEX "BallotStatusEvent_ballotId_seq_key" ON "BallotStatusEvent"("ballotId", "seq");

-- CreateIndex
CREATE INDEX "BallotSecret_meetingId_unitRef_idx" ON "BallotSecret"("meetingId", "unitRef");

-- CreateIndex
CREATE UNIQUE INDEX "ContestResult_meetingId_contestId_key" ON "ContestResult"("meetingId", "contestId");

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitShare" ADD CONSTRAINT "UnitShare_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Owner" ADD CONSTRAINT "Owner_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ownership" ADD CONSTRAINT "Ownership_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ownership" ADD CONSTRAINT "Ownership_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proxy" ADD CONSTRAINT "Proxy_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proxy" ADD CONSTRAINT "Proxy_grantorUnitId_fkey" FOREIGN KEY ("grantorUnitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proxy" ADD CONSTRAINT "Proxy_grantorOwnerId_fkey" FOREIGN KEY ("grantorOwnerId") REFERENCES "Owner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proxy" ADD CONSTRAINT "Proxy_holderOwnerId_fkey" FOREIGN KEY ("holderOwnerId") REFERENCES "Owner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ballot" ADD CONSTRAINT "Ballot_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BallotStatusEvent" ADD CONSTRAINT "BallotStatusEvent_ballotId_fkey" FOREIGN KEY ("ballotId") REFERENCES "Ballot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BallotStatusEvent" ADD CONSTRAINT "BallotStatusEvent_causeBallotId_fkey" FOREIGN KEY ("causeBallotId") REFERENCES "Ballot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BallotSecret" ADD CONSTRAINT "BallotSecret_ballotId_fkey" FOREIGN KEY ("ballotId") REFERENCES "Ballot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BallotSecret" ADD CONSTRAINT "BallotSecret_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BallotSecret" ADD CONSTRAINT "BallotSecret_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BallotSecret" ADD CONSTRAINT "BallotSecret_castById_fkey" FOREIGN KEY ("castById") REFERENCES "Owner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BallotSecret" ADD CONSTRAINT "BallotSecret_viaProxyId_fkey" FOREIGN KEY ("viaProxyId") REFERENCES "Proxy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestResult" ADD CONSTRAINT "ContestResult_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===================================================================================================================
-- Hand-written half.
-- ===================================================================================================================

-- D-8: every meeting-axis instant and day is a fixed-width string. The CHECKs are the same regexes as
-- src/tally/time.ts; a row the engine could not read cannot be stored.
ALTER TABLE "UnitShare"   ADD CONSTRAINT "UnitShare_effectiveFrom_day" CHECK ("effectiveFrom" ~ '^\d{4}-\d{2}-\d{2}$');
ALTER TABLE "UnitShare"   ADD CONSTRAINT "UnitShare_shareBps_nonneg" CHECK ("shareBps" >= 0);
ALTER TABLE "Ownership"   ADD CONSTRAINT "Ownership_fromDate_day" CHECK ("fromDate" ~ '^\d{4}-\d{2}-\d{2}$');
ALTER TABLE "Ownership"   ADD CONSTRAINT "Ownership_toDate_day" CHECK ("toDate" IS NULL OR "toDate" ~ '^\d{4}-\d{2}-\d{2}$');
ALTER TABLE "Ownership"   ADD CONSTRAINT "Ownership_half_open" CHECK ("toDate" IS NULL OR "toDate" > "fromDate");
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_date_day" CHECK ("date" ~ '^\d{4}-\d{2}-\d{2}$');
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_amountCents_nonneg" CHECK ("amountCents" >= 0);
ALTER TABLE "Meeting"     ADD CONSTRAINT "Meeting_closedAt_instant" CHECK ("closedAt" IS NULL OR "closedAt" ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$');
ALTER TABLE "Meeting"     ADD CONSTRAINT "Meeting_salt_hex" CHECK ("salt" ~ '^[0-9a-f]{32}$');
ALTER TABLE "Meeting"     ADD CONSTRAINT "Meeting_closed_consistent" CHECK (("status" = 'OPEN') = ("closedAt" IS NULL));
ALTER TABLE "Proxy"       ADD CONSTRAINT "Proxy_receivedAt_instant" CHECK ("receivedAt" ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$');
ALTER TABLE "Proxy"       ADD CONSTRAINT "Proxy_revokedAt_instant" CHECK ("revokedAt" IS NULL OR "revokedAt" ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$');
ALTER TABLE "Ballot"      ADD CONSTRAINT "Ballot_castAt_instant" CHECK ("castAt" ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$');
ALTER TABLE "Ballot"      ADD CONSTRAINT "Ballot_bpsAsOf_nonneg" CHECK ("bpsAsOf" >= 0);
ALTER TABLE "Ballot"      ADD CONSTRAINT "Ballot_hashes_hex" CHECK ("unitHash" ~ '^[0-9a-f]{64}$' AND "nonceHash" ~ '^[0-9a-f]{64}$' AND "receipt" ~ '^[0-9a-f]{64}$');
ALTER TABLE "BallotStatusEvent" ADD CONSTRAINT "BallotStatusEvent_at_instant" CHECK ("at" ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$');
ALTER TABLE "BallotStatusEvent" ADD CONSTRAINT "BallotStatusEvent_seq_positive" CHECK ("seq" >= 1);
-- D-31: a COUNTED label has no code; a REJECTED label has exactly one. E-9 is the only label with a cause.
ALTER TABLE "BallotStatusEvent" ADD CONSTRAINT "BallotStatusEvent_code_matches_status" CHECK (("status" = 'COUNTED') = ("code" IS NULL));
ALTER TABLE "BallotStatusEvent" ADD CONSTRAINT "BallotStatusEvent_cause_only_superseded" CHECK (("code" = 'PROXY_SUPERSEDED_BY_OWNER') = ("causeBallotId" IS NOT NULL));

-- D-19: append-only. One function, one trigger per table, the message naming the table. TRUNCATE is left alone
-- (row triggers do not fire on it) so tests can empty the tables, as the foundation's audit trigger does.
CREATE FUNCTION quorum_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (D-19)', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER "Ballot_append_only"            BEFORE UPDATE OR DELETE ON "Ballot"            FOR EACH ROW EXECUTE FUNCTION quorum_append_only();
CREATE TRIGGER "BallotStatusEvent_append_only" BEFORE UPDATE OR DELETE ON "BallotStatusEvent" FOR EACH ROW EXECUTE FUNCTION quorum_append_only();
CREATE TRIGGER "BallotSecret_append_only"      BEFORE UPDATE OR DELETE ON "BallotSecret"      FOR EACH ROW EXECUTE FUNCTION quorum_append_only();
CREATE TRIGGER "Proxy_append_only"             BEFORE UPDATE OR DELETE ON "Proxy"             FOR EACH ROW EXECUTE FUNCTION quorum_append_only();
CREATE TRIGGER "LedgerEntry_append_only"       BEFORE UPDATE OR DELETE ON "LedgerEntry"       FOR EACH ROW EXECUTE FUNCTION quorum_append_only();
CREATE TRIGGER "ContestResult_append_only"     BEFORE UPDATE OR DELETE ON "ContestResult"     FOR EACH ROW EXECUTE FUNCTION quorum_append_only();

-- D-34: nothing is recorded for a closed meeting. The engine's LATE (B-3) is a code on a received ballot; this
-- is the database refusing a ballot that arrives after the operator closed and sealed.
CREATE FUNCTION quorum_ballot_meeting_open() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Meeting" m WHERE m.id = NEW."meetingId" AND m."closedAt" IS NOT NULL) THEN
    RAISE EXCEPTION 'meeting % is closed; no ballot can be recorded (D-34)', NEW."meetingId";
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Ballot_meeting_open" BEFORE INSERT ON "Ballot" FOR EACH ROW EXECUTE FUNCTION quorum_ballot_meeting_open();

-- The same door for a label: no event is appended to a ballot of a closed meeting (the set is sealed, D-20).
CREATE FUNCTION quorum_status_event_meeting_open() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Ballot" b JOIN "Meeting" m ON m.id = b."meetingId" WHERE b.id = NEW."ballotId" AND m."closedAt" IS NOT NULL) THEN
    RAISE EXCEPTION 'ballot % belongs to a closed meeting; its label is sealed (D-20)', NEW."ballotId";
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "BallotStatusEvent_meeting_open" BEFORE INSERT ON "BallotStatusEvent" FOR EACH ROW EXECUTE FUNCTION quorum_status_event_meeting_open();

-- D-20 / D-33: a Meeting row may change exactly once, OPEN -> CLOSED, and that transition writes the result
-- columns. Every other UPDATE, and every DELETE, is refused. The AFTER trigger on that transition seals the link:
-- REVOKE SELECT on BallotSecret from the application role and stamp sealedAt.
CREATE FUNCTION quorum_meeting_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Meeting is never deleted (D-19)';
  END IF;
  IF OLD."closedAt" IS NOT NULL THEN
    -- Closed. The one permitted write is the seal trigger stamping sealedAt, once, with nothing else moving.
    IF OLD."sealedAt" IS NOT NULL OR NEW."sealedAt" IS NULL
       OR NEW."closedAt" IS DISTINCT FROM OLD."closedAt" OR NEW."status" IS DISTINCT FROM OLD."status"
       OR NEW."merkleRoot" IS DISTINCT FROM OLD."merkleRoot" OR NEW."commitment" IS DISTINCT FROM OLD."commitment"
       OR NEW."quorum" IS DISTINCT FROM OLD."quorum" OR NEW."definition" IS DISTINCT FROM OLD."definition"
       OR NEW."definitionHash" IS DISTINCT FROM OLD."definitionHash" OR NEW."salt" IS DISTINCT FROM OLD."salt"
       OR NEW."totalUnits" IS DISTINCT FROM OLD."totalUnits" OR NEW."totalShareBps" IS DISTINCT FROM OLD."totalShareBps"
       OR NEW."orgId" IS DISTINCT FROM OLD."orgId" OR NEW."meetingId" IS DISTINCT FROM OLD."meetingId"
       OR NEW."title" IS DISTINCT FROM OLD."title" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
      RAISE EXCEPTION 'meeting % is closed and sealed; nothing on it changes (D-20)', OLD.id;
    END IF;
    RETURN NEW;
  END IF;
  -- Open: the definition, salt and identity are fixed at creation (D-35); the title may be edited; closing writes
  -- every result column together, and nothing writes a result column before closing.
  IF NEW."definition" IS DISTINCT FROM OLD."definition" OR NEW."definitionHash" IS DISTINCT FROM OLD."definitionHash"
     OR NEW."salt" IS DISTINCT FROM OLD."salt" OR NEW."orgId" IS DISTINCT FROM OLD."orgId" OR NEW."meetingId" IS DISTINCT FROM OLD."meetingId"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'meeting % definition, salt and identity are fixed at creation (D-35)', OLD.id;
  END IF;
  IF NEW."sealedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'meeting % sealedAt is written by the seal trigger only (D-20)', OLD.id;
  END IF;
  IF NEW."closedAt" IS NOT NULL THEN
    IF NEW."status" <> 'CLOSED' OR NEW."merkleRoot" IS NULL OR NEW."commitment" IS NULL OR NEW."quorum" IS NULL
       OR NEW."totalUnits" IS NULL OR NEW."totalShareBps" IS NULL THEN
      RAISE EXCEPTION 'closing meeting % must write status, merkleRoot, quorum, commitment, totalUnits, totalShareBps together (D-20)', OLD.id;
    END IF;
  ELSIF NEW."status" <> 'OPEN' OR NEW."merkleRoot" IS NOT NULL OR NEW."commitment" IS NOT NULL OR NEW."quorum" IS NOT NULL
     OR NEW."totalUnits" IS NOT NULL OR NEW."totalShareBps" IS NOT NULL THEN
    RAISE EXCEPTION 'meeting % is open; result columns are written only by closing (D-20)', OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Meeting_guard" BEFORE UPDATE OR DELETE ON "Meeting" FOR EACH ROW EXECUTE FUNCTION quorum_meeting_guard();

CREATE FUNCTION quorum_meeting_seal() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF OLD."closedAt" IS NULL AND NEW."closedAt" IS NOT NULL THEN
    EXECUTE 'REVOKE SELECT ON "BallotSecret" FROM quorum_app';
    UPDATE "Meeting" SET "sealedAt" = now() WHERE id = NEW.id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER "Meeting_seal" AFTER UPDATE ON "Meeting" FOR EACH ROW EXECUTE FUNCTION quorum_meeting_seal();

-- D-33: the application role. NOLOGIN; the connection's login role assumes it with SET LOCAL ROLE. Idempotent
-- because roles are cluster-wide and a second database on the same server (the shadow database, a sibling clone)
-- may have created it already.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'quorum_app') THEN
    CREATE ROLE quorum_app NOLOGIN;
  END IF;
END;
$$;

GRANT USAGE ON SCHEMA "public" TO quorum_app;
GRANT SELECT ON "Org", "Unit", "UnitShare", "Owner", "Ownership", "LedgerEntry", "Meeting", "Proxy", "Ballot", "BallotStatusEvent", "BallotSecret", "ContestResult" TO quorum_app;
GRANT INSERT ON "Unit", "UnitShare", "Owner", "Ownership", "LedgerEntry", "Meeting", "Proxy" TO quorum_app;
GRANT UPDATE ("title") ON "Meeting" TO quorum_app;
-- Ballot, BallotStatusEvent, BallotSecret and ContestResult are written only through the functions below.

-- D-35 (g): the cast path serialises per meeting. Returns the meeting's closedAt so the caller can refuse early;
-- the row lock is held until the caller's transaction ends.
CREATE FUNCTION quorum_lock_meeting(p_meeting UUID) RETURNS TABLE("closedAt" CHAR(19), "definition" JSONB, "salt" CHAR(32))
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY SELECT m."closedAt", m."definition", m."salt" FROM "Meeting" m WHERE m.id = p_meeting FOR UPDATE OF m;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'meeting % not found', p_meeting;
  END IF;
END;
$$;

-- D-20, D-31, D-33: the ONLY path that writes a ballot. The engine (TypeScript) has already evaluated the §4 code;
-- this writes the Ballot row, its sealed link, its seq-1 label and, for E-9, the seq-2 label on the superseded
-- proxy ballot, all in the caller's transaction. Re-checks the meeting is open under the row lock (D-34).
CREATE FUNCTION quorum_cast_ballot(
  p_meeting UUID, p_ballot_id TEXT, p_unit_hash CHAR(64), p_bps_as_of INTEGER, p_cast_at CHAR(19), p_via_proxy BOOLEAN,
  p_choices_canonical TEXT, p_nonce_hash CHAR(64), p_receipt CHAR(64),
  p_code "BallotCode", p_supersedes UUID,
  p_unit_ref TEXT, p_unit_id UUID, p_cast_by_ref TEXT, p_cast_by_id UUID, p_via_proxy_ref TEXT, p_via_proxy_id UUID
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
  INSERT INTO "BallotSecret" ("ballotId", "meetingId", "unitRef", "unitId", "castByRef", "castById", "viaProxyRef", "viaProxyId")
  VALUES (v_id, p_meeting, p_unit_ref, p_unit_id, p_cast_by_ref, p_cast_by_id, COALESCE(p_via_proxy_ref, ''), p_via_proxy_id);
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

-- D-20, D-33: the ONLY path that writes a result. Idempotent: a second call for a closed meeting writes nothing
-- and returns false; the caller reads the stored commitments.
CREATE FUNCTION quorum_close_meeting(
  p_meeting UUID, p_closed_at CHAR(19), p_total_units INTEGER, p_total_share_bps INTEGER,
  p_merkle_root CHAR(64), p_quorum JSONB, p_commitment CHAR(64), p_results JSONB
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_closed CHAR(19);
  r JSONB;
BEGIN
  SELECT m."closedAt" INTO v_closed FROM "Meeting" m WHERE m.id = p_meeting FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'meeting % not found', p_meeting;
  END IF;
  IF v_closed IS NOT NULL THEN
    RETURN false;
  END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(p_results) LOOP
    INSERT INTO "ContestResult" (id, "meetingId", "contestId", tally, commitment)
    VALUES (gen_random_uuid(), p_meeting, r->>'contest_id', r->'tally', r->>'commitment');
  END LOOP;
  UPDATE "Meeting" SET status = 'CLOSED', "closedAt" = p_closed_at, "totalUnits" = p_total_units, "totalShareBps" = p_total_share_bps,
    "merkleRoot" = p_merkle_root, quorum = p_quorum, commitment = p_commitment
  WHERE id = p_meeting;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION quorum_lock_meeting(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION quorum_cast_ballot(UUID, TEXT, CHAR, INTEGER, CHAR, BOOLEAN, TEXT, CHAR, CHAR, "BallotCode", UUID, TEXT, UUID, TEXT, UUID, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION quorum_close_meeting(UUID, CHAR, INTEGER, INTEGER, CHAR, JSONB, CHAR, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION quorum_lock_meeting(UUID) TO quorum_app;
GRANT EXECUTE ON FUNCTION quorum_cast_ballot(UUID, TEXT, CHAR, INTEGER, CHAR, BOOLEAN, TEXT, CHAR, CHAR, "BallotCode", UUID, TEXT, UUID, TEXT, UUID, TEXT, UUID) TO quorum_app;
GRANT EXECUTE ON FUNCTION quorum_close_meeting(UUID, CHAR, INTEGER, INTEGER, CHAR, JSONB, CHAR, JSONB) TO quorum_app;
