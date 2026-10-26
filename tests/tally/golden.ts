// The four-unit association of docs/domain-brief.md §9–§10, shared by the GT and GQ goldens. Shares
// 1000/2000/3000/4000 bps (sum 10000); U3 delinquent; U4 sold 2026-06-01 (o4old → o4); election E, 2 seats of
// X/Y/Z, WEIGHTED; resolution R with the basis per case; window and record date as the fixture.
import type { Json } from '../../src/tally/canonical';
import type { Election, Meeting, Rules } from '../../src/tally/rules';
import type { CalendarDay, Timestamp } from '../../src/tally/time';
import type { Ballot, LedgerEntry, Ownership, Proxy, Unit, UnitShare } from '../../src/tally/types';
import type { ResolutionBasis } from '../../src/tally/codes';

export const day = (s: string) => s as CalendarDay;
export const ts = (s: string) => s as Timestamp;

export const UNITS: Unit[] = ['U1', 'U2', 'U3', 'U4'].map((u) => ({ unit_id: u }));
export const SHARES: UnitShare[] = [
  { unit_id: 'U1', share_bps: 1000, effective_from: day('2019-01-01') },
  { unit_id: 'U1', share_bps: 1200, effective_from: day('2026-07-01') }, // GQ-02 only
  { unit_id: 'U1', share_bps: 1500, effective_from: day('2027-01-01') },
  { unit_id: 'U2', share_bps: 2000, effective_from: day('2019-01-01') },
  { unit_id: 'U3', share_bps: 3000, effective_from: day('2019-01-01') },
  { unit_id: 'U4', share_bps: 4000, effective_from: day('2019-01-01') },
];
export const SHARES_FLAT = SHARES.filter((s) => s.effective_from === '2019-01-01');
export const OWNERSHIPS: Ownership[] = [
  { unit_id: 'U1', owner_id: 'o1', from_date: day('2019-01-01'), to_date: '' },
  { unit_id: 'U2', owner_id: 'o2', from_date: day('2019-01-01'), to_date: '' },
  { unit_id: 'U2', owner_id: 'o2b', from_date: day('2019-01-01'), to_date: '' },
  { unit_id: 'U3', owner_id: 'o3', from_date: day('2019-01-01'), to_date: '' },
  { unit_id: 'U4', owner_id: 'o4old', from_date: day('2019-01-01'), to_date: day('2026-06-01') },
  { unit_id: 'U4', owner_id: 'o4', from_date: day('2026-06-01'), to_date: '' },
];
export const LEDGER: LedgerEntry[] = [{ unit_id: 'U3', kind: 'CHARGE', amount_cents: 10000, date: day('2026-10-01') }];
export const RULES: Rules = {
  timezone_label: 'America/Chicago',
  record_date: day('2026-11-14'),
  open_at: ts('2026-11-01T09:00:00'),
  close_at: ts('2026-11-14T19:00:00'),
  quorum: { basis: 'UNITS', threshold_bps: 5000 },
  proxy_max_depth: 1,
  proxy_holder_must_be_member: true,
  delinquency_suspends_voting: true,
  duplicate_unit_rule: 'FIRST_VALID_CAST_WINS',
  total_share_bps: 10000,
};
export const ELECTION: Election = {
  contest_id: 'E',
  kind: 'ELECTION',
  title: 'Board',
  seats: 2,
  mode: 'WEIGHTED',
  candidates: [
    { id: 'X', name: 'X' },
    { id: 'Y', name: 'Y' },
    { id: 'Z', name: 'Z' },
  ],
};

export const meeting = (basis: ResolutionBasis = 'MAJORITY_OF_VOTES_CAST'): Meeting => ({
  meeting_id: 'M',
  title: '',
  rules: RULES,
  contests: [ELECTION, { contest_id: 'R', kind: 'RESOLUTION', title: 'R', basis }],
});

export const ballot = (bid: string, unit: string, by: string, at: string, choices: Record<string, Json>, via = '', nonce = '0'.repeat(32)): Ballot => ({
  ballot_id: bid,
  unit_id: unit,
  cast_by: by,
  via_proxy_id: via,
  cast_at: ts(at),
  nonce,
  choices,
});

export const proxy = (p: Partial<Proxy> & Pick<Proxy, 'proxy_id'>): Proxy => ({
  grantor_unit: 'U1',
  grantor_owner: 'o1',
  holder_owner: 'o2',
  received_at: ts('2026-11-05T09:00:00'),
  revoked_at: '',
  ...p,
});

/** GT-15 ballots: U1 YES+[X]; U2 NO+[Y,Z]; U2 co-owner later (duplicate); U4 blank; U3 delinquent. */
export const B15: Ballot[] = [
  ballot('b1', 'U1', 'o1', '2026-11-14T10:00:00', { E: ['X'], R: 'YES' }),
  ballot('b2', 'U2', 'o2', '2026-11-14T10:05:00', { E: ['Z', 'Y'], R: 'NO' }),
  ballot('b3', 'U2', 'o2b', '2026-11-14T10:06:00', { E: ['X'], R: 'YES' }),
  ballot('b4', 'U4', 'o4', '2026-11-14T10:07:00', {}),
  ballot('b5', 'U3', 'o3', '2026-11-14T10:08:00', { E: ['X'], R: 'YES' }),
];
