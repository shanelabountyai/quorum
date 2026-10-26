// Task 1.6: ballot evaluation. The §4 precedence (B-1..B-3, P-1..P-8, E-6..E-9), the §6 selection rules
// (S-1..S-5), and the one pass over ballots in (cast_at, ballot_id) order that makes the result a property of the
// SET of ballots, not of their arrival order (B-4, D-7, D-10, D-26).
import { delinquentUnits, isMember, ownersOfUnit, shareBps } from './asof';
import { compareStrings, type Json, sortedStrings } from './canonical';
import { RESOLUTION_CHOICES, type BallotRejectCode, type ResolutionChoice } from './codes';
import { receiptFor } from './commit';
import { InputInvalid } from './errors';
import type { Contest, Meeting, Rules } from './rules';
import { isTimestamp } from './time';
import type { Ballot, BallotResult, LedgerEntry, Ownership, Proxy, Selection, Unit, UnitShare } from './types';

/** The roster the ballot rules read, resolved once per tally as of the record date. */
export type Roster = {
  unitIds: ReadonlySet<string>;
  ownerships: readonly Ownership[];
  proxies: ReadonlyMap<string, Proxy>;
  /** empty unless rules.delinquency_suspends_voting */
  delinquent: ReadonlySet<string>;
};

/** unit_id → via_proxy_id of the unit's COUNTED ballot ('' = direct). */
export type CountedUnits = ReadonlyMap<string, string>;

/**
 * B-1..B-3, P-1..P-8, E-6..E-9 in precedence order; '' means the ballot counts.
 * E-9 (D-26): a direct cast by an owner of record, after a counted PROXY ballot for the unit, returns '' — the
 * caller re-labels the earlier proxy ballot PROXY_SUPERSEDED_BY_OWNER. Any other second cast is DUPLICATE_UNIT.
 */
export function ballotRejectCode(b: Ballot, rules: Rules, roster: Roster, counted: CountedUnits): BallotRejectCode | '' {
  const asOf = rules.record_date;
  if (!roster.unitIds.has(b.unit_id)) return 'UNKNOWN_UNIT'; // B-1
  if (!isTimestamp(b.cast_at)) throw new InputInvalid(`ballots.${b.ballot_id}.cast_at`, `malformed ${JSON.stringify(b.cast_at)}`);
  if (b.cast_at < rules.open_at) return 'EARLY'; // B-2
  if (b.cast_at >= rules.close_at) return 'LATE'; // B-3: the close instant itself is late
  if (b.via_proxy_id !== '') {
    const p = roster.proxies.get(b.via_proxy_id);
    if (!p) return 'PROXY_UNKNOWN'; // P-1
    if (p.grantor_unit !== b.unit_id) return 'PROXY_UNIT_MISMATCH'; // P-2
    if (!ownersOfUnit(roster.ownerships, p.grantor_unit, asOf).has(p.grantor_owner)) return 'PROXY_GRANTOR_NOT_OWNER'; // P-3
    if (p.received_at >= rules.close_at || p.received_at > b.cast_at) return 'PROXY_LATE'; // P-4
    if (p.revoked_at !== '' && p.revoked_at <= b.cast_at) return 'PROXY_REVOKED'; // P-5
    if (b.cast_by !== p.holder_owner) {
      let chained = false;
      for (const q of roster.proxies.values()) if (q.grantor_owner === p.holder_owner && q.holder_owner === b.cast_by) chained = true;
      return chained ? 'PROXY_CHAIN' : 'PROXY_HOLDER_MISMATCH'; // P-6 / P-7
    }
    if (rules.proxy_holder_must_be_member && !isMember(roster.ownerships, p.holder_owner, asOf)) return 'PROXY_HOLDER_NOT_MEMBER'; // P-8
  } else if (!ownersOfUnit(roster.ownerships, b.unit_id, asOf).has(b.cast_by)) {
    return 'NOT_OWNER'; // E-6
  }
  if (rules.delinquency_suspends_voting && roster.delinquent.has(b.unit_id)) return 'INELIGIBLE_DELINQUENT'; // E-7
  const prior = counted.get(b.unit_id);
  if (prior !== undefined) {
    if (b.via_proxy_id === '' && prior !== '') return ''; // E-9: the owner's own direct cast supersedes the proxy ballot
    return 'DUPLICATE_UNIT'; // E-8: first valid cast wins
  }
  return '';
}

const isBlank = (v: Json | undefined): boolean => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/** S-1..S-5 for one contest on one counted ballot. The ballot stays counted; only this contest's selection is affected. */
export function evaluateSelection(contest: Contest, value: Json | undefined): Selection {
  if (isBlank(value)) return { status: 'BLANK', code: '', value: null }; // S-1
  if (contest.kind === 'ELECTION') {
    if (!Array.isArray(value) || !value.every((x) => typeof x === 'string')) return { status: 'VOID', code: 'INVALID_CHOICE', value: null }; // S-2
    const ids = new Set(contest.candidates.map((c) => c.id));
    const picks = value as string[];
    if (picks.some((x) => !ids.has(x))) return { status: 'VOID', code: 'UNKNOWN_CANDIDATE', value: null }; // S-3
    if (new Set(picks).size !== picks.length) return { status: 'VOID', code: 'DUPLICATE_CANDIDATE', value: null }; // S-4
    if (picks.length > contest.seats) return { status: 'VOID', code: 'OVERVOTE', value: null }; // S-5: exactly `seats` is a vote
    return { status: 'VOTED', code: '', value: sortedStrings(picks) };
  }
  if (typeof value !== 'string' || !(RESOLUTION_CHOICES as readonly string[]).includes(value)) return { status: 'VOID', code: 'INVALID_CHOICE', value: null }; // S-2
  return { status: 'VOTED', code: '', value: value as ResolutionChoice };
}

/** B-4: (cast_at, ballot_id) ascending. Equal instants fall to the lower ballot id. */
export const castOrder = (a: Ballot, b: Ballot): number => compareStrings(a.cast_at, b.cast_at) || compareStrings(a.ballot_id, b.ballot_id);

export function buildRoster(rules: Rules, units: readonly Unit[], ownerships: readonly Ownership[], ledger: readonly LedgerEntry[], proxies: readonly Proxy[]): Roster {
  const unitIds = new Set(units.map((u) => u.unit_id));
  return {
    unitIds,
    ownerships,
    proxies: new Map(proxies.map((p) => [p.proxy_id, p])),
    delinquent: rules.delinquency_suspends_voting ? delinquentUnits(ledger, sortedStrings([...unitIds]), rules.record_date) : new Set(),
  };
}

/** Every ballot evaluated once in cast order (B-4); the input order is irrelevant. Output is in cast order too. */
export function evaluateBallots(
  meeting: Meeting,
  units: readonly Unit[],
  shares: readonly UnitShare[],
  ownerships: readonly Ownership[],
  ledger: readonly LedgerEntry[],
  proxies: readonly Proxy[],
  ballots: readonly Ballot[],
): BallotResult[] {
  const rules = meeting.rules;
  const asOf = rules.record_date;
  const roster = buildRoster(rules, units, ownerships, ledger, proxies);
  const contests = new Map(meeting.contests.map((c) => [c.contest_id, c]));
  const countedUnits = new Map<string, string>();
  const countedResult = new Map<string, BallotResult>();
  const out: BallotResult[] = [];
  for (const b of [...ballots].sort(castOrder)) {
    const code = ballotRejectCode(b, rules, roster, countedUnits);
    const r: BallotResult = {
      ballot_id: b.ballot_id,
      unit_id: b.unit_id,
      cast_by: b.cast_by,
      via_proxy_id: b.via_proxy_id,
      cast_at: b.cast_at,
      status: code ? 'REJECTED' : 'COUNTED',
      code,
      receipt: receiptFor(b.ballot_id, b.nonce, b.choices),
      bps: roster.unitIds.has(b.unit_id) ? shareBps(shares, b.unit_id, asOf) : 0,
      selections: {},
      unknown_contests: [],
    };
    if (!code) {
      const prev = countedResult.get(b.unit_id);
      if (prev) {
        // E-9: the earlier proxy ballot is superseded; its receipt stays in the root, its selections leave every total.
        prev.status = 'REJECTED';
        prev.code = 'PROXY_SUPERSEDED_BY_OWNER';
        prev.selections = {};
        prev.unknown_contests = [];
      }
      countedUnits.set(b.unit_id, b.via_proxy_id);
      countedResult.set(b.unit_id, r);
      for (const [cid, c] of contests) r.selections[cid] = evaluateSelection(c, b.choices[cid]);
      r.unknown_contests = sortedStrings(Object.keys(b.choices).filter((k) => !contests.has(k)));
    }
    out.push(r);
  }
  return out;
}
