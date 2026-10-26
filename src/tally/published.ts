// Task 1.11: the recount from the published list (C-6, C-7; D-18). The list is `(receipt, ballot_id, status,
// code, choices_canonical)` sorted by receipt, with no unit, caster or timestamp. From it alone anyone recomputes:
// the Merkle root, received/counted/rejected by code, and every UNITS-mode total (by re-running S-1..S-5 on the
// canonical choices of the counted ballots). What it CANNOT recompute, and says so (decisions D-28): the
// WEIGHTED totals and bps_represented, because the frozen list carries no share per ballot. The commitments bind
// both halves, so the recount takes the published WEIGHTED totals as given, checks the UNITS half against the
// published totals, and recomputes the commitments from the root and the published totals.
import { evaluateSelection } from './ballots';
import { compareStrings, type Json, sortedStrings } from './canonical';
import { RESOLUTION_BASES, RESOLUTION_CHOICES, type BallotRejectCode, type ElectionMode, type ResolutionBasis, type ResolutionChoice, type SelectionVoidCode } from './codes';
import { contestCommitment, meetingCommitment, merkleRoot } from './commit';
import type { CsvRow } from './csv';
import { InputInvalid } from './errors';
import { parseChoices } from './load';
import type { Meeting } from './rules';
import { seatsFromTotals, type SeatResult } from './seats';
import { resolutionPasses } from './thresholds';

export type PublishedBallot = {
  receipt: string;
  ballot_id: string;
  status: 'COUNTED' | 'REJECTED';
  code: BallotRejectCode | '';
  choices: Record<string, Json>;
};

export function toPublished(rows: CsvRow[]): PublishedBallot[] {
  return rows.map((r, i) => {
    const w = `published[${i}]`;
    const status = r.status;
    if (status !== 'COUNTED' && status !== 'REJECTED') throw new InputInvalid(`${w}.status`, `unknown status ${String(status)}`);
    if (!/^[0-9a-f]{64}$/.test(r.receipt ?? '')) throw new InputInvalid(`${w}.receipt`, 'expected 64 lowercase hex chars');
    return { receipt: r.receipt!, ballot_id: r.ballot_id ?? '', status, code: (r.code ?? '') as BallotRejectCode | '', choices: parseChoices(r.choices_canonical ?? '', `${w}.choices_canonical`) };
  });
}

/** Published totals as `contest_id → mode → option → value` (the shape of expected_totals.csv). */
export type PublishedTotals = Record<string, Partial<Record<ElectionMode, Record<string, number>>>>;

export function toPublishedTotals(rows: CsvRow[]): PublishedTotals {
  const out: PublishedTotals = {};
  rows.forEach((r, i) => {
    const mode = r.mode;
    if (mode !== 'UNITS' && mode !== 'WEIGHTED') throw new InputInvalid(`totals[${i}].mode`, `unknown mode ${String(mode)}`);
    if (!/^-?\d+$/.test(r.value ?? '')) throw new InputInvalid(`totals[${i}].value`, `expected an integer, got ${JSON.stringify(r.value)}`);
    const byMode = (out[r.contest_id ?? ''] ??= {});
    (byMode[mode] ??= {})[r.option ?? ''] = Number(r.value);
  });
  return out;
}

export type RecountCheck = { name: string; recomputed: string; published: string | undefined; verdict: 'ok' | 'differs' | 'not-recomputable' | 'unpublished' };

export type RecountContest = {
  contest_id: string;
  kind: 'ELECTION' | 'RESOLUTION';
  counted: number;
  voted: number;
  blank: number;
  void_by_code: Record<string, number>;
  /** recomputed from the list */
  units_totals: Record<string, number>;
  /** taken from the published totals; not recomputable from C-6 as frozen */
  weighted_totals: Record<string, number> | undefined;
  /** recomputed in UNITS mode (elections) or under the unit bases (resolutions) */
  units_result: SeatResult | Partial<Record<ResolutionBasis, boolean>>;
  commitment: string | undefined;
};

export type Recount = {
  received: number;
  counted: number;
  rejected: number;
  rejected_by_code: Record<string, number>;
  merkle_root: string;
  contests: RecountContest[];
  meeting_commitment: string | undefined;
  checks: RecountCheck[];
};

const countBy = (keys: readonly string[]): Record<string, number> => {
  const m = new Map<string, number>();
  for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
  const out: Record<string, number> = {};
  for (const k of [...m.keys()].sort(compareStrings)) out[k] = m.get(k)!;
  return out;
};

const fmtCounts = (c: Record<string, number>) => Object.keys(c).sort(compareStrings).map((k) => `${k} ${c[k]}`).join(', ') || 'none';
const fmtTotals = (t: Record<string, number>) => sortedStrings(Object.keys(t)).map((k) => `${k} ${t[k]}`).join(', ');

/**
 * Recount a meeting from its published list. `totalUnits` comes from the published quorum report (the rules JSON
 * carries total_share_bps but not the unit count); `publishedTotals` supplies the WEIGHTED half the list lacks.
 */
export function recountFromPublished(meeting: Meeting, list: readonly PublishedBallot[], publishedTotals: PublishedTotals | undefined, totalUnits: number | undefined): Recount {
  const checks: RecountCheck[] = [];
  const root = merkleRoot(list.map((p) => p.receipt));
  const counted = list.filter((p) => p.status === 'COUNTED');
  const rejected = list.filter((p) => p.status === 'REJECTED');
  const contests: RecountContest[] = [];
  const commitments: Record<string, string> = {};
  let allCommitments = true;
  for (const c of [...meeting.contests].sort((a, b) => compareStrings(a.contest_id, b.contest_id))) {
    const cid = c.contest_id;
    const sel = counted.map((p) => evaluateSelection(c, p.choices[cid]));
    const voted = sel.filter((s) => s.status === 'VOTED').length;
    const blank = sel.filter((s) => s.status === 'BLANK').length;
    const voids = countBy(sel.filter((s) => s.status === 'VOID').map((s) => s.code as SelectionVoidCode));
    const pub = publishedTotals?.[cid];
    let unitsTotals: Record<string, number>;
    let unitsResult: RecountContest['units_result'];
    let totalsJson: Json | undefined;
    if (c.kind === 'ELECTION') {
      unitsTotals = {};
      for (const cand of c.candidates) unitsTotals[cand.id] = 0;
      for (const s of sel) if (s.status === 'VOTED') for (const id of s.value as string[]) unitsTotals[id] = unitsTotals[id]! + 1;
      unitsResult = seatsFromTotals(unitsTotals, c.seats);
      if (pub?.WEIGHTED) totalsJson = { UNITS: unitsTotals, WEIGHTED: pub.WEIGHTED };
    } else {
      const u = { YES: 0, NO: 0, ABSTAIN: 0 } as Record<ResolutionChoice, number>;
      for (const s of sel) {
        if (s.status === 'VOTED') u[s.value as ResolutionChoice] += 1;
        else if (s.status === 'BLANK') u.ABSTAIN += 1;
      }
      unitsTotals = u;
      const unitBases: ResolutionBasis[] = ['MAJORITY_OF_VOTES_CAST', 'MAJORITY_OF_UNITS_REPRESENTED', 'MAJORITY_OF_ALL_UNITS', 'TWO_THIRDS_OF_VOTES_CAST'];
      const by: Partial<Record<ResolutionBasis, boolean>> = {};
      for (const b of unitBases) {
        if (b === 'MAJORITY_OF_ALL_UNITS' && totalUnits === undefined) continue;
        by[b] = resolutionPasses(b, { yes: u.YES, no: u.NO, yes_bps: 0, no_bps: 0, represented_units: counted.length, total_units: totalUnits ?? 0, total_bps: meeting.rules.total_share_bps });
      }
      unitsResult = by;
      if (pub?.WEIGHTED) {
        const w = { YES: 0, NO: 0, ABSTAIN: 0 } as Record<ResolutionChoice, number>;
        for (const k of RESOLUTION_CHOICES) w[k] = pub.WEIGHTED[k] ?? 0;
        totalsJson = { units: u, bps: w };
      }
    }
    checks.push({ name: `${cid} UNITS totals`, recomputed: fmtTotals(unitsTotals), published: pub?.UNITS ? fmtTotals(pub.UNITS) : undefined, verdict: !pub?.UNITS ? 'unpublished' : fmtTotals(unitsTotals) === fmtTotals(pub.UNITS) ? 'ok' : 'differs' });
    checks.push({ name: `${cid} WEIGHTED totals`, recomputed: '(no bps on the published list)', published: pub?.WEIGHTED ? fmtTotals(pub.WEIGHTED) : undefined, verdict: 'not-recomputable' });
    let commitment: string | undefined;
    if (totalsJson !== undefined) {
      commitment = contestCommitment(root, cid, totalsJson);
      commitments[cid] = commitment;
    } else allCommitments = false;
    contests.push({ contest_id: cid, kind: c.kind, counted: counted.length, voted, blank, void_by_code: voids, units_totals: unitsTotals, weighted_totals: pub?.WEIGHTED, units_result: unitsResult, commitment });
  }
  return {
    received: list.length,
    counted: counted.length,
    rejected: rejected.length,
    rejected_by_code: countBy(rejected.map((p) => p.code)),
    merkle_root: root,
    contests,
    meeting_commitment: allCommitments ? meetingCommitment(commitments) : undefined,
    checks,
  };
}

export const RESOLUTION_BASES_UNIT_ONLY = RESOLUTION_BASES.filter((b) => !b.includes('WEIGHTED'));
export { fmtCounts as formatCounts };
