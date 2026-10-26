// Task 1.8: T-7/T-8/T-9 — plurality top-N with the boundary tie left open (brief §7; D-17). This file orders
// nothing itself: tally:lint refuses any .sort(, .reverse( or localeCompare here, because a tiebreak hides in
// exactly those calls. The boundary is found by counting, and the decided lists are put in display order by
// canonical.ts's sortedStrings, which can only order ids that are already elected or already tied.
import { sortedStrings } from './canonical';
import { RulesInvalid } from './errors';

export type SeatResult = {
  elected: string[];
  open_seats: number;
  tied: string[];
  result: 'ELECTED' | 'TIE_UNRESOLVED';
};

/**
 * T-8: let v be the votes of the candidate in position `seats` when ranked by votes. Candidates above v are
 * elected; candidates at v are elected only if they exactly fill the remaining seats, otherwise those seats are
 * TIE_UNRESOLVED with the tied ids listed. A zero-vote tie is still a tie (GT-09).
 */
export function seatsFromTotals(totals: Readonly<Record<string, number>>, seats: number): SeatResult {
  const ids = Object.keys(totals);
  if (ids.length <= seats) throw new RulesInvalid('seats', `candidates (${ids.length}) must exceed seats (${seats})`);
  // The boundary value: the largest v with at least `seats` candidates at or above it.
  let boundary = -1;
  for (const id of ids) {
    const v = totals[id]!;
    let atOrAbove = 0;
    for (const other of ids) if (totals[other]! >= v) atOrAbove += 1;
    if (atOrAbove >= seats && v > boundary) boundary = v;
  }
  const above = ids.filter((id) => totals[id]! > boundary);
  const at = ids.filter((id) => totals[id]! === boundary);
  const remaining = seats - above.length;
  if (at.length === remaining) return { elected: sortedStrings([...above, ...at]), open_seats: 0, tied: [], result: 'ELECTED' };
  return { elected: sortedStrings(above), open_seats: remaining, tied: sortedStrings(at), result: 'TIE_UNRESOLVED' };
}
