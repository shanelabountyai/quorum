// Task 2.3: the roster and the meeting, from fixture-shaped rows into one org, write-once. A second run with the
// same rows writes nothing and reports the match column by column (Bookable A-045: a count cannot see a column);
// a second run with different rows refuses before writing anything. Runs as the application role (D-33: INSERT
// on the roster tables is granted; the meeting's result columns are not).
import { randomBytes } from 'node:crypto';
import { canonicalJson, sha256Hex } from '@/tally/canonical';
import type { Meeting } from '@/tally/rules';
import type { LedgerEntry, Ownership, Proxy, Unit, UnitShare } from '@/tally/types';
import type { Tx } from './db';

export type OwnerRow = { owner_id: string; name: string; email: string };
export type UnitRow = Unit & { unit_type?: string; building?: string; floor?: number };
export type RosterInput = { units: readonly UnitRow[]; shares: readonly UnitShare[]; owners: readonly OwnerRow[]; ownerships: readonly Ownership[]; ledger: readonly LedgerEntry[] };
export type LoadReport = { table: string; wanted: number; existing: number; inserted: number };

export class RosterDiffers extends Error {
  constructor(readonly table: string, readonly detail: string) {
    super(`roster differs on ${table}: ${detail}`);
    this.name = 'RosterDiffers';
  }
}

/** The rows a table should hold, as canonical strings, against the rows it holds; equal → nothing to write. */
function reconcile(table: string, wanted: readonly string[], existing: readonly string[]): 'insert' | 'match' {
  if (existing.length === 0) return 'insert';
  const have = new Set(existing);
  const want = new Set(wanted);
  const missing = wanted.find((w) => !have.has(w));
  const extra = existing.find((e) => !want.has(e));
  if (missing !== undefined || extra !== undefined || have.size !== want.size) {
    throw new RosterDiffers(table, missing !== undefined ? `missing ${missing}` : extra !== undefined ? `unexpected ${extra}` : `${have.size} rows, wanted ${want.size}`);
  }
  return 'match';
}

export async function loadRoster(tx: Tx, orgId: string, input: RosterInput): Promise<LoadReport[]> {
  const report: LoadReport[] = [];
  const note = (table: string, wanted: number, existing: number, inserted: number) => report.push({ table, wanted, existing, inserted });

  // Unit
  const unitsWanted = input.units.map((u) => canonicalJson({ unitId: u.unit_id, unitType: u.unit_type ?? '', building: u.building ?? '', floor: u.floor ?? 0 }));
  const unitsHave = await tx.unit.findMany({ where: { orgId }, orderBy: { unitId: 'asc' } });
  if (reconcile('Unit', unitsWanted, unitsHave.map((u) => canonicalJson({ unitId: u.unitId, unitType: u.unitType, building: u.building, floor: u.floor }))) === 'insert') {
    await tx.unit.createMany({ data: input.units.map((u) => ({ orgId, unitId: u.unit_id, unitType: u.unit_type ?? '', building: u.building ?? '', floor: u.floor ?? 0 })) });
    note('Unit', unitsWanted.length, 0, unitsWanted.length);
  } else note('Unit', unitsWanted.length, unitsHave.length, 0);
  const unitIdOf = new Map((await tx.unit.findMany({ where: { orgId } })).map((u) => [u.unitId, u.id]));
  const needUnit = (id: string, where: string) => {
    const v = unitIdOf.get(id);
    if (!v) throw new RosterDiffers(where, `unknown unit ${id}`);
    return v;
  };

  // UnitShare
  const sharesWanted = input.shares.map((s) => canonicalJson({ unitId: s.unit_id, shareBps: s.share_bps, effectiveFrom: s.effective_from }));
  const sharesHave = await tx.unitShare.findMany({ where: { unit: { orgId } }, include: { unit: true } });
  if (reconcile('UnitShare', sharesWanted, sharesHave.map((s) => canonicalJson({ unitId: s.unit.unitId, shareBps: s.shareBps, effectiveFrom: s.effectiveFrom }))) === 'insert') {
    await tx.unitShare.createMany({ data: input.shares.map((s) => ({ unitId: needUnit(s.unit_id, 'UnitShare'), shareBps: s.share_bps, effectiveFrom: s.effective_from })) });
    note('UnitShare', sharesWanted.length, 0, sharesWanted.length);
  } else note('UnitShare', sharesWanted.length, sharesHave.length, 0);

  // Owner
  const ownersWanted = input.owners.map((o) => canonicalJson({ ownerId: o.owner_id, name: o.name, email: o.email }));
  const ownersHave = await tx.owner.findMany({ where: { orgId } });
  if (reconcile('Owner', ownersWanted, ownersHave.map((o) => canonicalJson({ ownerId: o.ownerId, name: o.name, email: o.email }))) === 'insert') {
    await tx.owner.createMany({ data: input.owners.map((o) => ({ orgId, ownerId: o.owner_id, name: o.name, email: o.email })) });
    note('Owner', ownersWanted.length, 0, ownersWanted.length);
  } else note('Owner', ownersWanted.length, ownersHave.length, 0);
  const ownerIdOf = new Map((await tx.owner.findMany({ where: { orgId } })).map((o) => [o.ownerId, o.id]));
  const needOwner = (id: string, where: string) => {
    const v = ownerIdOf.get(id);
    if (!v) throw new RosterDiffers(where, `unknown owner ${id}`);
    return v;
  };

  // Ownership
  const ownershipsWanted = input.ownerships.map((o) => canonicalJson({ unitId: o.unit_id, ownerId: o.owner_id, fromDate: o.from_date, toDate: o.to_date === '' ? null : o.to_date }));
  const ownershipsHave = await tx.ownership.findMany({ where: { unit: { orgId } }, include: { unit: true, owner: true } });
  if (reconcile('Ownership', ownershipsWanted, ownershipsHave.map((o) => canonicalJson({ unitId: o.unit.unitId, ownerId: o.owner.ownerId, fromDate: o.fromDate, toDate: o.toDate }))) === 'insert') {
    await tx.ownership.createMany({ data: input.ownerships.map((o) => ({ unitId: needUnit(o.unit_id, 'Ownership'), ownerId: needOwner(o.owner_id, 'Ownership'), fromDate: o.from_date, toDate: o.to_date === '' ? null : o.to_date })) });
    note('Ownership', ownershipsWanted.length, 0, ownershipsWanted.length);
  } else note('Ownership', ownershipsWanted.length, ownershipsHave.length, 0);

  // LedgerEntry
  const ledgerWanted = input.ledger.map((e, i) => canonicalJson({ unitId: e.unit_id, entryId: entryIdOf(e, i), kind: e.kind, amountCents: e.amount_cents, date: e.date, memo: memoOf(e) }));
  const ledgerHave = await tx.ledgerEntry.findMany({ where: { unit: { orgId } }, include: { unit: true } });
  if (reconcile('LedgerEntry', ledgerWanted, ledgerHave.map((e) => canonicalJson({ unitId: e.unit.unitId, entryId: e.entryId, kind: e.kind, amountCents: e.amountCents, date: e.date, memo: e.memo }))) === 'insert') {
    await tx.ledgerEntry.createMany({ data: input.ledger.map((e, i) => ({ unitId: needUnit(e.unit_id, 'LedgerEntry'), entryId: entryIdOf(e, i), kind: e.kind, amountCents: e.amount_cents, date: e.date, memo: memoOf(e) })) });
    note('LedgerEntry', ledgerWanted.length, 0, ledgerWanted.length);
  } else note('LedgerEntry', ledgerWanted.length, ledgerHave.length, 0);

  return report;
}

/** assessments.csv carries entry_id and memo beside the engine's four columns; a bare engine row gets a positional id. */
const entryIdOf = (e: LedgerEntry & { entry_id?: string }, i: number) => e.entry_id ?? `L-${String(i + 1).padStart(5, '0')}`;
const memoOf = (e: LedgerEntry & { memo?: string }) => e.memo ?? '';

export type MeetingRow = { id: string; meetingId: string; definitionHash: string; salt: string; created: boolean };

/**
 * The meeting from its parsed definition (the engine's Meeting). definitionHash is SHA-256 of the canonical JSON;
 * a second call with the same definition returns the row, a different definition for the same meetingId refuses.
 * `salt` is 128 random bits unless the caller supplies one (tests and the replay do, for a reproducible unitHash).
 */
export async function ensureMeeting(tx: Tx, orgId: string, definition: Meeting, salt?: string): Promise<MeetingRow> {
  const definitionHash = sha256Hex(canonicalJson(definition));
  const have = await tx.meeting.findUnique({ where: { orgId_meetingId: { orgId, meetingId: definition.meeting_id } } });
  if (have) {
    if (have.definitionHash !== definitionHash) throw new RosterDiffers('Meeting', `${definition.meeting_id} exists with definitionHash ${have.definitionHash}, wanted ${definitionHash}`);
    return { id: have.id, meetingId: have.meetingId, definitionHash, salt: have.salt, created: false };
  }
  const row = await tx.meeting.create({ data: { orgId, meetingId: definition.meeting_id, title: definition.title, definition: JSON.parse(canonicalJson(definition)), definitionHash, salt: salt ?? randomBytes(16).toString('hex') } });
  return { id: row.id, meetingId: row.meetingId, definitionHash, salt: row.salt, created: true };
}

export async function loadProxies(tx: Tx, orgId: string, meetingRowId: string, proxies: readonly Proxy[]): Promise<LoadReport> {
  const wanted = proxies.map((p) => canonicalJson({ proxyId: p.proxy_id, grantorUnit: p.grantor_unit, grantorOwner: p.grantor_owner, holderOwner: p.holder_owner, receivedAt: p.received_at, revokedAt: p.revoked_at === '' ? null : p.revoked_at }));
  const have = await tx.proxy.findMany({ where: { meetingId: meetingRowId }, include: { grantorUnit: true, grantorOwner: true, holderOwner: true } });
  if (reconcile('Proxy', wanted, have.map((p) => canonicalJson({ proxyId: p.proxyId, grantorUnit: p.grantorUnit.unitId, grantorOwner: p.grantorOwner.ownerId, holderOwner: p.holderOwner.ownerId, receivedAt: p.receivedAt, revokedAt: p.revokedAt }))) === 'match') {
    return { table: 'Proxy', wanted: wanted.length, existing: have.length, inserted: 0 };
  }
  const unitIdOf = new Map((await tx.unit.findMany({ where: { orgId } })).map((u) => [u.unitId, u.id]));
  const ownerIdOf = new Map((await tx.owner.findMany({ where: { orgId } })).map((o) => [o.ownerId, o.id]));
  const need = <T>(m: Map<string, T>, k: string, what: string) => {
    const v = m.get(k);
    if (v === undefined) throw new RosterDiffers('Proxy', `unknown ${what} ${k}`);
    return v;
  };
  await tx.proxy.createMany({
    data: proxies.map((p) => ({
      meetingId: meetingRowId,
      proxyId: p.proxy_id,
      grantorUnitId: need(unitIdOf, p.grantor_unit, 'unit'),
      grantorOwnerId: need(ownerIdOf, p.grantor_owner, 'owner'),
      holderOwnerId: need(ownerIdOf, p.holder_owner, 'owner'),
      receivedAt: p.received_at,
      revokedAt: p.revoked_at === '' ? null : p.revoked_at,
    })),
  });
  return { table: 'Proxy', wanted: wanted.length, existing: 0, inserted: wanted.length };
}
