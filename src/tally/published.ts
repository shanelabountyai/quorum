// Task 1.11, amended by D-37: the recount from the published list (C-6, C-7; D-18). The list is `(receipt,
// ballot_id, status, code, bps_as_of, choices_canonical)` sorted by receipt, with no unit, caster or timestamp.
// Since D-37 it carries each ballot's share as of the record date, so from the list alone — plus the unit count
// from the published quorum report, which the rules JSON does not carry — anyone recomputes the WHOLE tally:
// the Merkle root, received/counted/rejected by code, every total in both modes, units and bps represented, every
// result under the binding rule and under all six bases, and every commitment. The list runs through the same
// function the engine and the Phase 2 recount end in (`resultsFromStored` → `tallyFromResults`), so there is one
// tally, not a second implementation of it.
//
// What the list still cannot give, and the recount says so: the direct/proxy split of the quorum report (no
// proxy flag is published) and anything about who cast a ballot (D-2).
import { compareStrings, type Json } from './canonical';
import type { BallotRejectCode, ElectionMode } from './codes';
import type { CsvRow } from './csv';
import { InputInvalid } from './errors';
import { parseChoices } from './load';
import type { Meeting } from './rules';
import { resultsFromStored, tallyFromResults, type ContestTally, type MeetingTally, type StoredBallot } from './tally';
import type { Timestamp } from './time';

export type PublishedBallot = {
  receipt: string;
  ballot_id: string;
  status: 'COUNTED' | 'REJECTED';
  code: BallotRejectCode | '';
  /** the unit's share as of the record date (E-3); 0 for an UNKNOWN_UNIT ballot (D-37) */
  bps_as_of: number;
  choices: Record<string, Json>;
  choices_canonical: string;
};

export function toPublished(rows: CsvRow[]): PublishedBallot[] {
  return rows.map((r, i) => {
    const w = `published[${i}]`;
    const status = r.status;
    if (status !== 'COUNTED' && status !== 'REJECTED') throw new InputInvalid(`${w}.status`, `unknown status ${String(status)}`);
    if (!/^[0-9a-f]{64}$/.test(r.receipt ?? '')) throw new InputInvalid(`${w}.receipt`, 'expected 64 lowercase hex chars');
    if (!/^\d+$/.test(r.bps_as_of ?? '')) throw new InputInvalid(`${w}.bps_as_of`, `expected a non-negative integer, got ${JSON.stringify(r.bps_as_of)}`);
    const canonical = r.choices_canonical ?? '';
    return {
      receipt: r.receipt!,
      ballot_id: r.ballot_id ?? '',
      status,
      code: (r.code ?? '') as BallotRejectCode | '',
      bps_as_of: Number(r.bps_as_of),
      choices: parseChoices(canonical, `${w}.choices_canonical`),
      choices_canonical: canonical,
    };
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

/** The same totals the engine commits to, in the same `contest → mode → option` shape as expected_totals.csv. */
export function totalsByMode(c: ContestTally): Record<ElectionMode, Record<string, number>> {
  return c.kind === 'ELECTION' ? { UNITS: c.totals.UNITS, WEIGHTED: c.totals.WEIGHTED } : { UNITS: c.totals.units, WEIGHTED: c.totals.bps };
}

export type Recount = { tally: MeetingTally; checks: RecountCheck[] };

const fmtTotals = (t: Readonly<Record<string, number>>) => Object.keys(t).sort(compareStrings).map((k) => `${k} ${t[k]}`).join(', ');

/** A placeholder instant: the list has no timestamps (C-6); the order of results does not enter any total or the root. */
const NO_TIME = '0000-01-01T00:00:00' as Timestamp;

/**
 * Recount a meeting from its published list. `totalUnits` comes from the published quorum report (the rules JSON
 * carries total_share_bps but not the unit count); `publishedTotals`, when given, is compared, never used.
 */
export function recountFromPublished(meeting: Meeting, list: readonly PublishedBallot[], totalUnits: number, publishedTotals?: PublishedTotals): Recount {
  const rows: StoredBallot[] = list.map((p) => ({
    ballot_id: p.ballot_id,
    via_proxy: false, // not published; only the quorum report's direct/proxy split reads it, and that split is reported not-recomputable
    cast_at: NO_TIME,
    bps: p.bps_as_of,
    status: p.status,
    code: p.code,
    receipt: p.receipt,
    choices_canonical: p.choices_canonical,
  }));
  const t = tallyFromResults(meeting, totalUnits, meeting.rules.total_share_bps, resultsFromStored(meeting, rows));
  const checks: RecountCheck[] = [];
  for (const c of t.contests) {
    const mine = totalsByMode(c);
    const pub = publishedTotals?.[c.contest_id];
    for (const mode of ['UNITS', 'WEIGHTED'] as const) {
      const p = pub?.[mode];
      checks.push({ name: `${c.contest_id} ${mode} totals`, recomputed: fmtTotals(mine[mode]), published: p ? fmtTotals(p) : undefined, verdict: !p ? 'unpublished' : fmtTotals(mine[mode]) === fmtTotals(p) ? 'ok' : 'differs' });
    }
  }
  checks.push({ name: 'direct / proxy units', recomputed: '(no proxy flag on the published list)', published: undefined, verdict: 'not-recomputable' });
  return { tally: t, checks };
}
