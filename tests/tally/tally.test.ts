// GT-06..GT-13, GT-15..GT-21, GQ-06, GQ-07 (brief §9–§10), then expected_totals.csv, expected_results.csv and
// expected_quorum.csv row for row (task 1.8).
import { describe, expect, it } from 'vitest';
import { RESOLUTION_BASES } from '../../src/tally/codes';
import { RulesInvalid } from '../../src/tally/errors';
import { quorumStatus } from '../../src/tally/quorum';
import { seatsFromTotals } from '../../src/tally/seats';
import { tally, type ElectionTally, type MeetingTally, type ResolutionTally } from '../../src/tally/tally';
import { resolutionPasses } from '../../src/tally/thresholds';
import type { BallotResult } from '../../src/tally/types';
import { loadFixtures, readExpected } from '../../scripts/tally-fixtures';
import { B15, LEDGER, OWNERSHIPS, RULES, SHARES_FLAT, UNITS, ballot, meeting, proxy, ts } from './golden';
import type { ResolutionBasis } from '../../src/tally/codes';

const run = (ballots = B15, basis: ResolutionBasis = 'MAJORITY_OF_VOTES_CAST') => tally(meeting(basis), UNITS, SHARES_FLAT, OWNERSHIPS, LEDGER, [], ballots);
const contest = <T extends ElectionTally | ResolutionTally>(res: MeetingTally, id: string) => res.contests.find((c) => c.contest_id === id) as T;
const P = (basis: ResolutionBasis, yes: number, no: number, yesBps: number, noBps: number, rep: number) =>
  resolutionPasses(basis, { yes, no, yes_bps: yesBps, no_bps: noBps, represented_units: rep, total_units: 120, total_bps: 10000 });

describe('seats T-7..T-9', () => {
  it('GT-06 a boundary tie leaves the seat open', () => {
    expect(seatsFromTotals({ X: 5, Y: 3, Z: 3 }, 2)).toEqual({ elected: ['X'], open_seats: 1, tied: ['Y', 'Z'], result: 'TIE_UNRESOLVED' });
  });
  it('GT-07 a tie that fills exactly the remaining seats is not a tie', () => {
    expect(seatsFromTotals({ X: 5, Y: 5, Z: 1 }, 2)).toEqual({ elected: ['X', 'Y'], open_seats: 0, tied: [], result: 'ELECTED' });
  });
  it('GT-08 a three-way tie for two seats leaves both open', () => {
    expect(seatsFromTotals({ X: 4, Y: 4, Z: 4 }, 2)).toEqual({ elected: [], open_seats: 2, tied: ['X', 'Y', 'Z'], result: 'TIE_UNRESOLVED' });
  });
  it('GT-09 a zero-vote tie is still a tie', () => {
    expect(seatsFromTotals({ X: 3, Y: 0, Z: 0 }, 2)).toEqual({ elected: ['X'], open_seats: 1, tied: ['Y', 'Z'], result: 'TIE_UNRESOLVED' });
  });
  it('candidates must exceed seats', () => {
    expect(() => seatsFromTotals({ X: 1, Y: 2 }, 2)).toThrow(RulesInvalid);
  });
});

describe('thresholds T-1..T-6', () => {
  it('GT-10 MAJORITY_OF_VOTES_CAST: 5-5 fails, 6-5 passes', () => {
    expect([P('MAJORITY_OF_VOTES_CAST', 5, 5, 0, 0, 10), P('MAJORITY_OF_VOTES_CAST', 6, 5, 0, 0, 11)]).toEqual([false, true]);
  });
  it('GT-11 TWO_THIRDS_OF_VOTES_CAST: 2-1 passes (>=), 0-0 fails', () => {
    expect([P('TWO_THIRDS_OF_VOTES_CAST', 2, 1, 0, 0, 3), P('TWO_THIRDS_OF_VOTES_CAST', 0, 0, 0, 0, 3)]).toEqual([true, false]);
  });
  it('GT-12 MAJORITY_OF_ALL_UNITS of 120: 60 fails, 61 passes', () => {
    expect([P('MAJORITY_OF_ALL_UNITS', 60, 0, 0, 0, 85), P('MAJORITY_OF_ALL_UNITS', 61, 0, 0, 0, 85)]).toEqual([false, true]);
  });
  it('GT-13 TWO_THIRDS_OF_ALL_WEIGHTED_SHARES: 6666 bps fails, 6667 passes', () => {
    expect([P('TWO_THIRDS_OF_ALL_WEIGHTED_SHARES', 0, 0, 6666, 0, 85), P('TWO_THIRDS_OF_ALL_WEIGHTED_SHARES', 0, 0, 6667, 0, 85)]).toEqual([false, true]);
  });
  it('the six bases are the brief\'s, in its order', () => {
    expect(RESOLUTION_BASES).toEqual(['MAJORITY_OF_VOTES_CAST', 'MAJORITY_OF_UNITS_REPRESENTED', 'MAJORITY_OF_ALL_UNITS', 'TWO_THIRDS_OF_VOTES_CAST', 'MAJORITY_OF_WEIGHTED_SHARES_CAST', 'TWO_THIRDS_OF_ALL_WEIGHTED_SHARES']);
  });
});

describe('quorum Q-1..Q-4', () => {
  const br = (id: string, unit: string, bps: number, via = ''): BallotResult => ({ ballot_id: id, unit_id: unit, cast_by: 'o', via_proxy_id: via, cast_at: ts('2026-11-14T10:00:00'), status: 'COUNTED', code: '', receipt: 'r', bps, selections: {}, unknown_contests: [] });
  it('GQ-06 2 of 4 units at 50%: met by units, not by weight; the basis decides', () => {
    const q = quorumStatus(RULES, 4, 10000, [br('b1', 'U1', 1000), br('b2', 'U2', 2000)]);
    const qw = quorumStatus({ ...RULES, quorum: { basis: 'WEIGHTED', threshold_bps: 5000 } }, 4, 10000, [br('b1', 'U1', 1000), br('b2', 'U2', 2000)]);
    expect([q.units_met, q.weighted_met, q.met, qw.met]).toEqual([true, false, true, false]);
  });
  it('GQ-07 met only through a proxy: direct 1/4 not met, direct+proxy 2/4 met', () => {
    const q = quorumStatus(RULES, 4, 10000, [br('b1', 'U1', 1000), br('b2', 'U2', 2000, 'P1')]);
    expect([q.direct_units, q.proxy_units, q.direct_only_met, q.met]).toEqual([1, 1, false, true]);
  });
});

describe('the four-unit meeting (GT-15..GT-21)', () => {
  const res = run();
  it('GT-15 statuses, quorum 3/4 units, WEIGHTED elects Y,Z while UNITS would tie three ways', () => {
    const st = Object.fromEntries(res.ballot_results.map((r) => [r.ballot_id, [r.status, r.code]]));
    expect(st).toEqual({ b1: ['COUNTED', ''], b2: ['COUNTED', ''], b3: ['REJECTED', 'DUPLICATE_UNIT'], b4: ['COUNTED', ''], b5: ['REJECTED', 'INELIGIBLE_DELINQUENT'] });
    expect([res.quorum.units_represented, res.quorum.bps_represented, res.quorum.met]).toEqual([3, 7000, true]);
    const e = contest<ElectionTally>(res, 'E');
    expect(e.totals).toEqual({ UNITS: { X: 1, Y: 1, Z: 1 }, WEIGHTED: { X: 1000, Y: 2000, Z: 2000 } });
    expect([e.elected, e.result]).toEqual([['Y', 'Z'], 'ELECTED']);
    expect(e.informational_other_mode).toEqual({ mode: 'UNITS', elected: [], tied: ['X', 'Y', 'Z'], differs: true });
  });
  it('GT-16 resolution totals: the blank is an ABSTAIN; 1-1 fails a majority of votes cast', () => {
    const r = contest<ResolutionTally>(res, 'R');
    expect(r.totals).toEqual({ units: { YES: 1, NO: 1, ABSTAIN: 1 }, bps: { YES: 1000, NO: 2000, ABSTAIN: 4000 } });
    expect([r.result, r.blank]).toEqual(['FAILED', 1]);
  });
  it('GT-17 reversed order gives the same root, commitment and totals', () => {
    const rev = run([...B15].reverse());
    expect(rev.meeting_commitment).toBe(res.meeting_commitment);
    expect(rev.merkle_root).toBe(res.merkle_root);
    expect(rev.contests.map((c) => c.totals)).toEqual(res.contests.map((c) => c.totals));
  });
  it('GT-18 MAJORITY_OF_UNITS_REPRESENTED (1*2 > 3 false) and MAJORITY_OF_WEIGHTED_SHARES_CAST (1000*2 > 3000 false) both fail', () => {
    expect(contest<ResolutionTally>(run(B15, 'MAJORITY_OF_UNITS_REPRESENTED'), 'R').result).toBe('FAILED');
    expect(contest<ResolutionTally>(run(B15, 'MAJORITY_OF_WEIGHTED_SHARES_CAST'), 'R').result).toBe('FAILED');
  });
  it('GT-19 one unit of four is below a 50% quorum: NO_QUORUM on both contests, totals still reported', () => {
    const q = run(B15.slice(0, 1));
    expect([q.quorum.met, contest(q, 'E').result, contest(q, 'R').result]).toEqual([false, 'NO_QUORUM', 'NO_QUORUM']);
    expect(contest<ElectionTally>(q, 'E').totals.WEIGHTED).toEqual({ X: 1000, Y: 0, Z: 0 });
  });
  it('GT-21 owner override: the direct cast supersedes the counted proxy ballot; later casts are duplicates; order-independent', () => {
    const P1 = proxy({ proxy_id: 'P1' });
    const B21 = [
      ballot('p1', 'U1', 'o2', '2026-11-14T10:00:00', { E: ['X'], R: 'YES' }, 'P1'),
      ballot('d1', 'U1', 'o1', '2026-11-14T12:00:00', { E: ['Y'], R: 'NO' }),
      ballot('p2', 'U1', 'o2', '2026-11-14T13:00:00', { E: ['X'], R: 'YES' }, 'P1'),
      ballot('d2', 'U1', 'o1', '2026-11-14T14:00:00', { E: ['Z'], R: 'YES' }),
    ];
    const r21 = tally(meeting(), UNITS, SHARES_FLAT, OWNERSHIPS, LEDGER, [P1], B21);
    const r21r = tally(meeting(), UNITS, SHARES_FLAT, OWNERSHIPS, LEDGER, [P1], [...B21].reverse());
    const st = Object.fromEntries(r21.ballot_results.map((r) => [r.ballot_id, [r.status, r.code]]));
    expect(st).toEqual({ p1: ['REJECTED', 'PROXY_SUPERSEDED_BY_OWNER'], d1: ['COUNTED', ''], p2: ['REJECTED', 'DUPLICATE_UNIT'], d2: ['REJECTED', 'DUPLICATE_UNIT'] });
    expect(r21.quorum.units_represented).toBe(1);
    expect(contest<ResolutionTally>(r21, 'R').totals.units).toEqual({ YES: 0, NO: 1, ABSTAIN: 0 });
    expect(contest<ElectionTally>(r21, 'E').totals.WEIGHTED).toEqual({ X: 0, Y: 1000, Z: 0 });
    expect(r21r.meeting_commitment).toBe(r21.meeting_commitment);
    expect(r21.ballots_rejected).toBe(3);
    expect(r21.rejected_by_code).toEqual({ DUPLICATE_UNIT: 2, PROXY_SUPERSEDED_BY_OWNER: 1 });
  });
  it('shares that do not sum to total_share_bps are RULES_INVALID (D-9)', () => {
    expect(() => tally(meeting(), UNITS, SHARES_FLAT.map((s) => (s.unit_id === 'U4' ? { ...s, share_bps: 3999 } : s)), OWNERSHIPS, LEDGER, [], B15)).toThrow(/RULES_INVALID: total_share_bps/);
  });
});

describe('the fixture agrees with the oracle (task 1.8)', () => {
  const f = loadFixtures();
  const res = tally(f.meeting, f.units, f.shares, f.ownerships, f.ledger, f.proxies, f.ballots);
  const py = (v: unknown) => (typeof v === 'boolean' ? (v ? 'True' : 'False') : String(v));
  const counts = (c: Record<string, number>) => Object.keys(c).sort().map((k) => `${k} ${c[k]}`).join(', ') || 'none';

  it('expected_quorum.csv, every field, plus the merkle root', () => {
    const got: Record<string, string> = { ...Object.fromEntries(Object.entries(res.quorum).map(([k, v]) => [k, py(v)])), merkle_root: res.merkle_root };
    const want = Object.fromEntries(readExpected('expected_quorum').map((r) => [r.field!, r.value!]));
    expect(got).toEqual(want);
    expect(res.quorum.units_represented).toBe(87);
    expect(res.quorum.direct_only_met).toBe(false);
  });
  it('expected_totals.csv, every row', () => {
    const got: string[] = [];
    for (const c of res.contests) {
      if (c.kind === 'ELECTION') for (const mode of ['UNITS', 'WEIGHTED'] as const) for (const k of Object.keys(c.totals[mode]).sort()) got.push(`${c.contest_id},${mode},${k},${c.totals[mode][k]}`);
      else for (const [mode, key] of [['UNITS', 'units'], ['WEIGHTED', 'bps']] as const) for (const k of Object.keys(c.totals[key]).sort()) got.push(`${c.contest_id},${mode},${k},${c.totals[key][k as 'YES']}`);
    }
    const want = readExpected('expected_totals').map((r) => `${r.contest_id},${r.mode},${r.option},${r.value}`);
    expect(got).toEqual(want);
  });
  it('expected_results.csv, every row, and the meeting row', () => {
    const got = res.contests.map((c) =>
      c.kind === 'ELECTION'
        ? [c.contest_id, c.kind, c.mode, c.result, c.elected.join(';'), String(c.open_seats), c.tied.join(';'), String(c.counted_ballots), String(c.voted), String(c.blank), counts(c.void_by_code), c.commitment]
        : [c.contest_id, c.kind, c.basis, c.result, '', '', '', String(c.counted_ballots), String(c.voted), String(c.blank), counts(c.void_by_code), c.commitment],
    );
    got.push(['MEETING', '', '', '', '', '', '', String(res.ballots_received), String(res.ballots_counted), String(res.ballots_rejected), counts(res.rejected_by_code), res.meeting_commitment]);
    const want = readExpected('expected_results').map((r) => [r.contest_id, r.kind, r.mode_or_basis, r.result, r.elected, r.open_seats, r.tied, r.counted, r.voted, r.blank, r.void_or_rejected_by_code, r.commitment]);
    expect(got).toEqual(want);
  });
  it('the traps: E1 differs by mode, E2 tie, R2/R3/R4 fail under their basis and pass under votes cast', () => {
    const e1 = contest<ElectionTally>(res, 'E1');
    expect([e1.elected, e1.informational_other_mode.elected, e1.informational_other_mode.differs]).toEqual([['C-02', 'C-04', 'C-05'], ['C-01', 'C-02', 'C-04'], true]);
    const e2 = contest<ElectionTally>(res, 'E2');
    expect([e2.result, e2.elected, e2.open_seats, e2.tied]).toEqual(['TIE_UNRESOLVED', ['C-12'], 1, ['C-13', 'C-14']]);
    for (const id of ['R2', 'R3', 'R4']) {
      const r = contest<ResolutionTally>(res, id);
      expect(r.result).toBe('FAILED');
      expect(r.passes_by_basis.MAJORITY_OF_VOTES_CAST).toBe(true);
    }
    expect(res.meeting_commitment).toBe('3e6f583ccb0a793735a01944e1a9deaf3289f431e0060e2dfaa11c79bb9337e9');
    expect(res.unknown_contest_keys).toBe(1);
  });
});
