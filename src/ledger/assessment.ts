// D-58 (owner decision, 2026-10-26; the D-47 seam): special assessments. The board DECLARES a resolution of a meeting
// a special assessment of a stated amount while the meeting is open and before its first ballot — the owners then
// vote on that amount, not on one written in afterwards. After close, a declared resolution whose stored result is
// PASSED POSTS once, as one dues run (postRunInTx, the same writer as the monthly dues): each unit is charged
// floor(amount × bps / 10000) with its share as of the charge day (E-3), the remainder on the run's ROUNDING line, and
// every charge carries the resolution id ("AM-2026/R2" on the run and in the memo, "A-AM-2026-R2" as the entry id).
// Refused, in this order: archived org (D-43), not a declared assessment, meeting not closed, not PASSED, already
// posted. The triggers repeat the declaration and posting rules as the second door.
import { audit } from '@/core/audit';
import { Refused } from '@/core/errors';
import { assertNotArchived } from '@/meetings/archive';
import { meetingInOrg, associationZone } from '@/meetings/admin';
import { wallDay } from '@/meetings/clock';
import { asApp, type Tx } from '@/meetings/db';
import type { ContestResult } from '@/tally/codes';
import { calendarDay, type CalendarDay } from '@/tally/time';
import { isUnique, postRunInTx, type DuesRunResult, type Who } from './ledger';
import { assertCents, formatCents, parseDollars } from './money';

/** The resolution id a run and its charges carry: the meeting's public id and the contest id. */
export const resolutionId = (meetingId: string, contestId: string) => `${meetingId}/${contestId}`;
/** The per-unit entry id of an assessment charge (unique per unit, like a dues month's "D-YYYY-MM"). */
export const assessmentEntryId = (meetingId: string, contestId: string) => `A-${meetingId}-${contestId}`;

export type Declaration = { id: string; contestId: string; amountCents: number };

/** `amount` is cents, or dollars as a form typed them (read by string, never parseFloat). */
export const declareAssessment = (who: Who, input: { meetingRowId: string; contestId: string; amount: number | string }): Promise<Declaration> =>
  asApp(async (tx) => {
    const head = await meetingInOrg(tx, who.orgId, input.meetingRowId);
    await tx.$queryRaw`SELECT 1 FROM quorum_lock_meeting(${head.id}::uuid)`; // a cast cannot slip in between the check and the write
    if (head.closedAt) throw new Refused(`This meeting closed at ${head.closedAt}; a special assessment is declared before voting starts.`);
    await assertNotArchived(tx, who.orgId);
    const contest = head.definition.contests.find((c) => c.contest_id === input.contestId);
    if (!contest) throw new Refused(`This meeting has no resolution ${input.contestId}.`);
    if (contest.kind !== 'RESOLUTION') throw new Refused(`${input.contestId} is an election; only a resolution can be a special assessment.`);
    if (await tx.ballot.count({ where: { meetingId: head.id } })) throw new Refused('Voting has started (a ballot is recorded); a special assessment is declared before the first ballot, so owners vote on the amount as declared.');
    const amountCents = typeof input.amount === 'number' ? assertCents(input.amount) : parseDollars(input.amount);
    if (amountCents === null) throw new Refused('Give the amount in dollars and cents, e.g. 180000.00.');
    if (amountCents <= 0) throw new Refused('The amount must be more than zero.');
    if (await tx.specialAssessment.findUnique({ where: { meetingId_contestId: { meetingId: head.id, contestId: contest.contest_id } } })) throw new Refused(`${contest.contest_id} is already declared a special assessment; a declaration is append-only.`);
    try {
      const row = await tx.specialAssessment.create({ data: { meetingId: head.id, contestId: contest.contest_id, amountCents, declaredById: who.userId } });
      await audit(who, 'assessment.declared', { targetType: 'meeting', targetId: head.id, data: { resolution: resolutionId(head.meetingId, contest.contest_id), amountCents } }, tx);
      return { id: row.id, contestId: row.contestId, amountCents: row.amountCents };
    } catch (e) {
      if (isUnique(e)) throw new Refused(`${contest.contest_id} is already declared a special assessment.`);
      throw e;
    }
  });

export type AssessmentRow = { id: string; contestId: string; title: string; amountCents: number; result: ContestResult | null; run: { id: string; chargedOn: string; postedCents: number; roundingCents: number; units: number } | null };

/** A meeting's declarations with their stored result (after close) and their run (once posted). */
export async function assessmentsOf(tx: Tx, meetingRowId: string): Promise<AssessmentRow[]> {
  const head = await tx.meeting.findUniqueOrThrow({ where: { id: meetingRowId }, select: { definition: true } });
  const titles = new Map(((head.definition as { contests?: { contest_id: string; title: string }[] }).contests ?? []).map((c) => [c.contest_id, c.title]));
  const rows = await tx.specialAssessment.findMany({ where: { meetingId: meetingRowId }, orderBy: { contestId: 'asc' }, include: { run: true } });
  const results = new Map((await tx.contestResult.findMany({ where: { meetingId: meetingRowId } })).map((r) => [r.contestId, (r.tally as { result: ContestResult }).result]));
  return rows.map((a) => ({
    id: a.id,
    contestId: a.contestId,
    title: titles.get(a.contestId) ?? '',
    amountCents: a.amountCents,
    result: results.get(a.contestId) ?? null,
    run: a.run ? { id: a.run.id, chargedOn: a.run.chargedOn, postedCents: a.run.postedCents, roundingCents: a.run.roundingCents, units: a.run.units } : null,
  }));
}

/** Post a PASSED special assessment once. `chargedOn` defaults to the association's today (D-51). */
export const postAssessment = (who: Who, input: { meetingRowId: string; contestId: string; chargedOn?: CalendarDay | string }): Promise<DuesRunResult & { resolution: string }> =>
  asApp(async (tx) => {
    const head = await meetingInOrg(tx, who.orgId, input.meetingRowId);
    await tx.$queryRaw`SELECT 1 FROM quorum_lock_meeting(${head.id}::uuid)`; // two posts of one assessment are serialised
    await assertNotArchived(tx, who.orgId);
    const resolution = resolutionId(head.meetingId, input.contestId);
    const declared = await tx.specialAssessment.findUnique({ where: { meetingId_contestId: { meetingId: head.id, contestId: input.contestId } }, include: { run: { select: { chargedOn: true } } } });
    if (!declared) throw new Refused(`${input.contestId} was not declared a special assessment before voting, so it posts nothing (NOT_AN_ASSESSMENT).`);
    if (!head.closedAt) throw new Refused(`Meeting ${head.meetingId} is not closed: ${input.contestId} has no result yet (NOT_PASSED).`);
    const stored = await tx.contestResult.findUnique({ where: { meetingId_contestId: { meetingId: head.id, contestId: input.contestId } } });
    const result = (stored?.tally as { result?: ContestResult } | undefined)?.result ?? 'none';
    if (result !== 'PASSED') throw new Refused(`${input.contestId} did not pass (${result}); nothing is posted (NOT_PASSED).`);
    if (declared.run) throw new Refused(`${input.contestId} was already posted on ${declared.run.chargedOn}; an assessment posts once (ALREADY_POSTED).`);
    let chargedOn: CalendarDay;
    try {
      chargedOn = input.chargedOn ? calendarDay(input.chargedOn, 'chargedOn') : wallDay(await associationZone(tx, who.orgId));
    } catch {
      throw new Refused('Give the charge date as YYYY-MM-DD.');
    }
    const title = head.definition.contests.find((c) => c.contest_id === input.contestId)?.title ?? '';
    try {
      const r = await postRunInTx(tx, who, {
        month: chargedOn.slice(0, 7),
        chargedOn,
        budgetCents: declared.amountCents,
        entryId: assessmentEntryId(head.meetingId, input.contestId),
        memo: `Special assessment ${resolution}: ${title}`.slice(0, 500),
        resolution,
        assessmentId: declared.id,
        action: 'assessment.posted',
      });
      return { ...r, resolution };
    } catch (e) {
      if (isUnique(e)) throw new Refused(`${input.contestId} was already posted (ALREADY_POSTED).`);
      throw e;
    }
  });

export const describeAssessment = (a: { contestId: string; amountCents: number; postedCents: number; roundingCents: number; units: number }) =>
  `${a.contestId}: ${formatCents(a.amountCents)} split over ${a.units} units — charges ${formatCents(a.postedCents)}, ROUNDING ${formatCents(a.roundingCents)}`;
