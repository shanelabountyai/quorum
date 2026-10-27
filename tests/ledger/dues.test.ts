// D-21 (task 3.5): the dues run's arithmetic, pure, on the fixture roster. Hand-derived: at 350 cents per bp the
// $35,000 month divides exactly; one extra cent ($35,000.01) leaves 1 cent; one extra dollar ($35,001.00) leaves
// 76 cents — each unit's floor gains floor(bps / 100), which is 1 for the 24 units of 100 bps or more (the 20 3BR
// at 111 and the 4 penthouses at 151) and 0 for the rest, so 100 − 24 = 76 cents go to the ROUNDING line.
import { describe, expect, it } from 'vitest';
import { allocateDues, firstOfMonth, SharesDoNotSum } from '@/ledger/dues';
import { floorShare, formatCents, MoneyError, parseDollars } from '@/ledger/money';
import type { CalendarDay } from '@/tally/time';
import { loadFixtures } from '../../scripts/tally-fixtures';

const f = loadFixtures();
const dec = firstOfMonth('2026-12');

describe('allocateDues (D-21)', () => {
  it('$35,000.00: 120 charges, 350 cents per bp, summing to 3,500,000 with a 0-cent ROUNDING line', () => {
    const a = allocateDues(3_500_000, f.units, f.shares, dec);
    expect(a.charges).toHaveLength(120);
    expect(a.charges.every((c) => c.cents === 350 * c.bps)).toBe(true);
    expect([a.postedCents, a.roundingCents, a.totalBps]).toEqual([3_500_000, 0, 10000]);
    expect(a.charges.find((c) => c.unit_id === 'A-301')!.cents).toBe(21000); // 60 bps since 2026-07-01 (E-3)
  });
  it('$35,000.01 leaves a 1-cent ROUNDING line; $35,001.00 leaves 76 cents (24 units of 100+ bps take one cent each)', () => {
    expect(allocateDues(3_500_001, f.units, f.shares, dec)).toMatchObject({ postedCents: 3_500_000, roundingCents: 1 });
    const b = allocateDues(3_500_100, f.units, f.shares, dec);
    expect(b.charges.filter((c) => c.bps >= 100)).toHaveLength(24);
    expect(b).toMatchObject({ postedCents: 3_500_024, roundingCents: 76 });
  });
  it('the parts always sum to the whole', () => {
    for (const budget of [0, 1, 99, 10_001, 3_499_999, 7_777_777]) {
      const a = allocateDues(budget, f.units, f.shares, dec);
      expect(a.postedCents + a.roundingCents, String(budget)).toBe(budget);
      expect(a.roundingCents).toBeGreaterThanOrEqual(0);
      expect(a.roundingCents).toBeLessThan(120); // at most one cent short per unit
    }
  });
  it('shares are read as of the charge day: B-610 is 151 in 2026-12 and 160 in 2027-01 (with B-601 47), still 10000', () => {
    expect(allocateDues(3_500_000, f.units, f.shares, firstOfMonth('2027-01')).charges.find((c) => c.unit_id === 'B-610')!.bps).toBe(160);
  });
  it('refuses a roster whose shares do not sum to 10000 (D-9), and a malformed month or amount', () => {
    expect(() => allocateDues(100, f.units.slice(1), f.shares, dec)).toThrow(SharesDoNotSum);
    expect(() => firstOfMonth('2026-13')).toThrow(RangeError);
    expect(() => allocateDues(1.5, f.units, f.shares, dec)).toThrow(MoneyError);
    expect(() => allocateDues(-1, f.units, f.shares, '2026-12-01' as CalendarDay)).toThrow(RangeError);
  });
});

describe('money (ported from Gavel, LoanBook lineage)', () => {
  it('floorShare is exact integer floor; no float', () => {
    expect(floorShare(3_500_100, 111, 10000)).toBe(38851); // 3,500,100 × 111 = 388,511,100 → 38851.11 → 38851
    expect(() => floorShare(100, 1, 0)).toThrow(MoneyError);
  });
  it('formats and parses dollars by string', () => {
    expect([formatCents(3_500_000), formatCents(-1205), formatCents(7)]).toEqual(['$35000.00', '-$12.05', '$0.07']);
    expect([parseDollars('35,000.01'), parseDollars('$12.5'), parseDollars('0.07'), parseDollars('12.345'), parseDollars('abc'), parseDollars('-5')]).toEqual([3_500_001, 1250, 7, null, null, null]);
  });
});
