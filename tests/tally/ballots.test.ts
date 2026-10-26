// GQ-08..GQ-11 and GT-14 (brief §9–§10), then every row of fixtures/expected_ballots.csv on status, code and
// selection_codes (task 1.6). The expected file is the oracle's; it is read here and in tally:eval only.
import { describe, expect, it } from 'vitest';
import { ballotRejectCode, evaluateBallots, evaluateSelection, type Roster } from '../../src/tally/ballots';
import type { Resolution } from '../../src/tally/rules';
import { InputInvalid } from '../../src/tally/errors';
import type { Proxy } from '../../src/tally/types';
import { loadFixtures, readExpected } from '../../scripts/tally-fixtures';
import { ELECTION, OWNERSHIPS, RULES, ballot, meeting, proxy, ts, LEDGER, SHARES_FLAT, UNITS } from './golden';

const roster = (proxies: Proxy[], delinquent: string[] = []): Roster => ({
  unitIds: new Set(['U1', 'U2', 'U3', 'U4']),
  ownerships: OWNERSHIPS,
  proxies: new Map(proxies.map((p) => [p.proxy_id, p])),
  delinquent: new Set(delinquent),
});
const reject = (b: ReturnType<typeof ballot>, proxies: Proxy[], counted: Record<string, string> = {}, delinquent: string[] = []) =>
  ballotRejectCode(b, RULES, roster(proxies, delinquent), new Map(Object.entries(counted)));

const P1 = proxy({ proxy_id: 'P1' });
const P2 = proxy({ proxy_id: 'P2', grantor_unit: 'U2', grantor_owner: 'o2', holder_owner: 'o3', received_at: ts('2026-11-06T09:00:00') });
const at = '2026-11-14T10:00:00';

describe('selection rules S-1..S-5', () => {
  it('GT-14 codes and precedence; exactly N selections is a vote', () => {
    const ev = (v: unknown) => {
      const s = evaluateSelection(ELECTION, v as never);
      return [s.status, s.code];
    };
    expect(ev(['X', 'Y', 'Z'])).toEqual(['VOID', 'OVERVOTE']);
    expect(ev(['X', 'X'])).toEqual(['VOID', 'DUPLICATE_CANDIDATE']);
    expect(ev(['Q'])).toEqual(['VOID', 'UNKNOWN_CANDIDATE']);
    expect(ev('X')).toEqual(['VOID', 'INVALID_CHOICE']);
    expect(ev([])).toEqual(['BLANK', '']);
    expect(ev(['Q', 'Q', 'X'])).toEqual(['VOID', 'UNKNOWN_CANDIDATE']);
    expect(ev(['Y', 'X'])).toEqual(['VOTED', '']);
    expect(evaluateSelection(ELECTION, ['Y', 'X']).value).toEqual(['X', 'Y']);
  });
  it('resolutions: YES/NO/ABSTAIN vote, MAYBE is INVALID_CHOICE, null and "" are BLANK', () => {
    const R: Resolution = { contest_id: 'R', kind: 'RESOLUTION', title: 'R', basis: 'MAJORITY_OF_VOTES_CAST' };
    expect(evaluateSelection(R, 'ABSTAIN')).toEqual({ status: 'VOTED', code: '', value: 'ABSTAIN' });
    expect(evaluateSelection(R, 'MAYBE').code).toBe('INVALID_CHOICE');
    expect(evaluateSelection(R, ['YES']).code).toBe('INVALID_CHOICE');
    expect(evaluateSelection(R, null).status).toBe('BLANK');
    expect(evaluateSelection(R, '').status).toBe('BLANK');
    expect(evaluateSelection(R, undefined).status).toBe('BLANK');
  });
});

describe('ballot reject precedence (§4)', () => {
  it('GQ-08 LATE before DUPLICATE_UNIT; INELIGIBLE_DELINQUENT before DUPLICATE_UNIT; 18:59:59 counts; the close instant is LATE', () => {
    expect(reject(ballot('x', 'U1', 'o1', '2026-11-14T19:00:00', {}), [], { U1: '' })).toBe('LATE');
    expect(reject(ballot('y', 'U3', 'o3', at, {}), [], { U3: '' }, ['U3'])).toBe('INELIGIBLE_DELINQUENT');
    expect(reject(ballot('z', 'U1', 'o1', '2026-11-14T18:59:59', {}), [])).toBe('');
    expect(reject(ballot('w', 'U1', 'o1', at, {}), [], { U1: '' })).toBe('DUPLICATE_UNIT');
  });
  it('GQ-09 holder casts OK; the holder\'s own holder is PROXY_CHAIN; anyone else PROXY_HOLDER_MISMATCH; wrong unit PROXY_UNIT_MISMATCH', () => {
    expect(reject(ballot('a', 'U1', 'o2', at, {}, 'P1'), [P1, P2])).toBe('');
    expect(reject(ballot('b', 'U1', 'o3', at, {}, 'P1'), [P1, P2])).toBe('PROXY_CHAIN');
    expect(reject(ballot('c', 'U1', 'o4', at, {}, 'P1'), [P1, P2])).toBe('PROXY_HOLDER_MISMATCH');
    expect(reject(ballot('d', 'U2', 'o2', at, {}, 'P1'), [P1, P2])).toBe('PROXY_UNIT_MISMATCH');
  });
  it('GQ-10 PROXY_LATE both ways, PROXY_REVOKED, a former owner cannot hold or grant, NOT_OWNER', () => {
    const P3 = proxy({ proxy_id: 'P3', received_at: ts('2026-11-14T19:05:00') });
    const P4 = proxy({ proxy_id: 'P4', received_at: ts('2026-11-13T12:00:00') });
    const P5 = proxy({ proxy_id: 'P5', revoked_at: ts('2026-11-10T09:00:00') });
    const P6 = proxy({ proxy_id: 'P6', holder_owner: 'o4old' });
    const P7 = proxy({ proxy_id: 'P7', grantor_unit: 'U4', grantor_owner: 'o4old', holder_owner: 'o1' });
    expect(reject(ballot('a', 'U1', 'o2', '2026-11-14T18:30:00', {}, 'P3'), [P3])).toBe('PROXY_LATE');
    expect(reject(ballot('b', 'U1', 'o2', '2026-11-12T10:00:00', {}, 'P4'), [P4])).toBe('PROXY_LATE');
    expect(reject(ballot('c', 'U1', 'o2', '2026-11-12T11:00:00', {}, 'P5'), [P5])).toBe('PROXY_REVOKED');
    expect(reject(ballot('d', 'U1', 'o4old', at, {}, 'P6'), [P6])).toBe('PROXY_HOLDER_NOT_MEMBER');
    expect(reject(ballot('e', 'U4', 'o1', at, {}, 'P7'), [P7])).toBe('PROXY_GRANTOR_NOT_OWNER');
    expect(reject(ballot('f', 'U4', 'o4old', at, {}), [])).toBe('NOT_OWNER');
    expect(reject(ballot('g', 'U1', 'o2', at, {}, 'P9'), [P1])).toBe('PROXY_UNKNOWN');
    expect(reject(ballot('h', 'U9', 'o1', at, {}), [])).toBe('UNKNOWN_UNIT');
    expect(reject(ballot('i', 'U1', 'o1', '2026-10-31T10:00:00', {}), [])).toBe('EARLY');
  });
  it('GQ-11 E-8/E-9: direct after a counted proxy counts; proxy after proxy, proxy after direct, direct after direct are DUPLICATE_UNIT', () => {
    expect(reject(ballot('a', 'U1', 'o1', at, {}), [P1], { U1: 'P1' })).toBe('');
    expect(reject(ballot('b', 'U1', 'o2', at, {}, 'P1'), [P1], { U1: 'P1' })).toBe('DUPLICATE_UNIT');
    expect(reject(ballot('c', 'U1', 'o2', at, {}, 'P1'), [P1], { U1: '' })).toBe('DUPLICATE_UNIT');
    expect(reject(ballot('d', 'U1', 'o1', at, {}), [P1], { U1: '' })).toBe('DUPLICATE_UNIT');
  });
  it('a malformed cast_at throws INPUT_INVALID naming the ballot (review log)', () => {
    const bad = { ...ballot('m', 'U1', 'o1', at, {}), cast_at: '2026-11-14 10:00' as never };
    expect(() => reject(bad, [])).toThrow(InputInvalid);
    expect(() => evaluateBallots(meeting(), UNITS, SHARES_FLAT, OWNERSHIPS, LEDGER, [], [bad])).toThrow(/ballots\.m\.cast_at/);
  });
});

describe('every fixture ballot agrees with the oracle (task 1.6)', () => {
  const f = loadFixtures();
  const results = evaluateBallots(f.meeting, f.units, f.shares, f.ownerships, f.ledger, f.proxies, f.ballots);
  const byId = new Map(results.map((r) => [r.ballot_id, r]));
  const expected = readExpected('expected_ballots');
  it('113 ballots, 87 counted, 26 rejected', () => {
    expect(results.length).toBe(113);
    expect(results.filter((r) => r.status === 'COUNTED').length).toBe(87);
  });
  it.each(expected.map((e) => [e.ballot_id!, e] as const))('%s status, code, bps, receipt and selection_codes', (id, e) => {
    const r = byId.get(id)!;
    expect(r).toBeDefined();
    const codes = Object.keys(r.selections)
      .sort()
      .map((cid) => `${cid}:${r.selections[cid]!.status}${r.selections[cid]!.code ? ':' + r.selections[cid]!.code : ''}`)
      .join(';');
    expect([r.unit_id, r.status, r.code, String(r.bps), r.receipt, codes]).toEqual([e.unit_id, e.status, e.code, e.bps, e.receipt, e.selection_codes]);
  });
  it('the named traps land on the named ballots (brief §3)', () => {
    const code = (id: string) => byId.get(id)!.code;
    expect(code('B-088')).toBe('PROXY_SUPERSEDED_BY_OWNER'); // A-402, D-26
    expect(byId.get('B-029')!.status).toBe('COUNTED');
    expect(code('B-065')).toBe('DUPLICATE_UNIT'); // proxy after proxy
    expect(code('B-020')).toBe('DUPLICATE_UNIT'); // proxy after owner
    expect(code('B-064')).toBe('DUPLICATE_UNIT'); // same instant, higher id
    expect(code('B-073')).toBe('LATE'); // 19:00:00 exactly
    expect(code('B-092')).toBe('PROXY_LATE'); // proxy received after the ballot
    expect(code('B-104')).toBe('PROXY_CHAIN');
    expect(code('B-063')).toBe('INELIGIBLE_DELINQUENT'); // A-508 paid 11-15
    expect(byId.get('B-038')!.selections.R1!.status).toBe('BLANK'); // the blank ballot
    expect(byId.get('B-062')!.unknown_contests).toEqual(['R9']);
  });
});
