// Task 1.8: Q-1..Q-4 (brief §7; D-15). Integer inequalities only; both modes and direct-only are always reported
// so "quorum met only through proxies" is visible, and rules.quorum.basis picks which one binds.
import type { QuorumBasis } from './codes';
import type { Rules } from './rules';
import type { BallotResult } from './types';

export type QuorumStatus = {
  basis: QuorumBasis;
  threshold_bps: number;
  units_represented: number;
  total_units: number;
  units_met: boolean;
  bps_represented: number;
  total_bps: number;
  weighted_met: boolean;
  direct_units: number;
  proxy_units: number;
  direct_only_met: boolean;
  met: boolean;
};

export function quorumStatus(rules: Rules, totalUnits: number, totalBps: number, results: readonly BallotResult[]): QuorumStatus {
  const counted = results.filter((r) => r.status === 'COUNTED');
  const repUnits = counted.length; // Q-1: one counted ballot = one unit represented
  let repBps = 0;
  let direct = 0;
  for (const r of counted) {
    repBps += r.bps;
    if (r.via_proxy_id === '') direct += 1;
  }
  const thr = rules.quorum.threshold_bps;
  const unitsMet = repUnits * 10000 >= thr * totalUnits; // Q-2
  const weightedMet = repBps * 10000 >= thr * totalBps; // Q-3
  const directOnlyMet = direct * 10000 >= thr * totalUnits;
  const basis = rules.quorum.basis;
  return {
    basis,
    threshold_bps: thr,
    units_represented: repUnits,
    total_units: totalUnits,
    units_met: unitsMet,
    bps_represented: repBps,
    total_bps: totalBps,
    weighted_met: weightedMet,
    direct_units: direct,
    proxy_units: repUnits - direct,
    direct_only_met: directOnlyMet,
    met: basis === 'UNITS' ? unitsMet : weightedMet, // Q-4
  };
}
