// Task 1.5: the as-of rules E-1..E-5 (brief §5; D-9, D-13). Everything here is read "as of" one calendar day
// and nothing here knows what today is.
import { RulesInvalid } from './errors';
import type { CalendarDay } from './time';
import type { LedgerEntry, Ownership, UnitShare } from './types';

/** E-1: an ownership row covers [from_date, to_date); an empty to_date is open. */
const covers = (o: Ownership, asOf: CalendarDay): boolean => o.from_date <= asOf && (o.to_date === '' || o.to_date > asOf);

export function ownersOfUnit(ownerships: readonly Ownership[], unitId: string, asOf: CalendarDay): Set<string> {
  const out = new Set<string>();
  for (const o of ownerships) if (o.unit_id === unitId && covers(o, asOf)) out.add(o.owner_id);
  return out;
}

/** E-2: a member owns at least one unit as of the day. */
export const isMember = (ownerships: readonly Ownership[], ownerId: string, asOf: CalendarDay): boolean =>
  ownerships.some((o) => o.owner_id === ownerId && covers(o, asOf));

/** E-3: the share row with the greatest effective_from <= asOf; later rows are ignored; none is RULES_INVALID. */
export function shareBps(shares: readonly UnitShare[], unitId: string, asOf: CalendarDay): number {
  let best: UnitShare | undefined;
  for (const s of shares) {
    if (s.unit_id !== unitId || s.effective_from > asOf) continue;
    if (!best || s.effective_from > best.effective_from) best = s;
  }
  if (!best) throw new RulesInvalid(`unit_shares.${unitId}`, `no share row effective on or before ${asOf}`);
  return best.share_bps;
}

/** E-4: Σ CHARGE + FINE − Σ (PAYMENT + CREDIT) over entries dated <= asOf (inclusive). Integer cents. A CREDIT reduces like a PAYMENT (D-41). */
export function balanceCents(ledger: readonly LedgerEntry[], unitId: string, asOf: CalendarDay): number {
  let bal = 0;
  for (const e of ledger) {
    if (e.unit_id !== unitId || e.date > asOf) continue;
    if (e.kind === 'CHARGE' || e.kind === 'FINE') bal += e.amount_cents;
    else if (e.kind === 'PAYMENT' || e.kind === 'CREDIT') bal -= e.amount_cents;
    else throw new RulesInvalid('assessments.kind', `unknown ledger kind ${String((e as { kind: unknown }).kind)}`);
  }
  return bal;
}

/** E-5: delinquent iff the balance as of the day is positive. */
export function delinquentUnits(ledger: readonly LedgerEntry[], unitIds: readonly string[], asOf: CalendarDay): Set<string> {
  const out = new Set<string>();
  for (const u of unitIds) if (balanceCents(ledger, u, asOf) > 0) out.add(u);
  return out;
}
