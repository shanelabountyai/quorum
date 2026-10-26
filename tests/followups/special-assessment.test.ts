// Owner decision 2026-10-26 (D-58, builds the D-47 seam): a PASSED resolution that was declared a special assessment
// (with its amount, before the first ballot) posts once, as one dues run: each unit is charged
// floor(amount × bps / 10000) with the shares as of the charge day (E-3), the remainder on the run's ROUNDING line
// (D-21/D-47), and every charge carries the resolution id. Refused: not passed, not an assessment, already posted,
// archived org. The fixture's R2 (the $180,000 roof assessment) FAILED, so the refusal is proved on R2 through the
// whole fixture replay; the posting is proved on a separate meeting built here — no frozen fixture is touched.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/core/db';
import { Refused } from '@/core/errors';
import { createMeeting } from '@/meetings/admin';
import { archiveOrg } from '@/meetings/archive';
import { castBallot } from '@/meetings/cast';
import { closeMeeting } from '@/meetings/close';
import { asApp, asOwner } from '@/meetings/db';
import { loadRoster } from '@/meetings/load';
import { declareAssessment, postAssessment } from '@/ledger/assessment';
import { shareBps } from '@/tally/asof';
import type { CalendarDay, Timestamp } from '@/tally/time';
import { emptyDatabase, REPLAY_CLOSED_AT, replayFixture } from '../../scripts/tally-eval-db';
import { ensureOrg } from '../../scripts/quorum-load';
import { loadRosterFixtures } from '../../scripts/tally-fixtures';

const fixtureMeeting = JSON.parse(readFileSync('fixtures/meeting.json', 'utf8'));
const DEC_1 = '2026-12-01' as CalendarDay;

describe('D-58 on the fixture: R2 (the roof assessment) FAILED, so it cannot be posted', () => {
  let orgId = '';
  let meetingRowId = '';
  let board = '';
  beforeAll(async () => {
    await emptyDatabase();
    orgId = await ensureOrg('assessment-fixture');
    board = (await db.user.create({ data: { email: 'treasurer@example.test' } })).id;
    // R2 is declared an assessment of $180,000.00 = 18,000,000 cents before the first of the 113 fixture ballots
    const replay = await replayFixture(orgId, undefined, (m) => declareAssessment({ orgId, userId: board }, { meetingRowId: m, contestId: 'R2', amount: '$180,000.00' }).then(() => undefined));
    meetingRowId = replay.meetingRowId;
    await closeMeeting(meetingRowId, REPLAY_CLOSED_AT);
  }, 120_000);

  it('the declaration is stored: R2, 18,000,000 cents', async () => {
    expect(await db.specialAssessment.findMany({ where: { meetingId: meetingRowId } })).toEqual([expect.objectContaining({ contestId: 'R2', amountCents: 18_000_000, declaredById: board })]);
  });

  it('R2 FAILED (TWO_THIRDS_OF_ALL_WEIGHTED_SHARES): posting is refused NOT_PASSED and writes nothing', async () => {
    expect((await db.contestResult.findFirstOrThrow({ where: { meetingId: meetingRowId, contestId: 'R2' } })).tally).toMatchObject({ result: 'FAILED' });
    const before = await db.ledgerEntry.count();
    await expect(postAssessment({ orgId, userId: board }, { meetingRowId, contestId: 'R2', chargedOn: DEC_1 })).rejects.toThrow(/R2 did not pass \(FAILED\).*NOT_PASSED/);
    expect(await db.ledgerEntry.count()).toBe(before);
    expect(await db.duesRun.count()).toBe(0);
  });

  it('R1 PASSED but was never declared an assessment: refused NOT_AN_ASSESSMENT', async () => {
    expect((await db.contestResult.findFirstOrThrow({ where: { meetingId: meetingRowId, contestId: 'R1' } })).tally).toMatchObject({ result: 'PASSED' });
    await expect(postAssessment({ orgId, userId: board }, { meetingRowId, contestId: 'R1', chargedOn: DEC_1 })).rejects.toThrow(/NOT_AN_ASSESSMENT/);
  });

  it('a declaration on a closed meeting is refused', async () => {
    await expect(declareAssessment({ orgId, userId: board }, { meetingRowId, contestId: 'R3', amount: '1000.00' })).rejects.toThrow(/closed/);
  });

  it('the database is the second door: no run for a FAILED assessment, no declaration on a closed meeting, no edit of a declaration', async () => {
    const r2 = await db.specialAssessment.findFirstOrThrow({ where: { meetingId: meetingRowId, contestId: 'R2' } });
    const run = asOwner((tx) => tx.duesRun.create({ data: { orgId, month: '2026-12', chargedOn: '2026-12-01', budgetCents: 18_000_000, totalBps: 10_000, postedCents: 18_000_000, roundingCents: 0, units: 120, resolution: 'AM-2026/R2', assessmentId: r2.id } }));
    await expect(run).rejects.toThrow(/did not pass in a closed meeting \(result FAILED\)/);
    await expect(asOwner((tx) => tx.specialAssessment.create({ data: { meetingId: meetingRowId, contestId: 'R3', amountCents: 100 } }))).rejects.toMatchObject({ name: 'MeetingClosed' });
    await expect(asOwner((tx) => tx.specialAssessment.update({ where: { id: r2.id }, data: { amountCents: 1 } }))).rejects.toMatchObject({ name: 'AppendOnlyViolation', detail: 'SpecialAssessment is append-only (D-19)' });
    const grants = await db.$queryRaw<{ p: string }[]>`SELECT privilege_type AS p FROM information_schema.role_table_grants WHERE grantee = 'quorum_app' AND table_name = 'SpecialAssessment' ORDER BY 1`;
    expect(grants.map((g) => g.p)).toEqual(['INSERT', 'SELECT']);
  });
});

describe('D-58 posting a PASSED assessment, on a meeting built in the test', () => {
  let orgId = '';
  let meetingRowId = '';
  let board = '';
  const def = {
    ...fixtureMeeting,
    meeting_id: 'AM-SA',
    title: 'Special meeting: assessments',
    rules: { ...fixtureMeeting.rules, quorum: { basis: 'UNITS', threshold_bps: 0 } },
    contests: [
      { contest_id: 'E1', kind: 'ELECTION', title: 'Board', seats: 1, mode: 'WEIGHTED', candidates: [{ id: 'C-1', name: 'One' }, { id: 'C-2', name: 'Two' }] },
      { contest_id: 'SA1', kind: 'RESOLUTION', title: 'Special assessment of $180,000.01 (rounding demonstration)', basis: 'MAJORITY_OF_VOTES_CAST' },
      { contest_id: 'SA2', kind: 'RESOLUTION', title: 'Special assessment of $35,001.00 (rounding demonstration)', basis: 'MAJORITY_OF_VOTES_CAST' },
      { contest_id: 'SA3', kind: 'RESOLUTION', title: 'Special assessment of $500.00 that fails', basis: 'MAJORITY_OF_VOTES_CAST' },
    ],
  };
  const who = () => ({ orgId, userId: board });
  const cast = (unitId: string, castBy: string, castAt: string) =>
    castBallot({ meetingRowId, unitId, castBy, viaProxyId: '', castAt: castAt as Timestamp, choices: { E1: ['C-1'], SA1: 'YES', SA2: 'YES', SA3: 'NO' } });

  beforeAll(async () => {
    await emptyDatabase();
    orgId = await ensureOrg('assessment-pass');
    await asApp((tx) => loadRoster(tx, orgId, loadRosterFixtures()));
    board = (await db.user.create({ data: { email: 'treasurer@example.test' } })).id;
    meetingRowId = (await createMeeting(orgId, JSON.stringify(def))).id;
  }, 60_000);

  it('declaring refuses an election, an unknown contest, a zero or malformed amount', async () => {
    await expect(declareAssessment(who(), { meetingRowId, contestId: 'E1', amount: '100.00' })).rejects.toThrow(/E1 is an election/);
    await expect(declareAssessment(who(), { meetingRowId, contestId: 'R9', amount: '100.00' })).rejects.toThrow(/no resolution R9/);
    await expect(declareAssessment(who(), { meetingRowId, contestId: 'SA1', amount: '0.00' })).rejects.toThrow(/more than zero/);
    await expect(declareAssessment(who(), { meetingRowId, contestId: 'SA1', amount: '180000.015' })).rejects.toThrow(/dollars/);
  });

  it('declares SA1 = $180,000.01 → 18,000,001 cents, SA2 = $35,001.00 → 3,500,100 cents, SA3 = $500.00 → 50,000 cents; a second declaration is refused', async () => {
    expect(await declareAssessment(who(), { meetingRowId, contestId: 'SA1', amount: '$180,000.01' })).toMatchObject({ contestId: 'SA1', amountCents: 18_000_001 });
    expect(await declareAssessment(who(), { meetingRowId, contestId: 'SA2', amount: '35001' })).toMatchObject({ amountCents: 3_500_100 });
    expect(await declareAssessment(who(), { meetingRowId, contestId: 'SA3', amount: '500.00' })).toMatchObject({ amountCents: 50_000 });
    await expect(declareAssessment(who(), { meetingRowId, contestId: 'SA1', amount: '1.00' })).rejects.toThrow(/already declared/);
  });

  it('posting before the meeting closes is refused: there is no result yet', async () => {
    await expect(postAssessment(who(), { meetingRowId, contestId: 'SA1', chargedOn: DEC_1 })).rejects.toThrow(/not closed/);
  });

  it('after the first ballot nothing more can be declared (owners voted on the amounts as declared)', async () => {
    expect(await cast('A-101', 'O-001', '2026-11-05T10:00:00')).toMatchObject({ status: 'COUNTED' });
    expect(await cast('A-102', 'O-002', '2026-11-05T10:05:00')).toMatchObject({ status: 'COUNTED' });
    const late = await createMeeting(orgId, JSON.stringify({ ...def, meeting_id: 'AM-SA-UNUSED' })); // a fresh meeting is still declarable…
    expect(late.id).not.toBe(meetingRowId);
    await expect(declareAssessment(who(), { meetingRowId, contestId: 'SA3', amount: '1.00' })).rejects.toThrow(/ballot/); // …this one is not
    await expect(asOwner((tx) => tx.specialAssessment.create({ data: { meetingId: late.id, contestId: 'E1', amountCents: 100 } }))).rejects.toThrow(/not a resolution/); // the trigger, for an election
    await expect(asOwner((tx) => tx.specialAssessment.create({ data: { meetingId: meetingRowId, contestId: 'SA3X', amountCents: 100 } }))).rejects.toThrow(/already has a ballot/); // the trigger, after the first ballot
    await closeMeeting(meetingRowId, '2026-11-14T19:30:00' as Timestamp);
    const results = await db.contestResult.findMany({ where: { meetingId: meetingRowId }, orderBy: { contestId: 'asc' } });
    expect(results.map((r) => [r.contestId, (r.tally as { result: string }).result])).toEqual([['E1', 'ELECTED'], ['SA1', 'PASSED'], ['SA2', 'PASSED'], ['SA3', 'FAILED']]);
  });

  it('SA1 $180,000.01 = 18,000,001 cents over 10000 bps: floor(18,000,001 × bps / 10000) = 1,800 × bps per unit, 120 charges = 18,000,000 cents, ROUNDING line 1 cent', async () => {
    const r = await postAssessment(who(), { meetingRowId, contestId: 'SA1', chargedOn: DEC_1 });
    expect(r.allocation).toMatchObject({ budgetCents: 18_000_001, totalBps: 10_000, postedCents: 18_000_000, roundingCents: 1 });
    const run = await db.duesRun.findUniqueOrThrow({ where: { id: r.runId }, include: { entries: true } });
    expect(run).toMatchObject({ month: '2026-12', chargedOn: '2026-12-01', resolution: 'AM-SA/SA1', budgetCents: 18_000_001, postedCents: 18_000_000, roundingCents: 1, units: 120, postedById: board });
    expect(run.entries).toHaveLength(120);
    const roster = loadRosterFixtures();
    const units = new Map((await db.unit.findMany({ where: { orgId } })).map((u) => [u.id, u.unitId]));
    let sum = 0;
    for (const e of run.entries) {
      // every charge carries the resolution id, and is the unit's share of the amount to the cent
      expect(e).toMatchObject({ kind: 'CHARGE', entryId: 'A-AM-SA-SA1', date: '2026-12-01', memo: expect.stringContaining('AM-SA/SA1') });
      expect(e.amountCents).toBe(1800 * shareBps(roster.shares, units.get(e.unitId)!, DEC_1));
      sum += e.amountCents;
    }
    expect(sum + run.roundingCents).toBe(18_000_001);
    expect(await db.auditEvent.findFirstOrThrow({ where: { orgId, action: 'assessment.posted', targetId: r.runId } })).toMatchObject({ actorUserId: board, data: { resolution: 'AM-SA/SA1', budgetCents: 18_000_001, postedCents: 18_000_000, roundingCents: 1 } });
  });

  it('SA2 $35,001.00 = 3,500,100 cents: 350 × bps + floor(bps / 100) per unit — the 24 units of 100+ bps gain 1 cent — 3,500,024 posted, ROUNDING line 76 cents (D-47), in the same month as SA1', async () => {
    const r = await postAssessment(who(), { meetingRowId, contestId: 'SA2', chargedOn: DEC_1 });
    expect(r.allocation).toMatchObject({ budgetCents: 3_500_100, postedCents: 3_500_024, roundingCents: 76 });
    expect(r.allocation.charges.filter((c) => c.cents === 350 * c.bps + 1)).toHaveLength(24);
    expect(await db.ledgerEntry.count({ where: { entryId: 'A-AM-SA-SA2' } })).toBe(120);
  });

  it('a second posting of SA1 is refused ALREADY_POSTED, by the write layer and by the unique index', async () => {
    await expect(postAssessment(who(), { meetingRowId, contestId: 'SA1', chargedOn: '2027-01-01' as CalendarDay })).rejects.toThrow(/SA1 was already posted.*ALREADY_POSTED/);
    expect(await db.duesRun.count({ where: { resolution: 'AM-SA/SA1' } })).toBe(1);
  });

  it('SA3 FAILED: refused NOT_PASSED', async () => {
    await expect(postAssessment(who(), { meetingRowId, contestId: 'SA3', chargedOn: DEC_1 })).rejects.toThrow(/SA3 did not pass \(FAILED\).*NOT_PASSED/);
  });

  it('the monthly dues run for 2026-12 still posts once beside the assessments (one month, one dues run)', async () => {
    const { runDues } = await import('@/ledger/ledger');
    expect((await runDues(who(), '2026-12', 3_500_000)).allocation.roundingCents).toBe(0);
    await expect(runDues(who(), '2026-12', 3_500_000)).rejects.toThrow(/already posted/);
  });

  it('an archived org posts nothing', async () => {
    const m2 = (await createMeeting(orgId, JSON.stringify({ ...def, meeting_id: 'AM-SA-2' }))).id;
    await declareAssessment(who(), { meetingRowId: m2, contestId: 'SA1', amount: '100.00' });
    await archiveOrg(orgId, board, 'test');
    await expect(postAssessment(who(), { meetingRowId: m2, contestId: 'SA1', chargedOn: DEC_1 })).rejects.toThrow(Refused);
    await expect(postAssessment(who(), { meetingRowId: m2, contestId: 'SA1', chargedOn: DEC_1 })).rejects.toThrow(/archived/);
  });
});
