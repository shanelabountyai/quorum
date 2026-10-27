// Task 2.8: the eligibility snapshot as of a meeting's record date — E-4/E-5 reused from the engine, not
// re-implemented, over the LedgerEntry rows — and the O-8 scope rule the Phase 3 screen will apply: owner and
// admin (the board and the manager) see the whole list; a member sees only the units they own. The server action
// arrives with the screen (D-35 j); this is the query and the rule it will call.
import { balanceCents, delinquentUnits, ownersOfUnit } from '@/tally/asof';
import type { CalendarDay } from '@/tally/time';
import type { Role } from '@/generated/prisma/enums';
import { asApp } from './db';
import { readMeeting, readRoster } from './roster';

export type EligibilityRow = { unit_id: string; balance_cents: number; delinquent: boolean; owners: string[] };
export type EligibilitySnapshot = { meeting_id: string; record_date: CalendarDay; suspends_voting: boolean; delinquent_units: string[]; rows: EligibilityRow[] };

export type EligibilityScope = { kind: 'all' } | { kind: 'own-units' };

/** O-8: board and manager roles see every unit; a member sees their own. The foundation's roles stand in for those (D-5). */
export const eligibilityScope = (role: Role): EligibilityScope => (role === 'owner' || role === 'admin' ? { kind: 'all' } : { kind: 'own-units' });

/** The whole snapshot (scope 'all'); the caller narrows to `ownerId`'s units for scope 'own-units' with `forOwner`. */
export const delinquentSnapshot = (meetingRowId: string): Promise<EligibilitySnapshot> =>
  asApp(async (tx) => {
    const head = await readMeeting(tx, meetingRowId);
    const roster = await readRoster(tx, head.orgId);
    const asOf = head.definition.rules.record_date;
    const unitIds = roster.units.map((u) => u.unit_id);
    const delinquent = delinquentUnits(roster.ledger, unitIds, asOf);
    return {
      meeting_id: head.meetingId,
      record_date: asOf,
      suspends_voting: head.definition.rules.delinquency_suspends_voting,
      delinquent_units: [...delinquent].sort(),
      rows: unitIds.map((u) => ({ unit_id: u, balance_cents: balanceCents(roster.ledger, u, asOf), delinquent: delinquent.has(u), owners: [...ownersOfUnit(roster.ownerships, u, asOf)].sort() })),
    };
  });

export const forOwner = (snapshot: EligibilitySnapshot, ownerId: string): EligibilitySnapshot => {
  const rows = snapshot.rows.filter((r) => r.owners.includes(ownerId));
  return { ...snapshot, rows, delinquent_units: rows.filter((r) => r.delinquent).map((r) => r.unit_id) };
};
