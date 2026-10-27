// D-21: the monthly dues run, pure. Each unit is charged floor(budget × share / total) with the share as of the
// charge day (E-3); the remainder is the association's ROUNDING line, so charges + rounding = budget exactly. The
// shares must sum to exactly 10000 bps on the charge day (D-9), or the run refuses — the same invariant the tally
// enforces as RULES_INVALID.
import { shareBps } from '@/tally/asof';
import type { CalendarDay } from '@/tally/time';
import type { Unit, UnitShare } from '@/tally/types';
import { assertCents, floorShare } from './money';

export const TOTAL_SHARE_BPS = 10000;

export type DuesCharge = { unit_id: string; bps: number; cents: number };
export type DuesAllocation = { charges: DuesCharge[]; totalBps: number; postedCents: number; roundingCents: number; budgetCents: number };

export class SharesDoNotSum extends Error {
  constructor(readonly day: CalendarDay, readonly total: number) {
    super(`shares sum to ${total} bps on ${day}, not ${TOTAL_SHARE_BPS} (D-9); no dues were posted`);
    this.name = 'SharesDoNotSum';
  }
}

export function allocateDues(budgetCents: number, units: readonly Unit[], shares: readonly UnitShare[], day: CalendarDay): DuesAllocation {
  assertCents(budgetCents);
  if (budgetCents < 0) throw new RangeError('a dues budget is not negative');
  const bpsOf = units.map((u) => ({ unit_id: u.unit_id, bps: shareBps(shares, u.unit_id, day) }));
  let totalBps = 0;
  for (const u of bpsOf) totalBps += u.bps;
  if (totalBps !== TOTAL_SHARE_BPS) throw new SharesDoNotSum(day, totalBps);
  const charges = bpsOf.map((u) => ({ ...u, cents: floorShare(budgetCents, u.bps, totalBps) }));
  let postedCents = 0;
  for (const c of charges) postedCents += c.cents;
  return { charges, totalBps, postedCents, roundingCents: budgetCents - postedCents, budgetCents };
}

/** "YYYY-MM" → its first day, the day the run's charges are dated (as the fixture ledger dates its dues). */
export function firstOfMonth(month: string): CalendarDay {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new RangeError(`expected YYYY-MM, got ${JSON.stringify(month)}`);
  return `${month}-01` as CalendarDay;
}
