-- Owner decision of 2026-10-26, D-58: a PASSED resolution declared a special assessment posts once, as one dues run
-- split across the units by share with the ROUNDING-line rule (D-21, D-47). The generated half mirrors
-- prisma/schema/quorum.prisma (CI's `prisma migrate diff`): the declaration table, and DuesRun's resolution id and
-- assessment link — the month stays unique per org for the monthly run (resolution ''), and an assessment run is
-- unique by its declaration. The hand-written half adds the CHECKs, the append-only trigger, the declaration guard
-- (open meeting, no ballot yet, a RESOLUTION of the definition), the posting guard (closed, PASSED, the declared
-- amount, the resolution id spelled from the meeting), the archived-org door and quorum_app's grants.

-- AlterTable
ALTER TABLE "DuesRun" ADD COLUMN "assessmentId" UUID,
ADD COLUMN "resolution" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "SpecialAssessment" (
    "id" UUID NOT NULL,
    "meetingId" UUID NOT NULL,
    "contestId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "declaredById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpecialAssessment_pkey" PRIMARY KEY ("id")
);

-- DropIndex
DROP INDEX "DuesRun_orgId_month_key";

-- CreateIndex
CREATE UNIQUE INDEX "DuesRun_assessmentId_key" ON "DuesRun"("assessmentId");

-- CreateIndex
CREATE UNIQUE INDEX "DuesRun_orgId_month_resolution_key" ON "DuesRun"("orgId", "month", "resolution");

-- CreateIndex
CREATE UNIQUE INDEX "SpecialAssessment_meetingId_contestId_key" ON "SpecialAssessment"("meetingId", "contestId");

-- AddForeignKey
ALTER TABLE "DuesRun" ADD CONSTRAINT "DuesRun_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "SpecialAssessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialAssessment" ADD CONSTRAINT "SpecialAssessment_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===================================================================================================================
-- Hand-written half.
-- ===================================================================================================================

ALTER TABLE "SpecialAssessment" ADD CONSTRAINT "SpecialAssessment_amount_positive" CHECK ("amountCents" > 0);
-- a run is the monthly dues (no declaration, no resolution id) or one assessment (both)
ALTER TABLE "DuesRun" ADD CONSTRAINT "DuesRun_assessment_has_resolution" CHECK (("assessmentId" IS NULL) = ("resolution" = ''));

-- D-19: append-only.
CREATE TRIGGER "SpecialAssessment_append_only" BEFORE UPDATE OR DELETE ON "SpecialAssessment" FOR EACH ROW EXECUTE FUNCTION quorum_append_only();

-- D-58: a declaration names a RESOLUTION of its meeting's definition, while the meeting is open and before its first
-- ballot (the owners vote on the amount as declared).
CREATE FUNCTION quorum_assessment_declaration_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Meeting" m WHERE m.id = NEW."meetingId" AND m."closedAt" IS NOT NULL) THEN
    RAISE EXCEPTION 'meeting % is closed; no special assessment can be declared (D-58)', NEW."meetingId";
  END IF;
  IF EXISTS (SELECT 1 FROM "Ballot" b WHERE b."meetingId" = NEW."meetingId") THEN
    RAISE EXCEPTION 'meeting % already has a ballot; a special assessment is declared before voting starts (D-58)', NEW."meetingId";
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "Meeting" m, jsonb_array_elements(m."definition" -> 'contests') c
    WHERE m.id = NEW."meetingId" AND c ->> 'contest_id' = NEW."contestId" AND c ->> 'kind' = 'RESOLUTION'
  ) THEN
    RAISE EXCEPTION 'contest % is not a resolution of meeting % (D-58)', NEW."contestId", NEW."meetingId";
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "SpecialAssessment_guard" BEFORE INSERT ON "SpecialAssessment" FOR EACH ROW EXECUTE FUNCTION quorum_assessment_declaration_guard();

-- D-58: an assessment run is the declared amount of a resolution that PASSED in a closed meeting of the same org,
-- and carries the resolution id spelled from the meeting ("AM-2026/R2"). The write layer refuses first with words.
CREATE FUNCTION quorum_assessment_run_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  a RECORD;
BEGIN
  IF NEW."assessmentId" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT s."amountCents", s."contestId", m."orgId", m."meetingId", m."closedAt", r."tally" ->> 'result' AS result
    INTO a
    FROM "SpecialAssessment" s JOIN "Meeting" m ON m.id = s."meetingId"
    LEFT JOIN "ContestResult" r ON r."meetingId" = s."meetingId" AND r."contestId" = s."contestId"
    WHERE s.id = NEW."assessmentId";
  IF a."closedAt" IS NULL OR a.result IS DISTINCT FROM 'PASSED' THEN
    RAISE EXCEPTION 'special assessment % did not pass in a closed meeting (result %); nothing is posted (D-58)', NEW."assessmentId", coalesce(a.result, 'none');
  END IF;
  IF a."orgId" <> NEW."orgId" OR a."amountCents" <> NEW."budgetCents" OR NEW."resolution" <> a."meetingId" || '/' || a."contestId" THEN
    RAISE EXCEPTION 'dues run for special assessment % does not match its declaration (org, amount, resolution id) (D-58)', NEW."assessmentId";
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "DuesRun_assessment_guard" BEFORE INSERT ON "DuesRun" FOR EACH ROW EXECUTE FUNCTION quorum_assessment_run_guard();

-- D-43's second door, extended to the new table (CREATE OR REPLACE keeps every existing trigger pointing at it).
CREATE OR REPLACE FUNCTION quorum_refuse_archived_org() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_org UUID;
BEGIN
  IF TG_TABLE_NAME IN ('Unit', 'Owner', 'Meeting', 'DuesRun', 'Violation') THEN
    v_org := NEW."orgId";
  ELSIF TG_TABLE_NAME IN ('UnitShare', 'Ownership', 'LedgerEntry') THEN
    SELECT u."orgId" INTO v_org FROM "Unit" u WHERE u.id = NEW."unitId";
  ELSIF TG_TABLE_NAME IN ('Proxy', 'Ballot', 'ProxyRevocation', 'SpecialAssessment') THEN
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
CREATE TRIGGER "SpecialAssessment_not_archived" BEFORE INSERT ON "SpecialAssessment" FOR EACH ROW EXECUTE FUNCTION quorum_refuse_archived_org();

-- D-33 grants: read and append; nothing more (DuesRun's grants already cover the run).
GRANT SELECT, INSERT ON "SpecialAssessment" TO quorum_app;
