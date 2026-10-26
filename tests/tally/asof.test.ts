// GQ-01..GQ-05 (brief §10) and the fixture's as-of traps (task 1.5): A-301 = 60, B-610 = 151, A-407 → O-138 only,
// delinquent set {A-110, A-204, A-508, B-108, B-509}.
import { describe, expect, it } from 'vitest';
import { balanceCents, delinquentUnits, isMember, ownersOfUnit, shareBps } from '../../src/tally/asof';
import { RulesInvalid } from '../../src/tally/errors';
import { loadFixtures } from '../../scripts/tally-fixtures';
import { OWNERSHIPS, SHARES, day } from './golden';

describe('as-of lookups (E-1..E-5)', () => {
  it('GQ-01 owners as of: to_date is exclusive (sold 2026-06-01)', () => {
    expect(ownersOfUnit(OWNERSHIPS, 'U4', day('2026-05-31'))).toEqual(new Set(['o4old']));
    expect(ownersOfUnit(OWNERSHIPS, 'U4', day('2026-06-01'))).toEqual(new Set(['o4']));
    expect(isMember(OWNERSHIPS, 'o4old', day('2026-11-14'))).toBe(false);
  });
  it('GQ-02 share as of: latest effective_from <= as-of; a future-dated row is ignored', () => {
    expect(shareBps(SHARES, 'U1', day('2026-06-30'))).toBe(1000);
    expect(shareBps(SHARES, 'U1', day('2026-11-14'))).toBe(1200);
    expect(shareBps(SHARES, 'U1', day('2027-01-01'))).toBe(1500);
    expect(() => shareBps(SHARES, 'U1', day('2018-12-31'))).toThrow(RulesInvalid);
  });
  it('GQ-03 a payment the day after the record date does not count', () => {
    const led = [
      { unit_id: 'U1', kind: 'CHARGE' as const, amount_cents: 19600, date: day('2026-11-01') },
      { unit_id: 'U1', kind: 'PAYMENT' as const, amount_cents: 19600, date: day('2026-11-15') },
    ];
    expect([balanceCents(led, 'U1', day('2026-11-14')), balanceCents(led, 'U1', day('2026-11-15'))]).toEqual([19600, 0]);
  });
  it('GQ-04 a payment on the record date counts (inclusive)', () => {
    const led = [
      { unit_id: 'U1', kind: 'CHARGE' as const, amount_cents: 19600, date: day('2026-11-01') },
      { unit_id: 'U1', kind: 'PAYMENT' as const, amount_cents: 19600, date: day('2026-11-14') },
    ];
    expect(balanceCents(led, 'U1', day('2026-11-14'))).toBe(0);
    expect(delinquentUnits(led, ['U1'], day('2026-11-14'))).toEqual(new Set());
  });
  it('GQ-05 an unpaid fine makes a unit delinquent', () => {
    const led = [{ unit_id: 'U1', kind: 'FINE' as const, amount_cents: 15000, date: day('2026-09-20') }];
    expect(balanceCents(led, 'U1', day('2026-11-14'))).toBe(15000);
    expect(delinquentUnits(led, ['U1'], day('2026-11-14'))).toEqual(new Set(['U1']));
  });
});

describe('the fixture as of the record date 2026-11-14 (task 1.5)', () => {
  const f = loadFixtures();
  const asOf = f.meeting.rules.record_date;
  it('A-301 = 60 (amended 2026-07-01), B-610 = 151 (2027 row ignored), shares sum to 10000', () => {
    expect(shareBps(f.shares, 'A-301', asOf)).toBe(60);
    expect(shareBps(f.shares, 'A-302', asOf)).toBe(67);
    expect(shareBps(f.shares, 'B-610', asOf)).toBe(151);
    expect(shareBps(f.shares, 'B-601', asOf)).toBe(56);
    let sum = 0;
    for (const u of f.units) sum += shareBps(f.shares, u.unit_id, asOf);
    expect(sum).toBe(10000);
  });
  it('A-407 sold 2026-08-15: O-138 is the only owner; O-036 is no longer a member', () => {
    expect(ownersOfUnit(f.ownerships, 'A-407', asOf)).toEqual(new Set(['O-138']));
    expect(ownersOfUnit(f.ownerships, 'A-407', day('2026-08-14'))).toEqual(new Set(['O-036']));
    expect(isMember(f.ownerships, 'O-036', asOf)).toBe(false);
    expect(isMember(f.ownerships, 'O-138', asOf)).toBe(true);
  });
  it('delinquent set is {A-110, A-204, A-508, B-108, B-509}; B-307 caught up on the record date', () => {
    const ids = f.units.map((u) => u.unit_id);
    expect([...delinquentUnits(f.ledger, ids, asOf)].sort()).toEqual(['A-110', 'A-204', 'A-508', 'B-108', 'B-509']);
    expect(balanceCents(f.ledger, 'B-307', asOf)).toBe(0);
    expect(balanceCents(f.ledger, 'B-307', day('2026-11-13'))).toBeGreaterThan(0);
    expect(balanceCents(f.ledger, 'A-508', day('2026-11-15'))).toBe(0);
  });
});
