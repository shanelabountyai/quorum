// Task 1.8: the whole meeting — ballots → quorum → contests → commitments (brief §7–§8; D-15..D-18). Pure and
// deterministic in ballot order: evaluateBallots sorts, merkleRoot sorts, contests are walked in id order.
import { evaluateBallots } from './ballots';
import { shareBps } from './asof';
import { compareStrings } from './canonical';
import { otherMode, type ContestResult, type ElectionMode, type ResolutionBasis, type ResolutionChoice, type SelectionVoidCode } from './codes';
import { contestCommitment, meetingCommitment, merkleRoot } from './commit';
import { RulesInvalid } from './errors';
import { quorumStatus, type QuorumStatus } from './quorum';
import type { Contest, Election, Meeting, Resolution } from './rules';
import { seatsFromTotals } from './seats';
import { passesByBasis } from './thresholds';
import type { Ballot, BallotResult, LedgerEntry, Ownership, Proxy, Unit, UnitShare } from './types';

export type ContestBase = {
  contest_id: string;
  title: string;
  counted_ballots: number;
  voted: number;
  blank: number;
  /** code → count, keys in code order */
  void_by_code: Partial<Record<SelectionVoidCode, number>>;
  result: ContestResult;
  commitment: string;
};

export type ElectionTotals = { UNITS: Record<string, number>; WEIGHTED: Record<string, number> };
export type ElectionTally = ContestBase & {
  kind: 'ELECTION';
  mode: ElectionMode;
  seats: number;
  totals: ElectionTotals;
  elected: string[];
  open_seats: number;
  tied: string[];
  informational_other_mode: { mode: ElectionMode; elected: string[]; tied: string[]; differs: boolean };
};

export type ResolutionTotals = { units: Record<ResolutionChoice, number>; bps: Record<ResolutionChoice, number> };
export type ResolutionTally = ContestBase & {
  kind: 'RESOLUTION';
  basis: ResolutionBasis;
  totals: ResolutionTotals;
  passes_by_basis: Record<ResolutionBasis, boolean>;
};

export type ContestTally = ElectionTally | ResolutionTally;

export type MeetingTally = {
  meeting_id: string;
  record_date: string;
  ballots_received: number;
  ballots_counted: number;
  ballots_rejected: number;
  /** code → count, keys in code order */
  rejected_by_code: Record<string, number>;
  unknown_contest_keys: number;
  quorum: QuorumStatus;
  merkle_root: string;
  contests: ContestTally[];
  meeting_commitment: string;
  ballot_results: BallotResult[];
};

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Counts keyed in code order, as the oracle prints them. */
function countBy<K extends string>(keys: Iterable<K>): Record<string, number> {
  const counts = new Map<string, number>();
  for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
  const out: Record<string, number> = {};
  for (const k of [...counts.keys()].sort(compareStrings)) out[k] = counts.get(k)!;
  return out;
}

function contestBase(c: Contest, counted: readonly BallotResult[]): Omit<ContestBase, 'result' | 'commitment'> {
  const cid = c.contest_id;
  let voted = 0;
  let blank = 0;
  const voids: SelectionVoidCode[] = [];
  for (const r of counted) {
    const s = r.selections[cid]!;
    if (s.status === 'VOTED') voted += 1;
    else if (s.status === 'BLANK') blank += 1;
    else voids.push(s.code);
  }
  return { contest_id: cid, title: c.title, counted_ballots: counted.length, voted, blank, void_by_code: countBy(voids) };
}

export function tallyElection(c: Election, counted: readonly BallotResult[], quorum: QuorumStatus, root: string): ElectionTally {
  const units: Record<string, number> = {};
  const weighted: Record<string, number> = {};
  for (const cand of c.candidates) {
    units[cand.id] = 0;
    weighted[cand.id] = 0;
  }
  for (const r of counted) {
    const s = r.selections[c.contest_id]!;
    if (s.status !== 'VOTED') continue;
    for (const id of s.value as string[]) {
      units[id] = units[id]! + 1; // T-7: one vote per unit per candidate
      weighted[id] = weighted[id]! + r.bps; // T-7: the unit's bps as of the record date
    }
  }
  const binding = c.mode === 'UNITS' ? units : weighted;
  const other = c.mode === 'UNITS' ? weighted : units;
  const seat = seatsFromTotals(binding, c.seats);
  const alt = seatsFromTotals(other, c.seats);
  const totals: ElectionTotals = { UNITS: units, WEIGHTED: weighted };
  return {
    ...contestBase(c, counted),
    kind: 'ELECTION',
    mode: c.mode,
    seats: c.seats,
    totals,
    elected: seat.elected,
    open_seats: seat.open_seats,
    tied: seat.tied,
    result: quorum.met ? seat.result : 'NO_QUORUM', // T-11
    informational_other_mode: { mode: otherMode(c.mode), elected: alt.elected, tied: alt.tied, differs: !sameList(alt.elected, seat.elected) || !sameList(alt.tied, seat.tied) }, // T-10
    commitment: contestCommitment(root, c.contest_id, totals), // C-4
  };
}

export function tallyResolution(c: Resolution, counted: readonly BallotResult[], quorum: QuorumStatus, totalUnits: number, totalBps: number, root: string): ResolutionTally {
  const u = { YES: 0, NO: 0, ABSTAIN: 0 } as Record<ResolutionChoice, number>;
  const w = { YES: 0, NO: 0, ABSTAIN: 0 } as Record<ResolutionChoice, number>;
  for (const r of counted) {
    const s = r.selections[c.contest_id]!;
    if (s.status === 'VOTED') {
      const v = s.value as ResolutionChoice;
      u[v] += 1;
      w[v] += r.bps;
    } else if (s.status === 'BLANK') {
      u.ABSTAIN += 1; // S-1: a blank is an abstention
      w.ABSTAIN += r.bps;
    }
  }
  const by = passesByBasis({ yes: u.YES, no: u.NO, yes_bps: w.YES, no_bps: w.NO, represented_units: quorum.units_represented, total_units: totalUnits, total_bps: totalBps });
  const totals: ResolutionTotals = { units: u, bps: w };
  return {
    ...contestBase(c, counted),
    kind: 'RESOLUTION',
    basis: c.basis,
    totals,
    passes_by_basis: by,
    result: !quorum.met ? 'NO_QUORUM' : by[c.basis] ? 'PASSED' : 'FAILED', // T-11
    commitment: contestCommitment(root, c.contest_id, totals), // C-4
  };
}

export function tally(
  meeting: Meeting,
  units: readonly Unit[],
  shares: readonly UnitShare[],
  ownerships: readonly Ownership[],
  ledger: readonly LedgerEntry[],
  proxies: readonly Proxy[],
  ballots: readonly Ballot[],
): MeetingTally {
  const rules = meeting.rules;
  const results = evaluateBallots(meeting, units, shares, ownerships, ledger, proxies, ballots);
  const asOf = rules.record_date;
  const totalUnits = units.length;
  let totalBps = 0;
  for (const u of units) totalBps += shareBps(shares, u.unit_id, asOf);
  if (totalBps !== rules.total_share_bps) throw new RulesInvalid('total_share_bps', `shares sum to ${totalBps} as of ${asOf}, rules say ${rules.total_share_bps}`); // D-9
  const quorum = quorumStatus(rules, totalUnits, totalBps, results);
  const root = merkleRoot(results.map((r) => r.receipt)); // C-3: over every received ballot
  const counted = results.filter((r) => r.status === 'COUNTED');
  const contests: ContestTally[] = [];
  const commitments: Record<string, string> = {};
  for (const c of [...meeting.contests].sort((a, b) => compareStrings(a.contest_id, b.contest_id))) {
    const t = c.kind === 'ELECTION' ? tallyElection(c, counted, quorum, root) : tallyResolution(c, counted, quorum, totalUnits, totalBps, root);
    commitments[c.contest_id] = t.commitment;
    contests.push(t);
  }
  let unknown = 0;
  for (const r of results) unknown += r.unknown_contests.length;
  return {
    meeting_id: meeting.meeting_id,
    record_date: asOf,
    ballots_received: results.length,
    ballots_counted: counted.length,
    ballots_rejected: results.length - counted.length,
    rejected_by_code: countBy(results.filter((r) => r.status === 'REJECTED').map((r) => r.code)),
    unknown_contest_keys: unknown,
    quorum,
    merkle_root: root,
    contests,
    meeting_commitment: meetingCommitment(commitments), // C-5
    ballot_results: results,
  };
}
