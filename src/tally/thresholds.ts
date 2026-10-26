// Task 1.8: the six resolution bases T-1..T-6 as integer inequalities (brief §7; D-16). Majorities are strict,
// two-thirds is >=, a tie fails every majority basis. Abstentions are in the denominator of the _REPRESENTED
// and _ALL_ bases (they count against) and absent from _VOTES_CAST.
import { RESOLUTION_BASES, type ResolutionBasis } from './codes';
import { RulesInvalid } from './errors';

export type ResolutionCounts = {
  yes: number;
  no: number;
  yes_bps: number;
  no_bps: number;
  represented_units: number;
  total_units: number;
  total_bps: number;
};

export function resolutionPasses(basis: ResolutionBasis, c: ResolutionCounts): boolean {
  switch (basis) {
    case 'MAJORITY_OF_VOTES_CAST': // T-1
      return c.yes * 2 > c.yes + c.no;
    case 'MAJORITY_OF_UNITS_REPRESENTED': // T-2
      return c.yes * 2 > c.represented_units;
    case 'MAJORITY_OF_ALL_UNITS': // T-3
      return c.yes * 2 > c.total_units;
    case 'TWO_THIRDS_OF_VOTES_CAST': // T-4
      return c.yes + c.no > 0 && c.yes * 3 >= 2 * (c.yes + c.no);
    case 'MAJORITY_OF_WEIGHTED_SHARES_CAST': // T-5
      return c.yes_bps * 2 > c.yes_bps + c.no_bps;
    case 'TWO_THIRDS_OF_ALL_WEIGHTED_SHARES': // T-6
      return c.yes_bps * 3 >= 2 * c.total_bps;
    default:
      throw new RulesInvalid('basis', `unknown ${String(basis)}`);
  }
}

/** Pass/fail under every basis, in the brief's order, for the by-basis table (D-16). */
export function passesByBasis(c: ResolutionCounts): Record<ResolutionBasis, boolean> {
  const out = {} as Record<ResolutionBasis, boolean>;
  for (const b of RESOLUTION_BASES) out[b] = resolutionPasses(b, c);
  return out;
}
