-- Phase 3, tasks 3.5 and 3.6: the dues ledger (D-21, D-41) and the violation workflow (D-22). The generated half
-- mirrors prisma/schema/quorum.prisma (CI's `prisma migrate diff`); the hand-written half adds the CHECKs, the
-- append-only triggers, the archived-org door for the new tables, and quorum_app's grants — including INSERT on the
-- template's AuditEvent and Outbox, so an audit row and a queued notice commit with the write they describe.

-- CreateEnum
CREATE TYPE "ViolationState" AS ENUM ('NOTICE_SENT', 'HEARING_SCHEDULED', 'CONTINUED', 'FINE_ASSESSED', 'DISMISSED');

-- AlterTable
ALTER TABLE "LedgerEntry" ADD COLUMN "reason" TEXT NOT NULL DEFAULT '',
ADD COLUMN "reversesEntryId" UUID,
ADD COLUMN "runId" UUID;

-- CreateTable
CREATE TABLE "DuesRun" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "month" CHAR(7) NOT NULL,
    "chargedOn" CHAR(10) NOT NULL,
    "budgetCents" INTEGER NOT NULL,
    "totalBps" INTEGER NOT NULL,
    "postedCents" INTEGER NOT NULL,
    "roundingCents" INTEGER NOT NULL,
    "units" INTEGER NOT NULL,
    "postedById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DuesRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Violation" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "openedOn" CHAR(10) NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Violation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ViolationEvent" (
    "id" UUID NOT NULL,
    "violationId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "state" "ViolationState" NOT NULL,
    "day" CHAR(10) NOT NULL,
    "hearingOn" CHAR(10),
    "fineCents" INTEGER,
    "ledgerEntryId" UUID,
    "reason" TEXT NOT NULL DEFAULT '',
    "actorId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ViolationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DuesRun_orgId_month_key" ON "DuesRun"("orgId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "Violation_orgId_number_key" ON "Violation"("orgId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "ViolationEvent_violationId_seq_key" ON "ViolationEvent"("violationId", "seq");

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_reversesEntryId_fkey" FOREIGN KEY ("reversesEntryId") REFERENCES "LedgerEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DuesRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuesRun" ADD CONSTRAINT "DuesRun_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Violation" ADD CONSTRAINT "Violation_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Violation" ADD CONSTRAINT "Violation_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViolationEvent" ADD CONSTRAINT "ViolationEvent_violationId_fkey" FOREIGN KEY ("violationId") REFERENCES "Violation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViolationEvent" ADD CONSTRAINT "ViolationEvent_ledgerEntryId_fkey" FOREIGN KEY ("ledgerEntryId") REFERENCES "LedgerEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===================================================================================================================
-- Hand-written half.
-- ===================================================================================================================

-- D-21: only a CREDIT reverses, and a CREDIT says why. A reversal names an entry of the same unit (trigger below).
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_reversal_is_credit" CHECK ("reversesEntryId" IS NULL OR "kind" = 'CREDIT');
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_credit_has_reason" CHECK ("kind" <> 'CREDIT' OR "reason" <> '');
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_run_is_charge" CHECK ("runId" IS NULL OR "kind" = 'CHARGE');

-- D-8 and the money rule for the run: the month is a "YYYY-MM" string, every amount a non-negative integer, and the
-- run sums to its budget exactly (posted + rounding = budget).
ALTER TABLE "DuesRun" ADD CONSTRAINT "DuesRun_month_format" CHECK ("month" ~ '^\d{4}-\d{2}$');
ALTER TABLE "DuesRun" ADD CONSTRAINT "DuesRun_chargedOn_day" CHECK ("chargedOn" ~ '^\d{4}-\d{2}-\d{2}$');
ALTER TABLE "DuesRun" ADD CONSTRAINT "DuesRun_amounts_nonneg" CHECK ("budgetCents" >= 0 AND "postedCents" >= 0 AND "roundingCents" >= 0 AND "totalBps" > 0 AND "units" >= 0);
ALTER TABLE "DuesRun" ADD CONSTRAINT "DuesRun_sums_to_budget" CHECK ("postedCents" + "roundingCents" = "budgetCents");

-- D-22: dates on the calendar axis; a hearing date only on HEARING_SCHEDULED; a fine (positive, with its ledger row)
-- only on FINE_ASSESSED.
ALTER TABLE "Violation" ADD CONSTRAINT "Violation_openedOn_day" CHECK ("openedOn" ~ '^\d{4}-\d{2}-\d{2}$');
ALTER TABLE "ViolationEvent" ADD CONSTRAINT "ViolationEvent_day_day" CHECK ("day" ~ '^\d{4}-\d{2}-\d{2}$');
ALTER TABLE "ViolationEvent" ADD CONSTRAINT "ViolationEvent_hearing" CHECK (("state" = 'HEARING_SCHEDULED') = ("hearingOn" IS NOT NULL) AND ("hearingOn" IS NULL OR "hearingOn" ~ '^\d{4}-\d{2}-\d{2}$'));
ALTER TABLE "ViolationEvent" ADD CONSTRAINT "ViolationEvent_fine" CHECK (("state" = 'FINE_ASSESSED') = ("fineCents" IS NOT NULL AND "fineCents" > 0 AND "ledgerEntryId" IS NOT NULL));
ALTER TABLE "ViolationEvent" ADD CONSTRAINT "ViolationEvent_seq_positive" CHECK ("seq" >= 1);

-- D-19: append-only, like the rest of the history.
CREATE TRIGGER "DuesRun_append_only"        BEFORE UPDATE OR DELETE ON "DuesRun"        FOR EACH ROW EXECUTE FUNCTION quorum_append_only();
CREATE TRIGGER "Violation_append_only"      BEFORE UPDATE OR DELETE ON "Violation"      FOR EACH ROW EXECUTE FUNCTION quorum_append_only();
CREATE TRIGGER "ViolationEvent_append_only" BEFORE UPDATE OR DELETE ON "ViolationEvent" FOR EACH ROW EXECUTE FUNCTION quorum_append_only();

-- D-21: a reversal names an entry of the same unit.
CREATE FUNCTION quorum_reversal_same_unit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."reversesEntryId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "LedgerEntry" e WHERE e.id = NEW."reversesEntryId" AND e."unitId" = NEW."unitId") THEN
    RAISE EXCEPTION 'a CREDIT reverses an entry of its own unit (D-21)';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "LedgerEntry_reversal_same_unit" BEFORE INSERT ON "LedgerEntry" FOR EACH ROW EXECUTE FUNCTION quorum_reversal_same_unit();

-- D-43's second door, extended to the new tables (CREATE OR REPLACE keeps every existing trigger pointing at it).
CREATE OR REPLACE FUNCTION quorum_refuse_archived_org() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_org UUID;
BEGIN
  IF TG_TABLE_NAME IN ('Unit', 'Owner', 'Meeting', 'DuesRun', 'Violation') THEN
    v_org := NEW."orgId";
  ELSIF TG_TABLE_NAME IN ('UnitShare', 'Ownership', 'LedgerEntry') THEN
    SELECT u."orgId" INTO v_org FROM "Unit" u WHERE u.id = NEW."unitId";
  ELSIF TG_TABLE_NAME IN ('Proxy', 'Ballot') THEN
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

CREATE TRIGGER "DuesRun_not_archived"        BEFORE INSERT ON "DuesRun"        FOR EACH ROW EXECUTE FUNCTION quorum_refuse_archived_org();
CREATE TRIGGER "Violation_not_archived"      BEFORE INSERT ON "Violation"      FOR EACH ROW EXECUTE FUNCTION quorum_refuse_archived_org();
CREATE TRIGGER "ViolationEvent_not_archived" BEFORE INSERT ON "ViolationEvent" FOR EACH ROW EXECUTE FUNCTION quorum_refuse_archived_org();

-- D-33 grants: the application reads and appends the new history; nothing more. On the template's side it may
-- append an audit row and queue a notice inside its own transaction (both tables refuse UPDATE/DELETE to it anyway:
-- AuditEvent by the template's trigger, Outbox by having no such grant), and read the outbox to keep a notice from
-- being queued twice.
GRANT SELECT, INSERT ON "DuesRun", "Violation", "ViolationEvent" TO quorum_app;
GRANT SELECT, INSERT ON "AuditEvent" TO quorum_app; -- SELECT because Prisma's create is INSERT … RETURNING
GRANT USAGE ON SEQUENCE "AuditEvent_id_seq" TO quorum_app;
GRANT SELECT, INSERT ON "Outbox" TO quorum_app;
