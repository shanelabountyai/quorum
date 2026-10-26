// The roster and the meeting as the engine reads them (src/tally/types.ts shapes), read as the application role.
// One reader for every write path (cast, close) so the as-of rules run on the same rows everywhere.
import { parseMeeting, type Meeting } from '@/tally/rules';
import type { CalendarDay, Timestamp } from '@/tally/time';
import type { LedgerEntry, Ownership, Proxy, Unit, UnitShare } from '@/tally/types';
import type { Tx } from './db';

export type Roster = { units: Unit[]; shares: UnitShare[]; ownerships: Ownership[]; ledger: LedgerEntry[] };

export async function readRoster(tx: Tx, orgId: string): Promise<Roster> {
  const units = await tx.unit.findMany({ where: { orgId }, orderBy: { unitId: 'asc' } });
  const byRow = new Map(units.map((u) => [u.id, u.unitId]));
  const unitOf = (rowId: string) => byRow.get(rowId)!;
  const shares = await tx.unitShare.findMany({ where: { unit: { orgId } } });
  const ownerships = await tx.ownership.findMany({ where: { unit: { orgId } }, include: { owner: { select: { ownerId: true } } } });
  const ledger = await tx.ledgerEntry.findMany({ where: { unit: { orgId } } });
  return {
    units: units.map((u) => ({ unit_id: u.unitId })),
    shares: shares.map((s) => ({ unit_id: unitOf(s.unitId), share_bps: s.shareBps, effective_from: s.effectiveFrom as CalendarDay })),
    ownerships: ownerships.map((o) => ({ unit_id: unitOf(o.unitId), owner_id: o.owner.ownerId, from_date: o.fromDate as CalendarDay, to_date: (o.toDate ?? '') as CalendarDay | '' })),
    ledger: ledger.map((e) => ({ unit_id: unitOf(e.unitId), kind: e.kind, amount_cents: e.amountCents, date: e.date as CalendarDay })),
  };
}

/**
 * A meeting's proxies in engine shape, keyed as the fixture keys them, plus the row id for the sealed link. The ONE
 * reader of a proxy's revocation: `revoked_at` is the import's Proxy.revokedAt or, failing that, the D-55
 * ProxyRevocation row — the database refuses a row for a proxy the import already revoked, so at most one is set.
 */
export async function readProxies(tx: Tx, meetingRowId: string): Promise<(Proxy & { row_id: string })[]> {
  const rows = await tx.proxy.findMany({ where: { meetingId: meetingRowId }, include: { grantorUnit: { select: { unitId: true } }, grantorOwner: { select: { ownerId: true } }, holderOwner: { select: { ownerId: true } }, revocation: { select: { revokedAt: true } } } });
  return rows.map((p) => ({
    row_id: p.id,
    proxy_id: p.proxyId,
    grantor_unit: p.grantorUnit.unitId,
    grantor_owner: p.grantorOwner.ownerId,
    holder_owner: p.holderOwner.ownerId,
    received_at: p.receivedAt as Timestamp,
    revoked_at: (p.revokedAt ?? p.revocation?.revokedAt ?? '') as Timestamp | '',
  }));
}

export type MeetingHead = { id: string; orgId: string; meetingId: string; salt: string; closedAt: string | null; definition: Meeting };

/** The meeting row with its definition re-validated by the engine's schema on every read (D-35 a). */
export async function readMeeting(tx: Tx, meetingRowId: string): Promise<MeetingHead> {
  const m = await tx.meeting.findUniqueOrThrow({ where: { id: meetingRowId } });
  return { id: m.id, orgId: m.orgId, meetingId: m.meetingId, salt: m.salt, closedAt: m.closedAt, definition: parseMeeting(m.definition) };
}
