// Tasks 2.1, 2.2, 2.10: what the first Quorum migration must have made of the database — no date or timestamp
// column on the meeting axis (D-8, D-35 b), the enums equal to src/tally/codes.ts (Bookable's constraint-vs-
// TypeScript rule), every append-only table refusing UPDATE and DELETE with the table's name in the message,
// and the application role holding exactly the privileges D-33 lists. Runs against the migrated database; CI
// applies the migrations from scratch first.
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/core/db';
import { BALLOT_REJECT_CODES } from '@/tally/codes';
import { asApp, asOwner } from '@/meetings/db';
import { AppendOnlyViolation, CheckViolation, PrivilegeDenied } from '@/meetings/errors';
import { resetAuthTables } from '../helpers/auth';

const QUORUM_TABLES = ['Unit', 'UnitShare', 'Owner', 'Ownership', 'LedgerEntry', 'Meeting', 'Proxy', 'Ballot', 'BallotStatusEvent', 'BallotSecret', 'ContestResult'];
const APPEND_ONLY = ['Ballot', 'BallotStatusEvent', 'BallotSecret', 'Proxy', 'LedgerEntry', 'ContestResult'];

type Col = { table: string; column: string; type: string };
const columns = () =>
  db.$queryRaw<Col[]>`SELECT table_name AS "table", column_name AS "column", data_type AS "type" FROM information_schema.columns WHERE table_schema = current_schema() ORDER BY 1, 2`;

describe('2.1 schema shape', () => {
  it('every Quorum table exists and the billing tables are gone (D-27 c)', async () => {
    const names = new Set((await columns()).map((c) => c.table));
    for (const t of QUORUM_TABLES) expect(names.has(t), t).toBe(true);
    expect(names.has('BillingAccount')).toBe(false);
    expect(names.has('StripeEvent')).toBe(false);
  });

  it('no date column anywhere; the only timestamp columns on Quorum tables are Meeting.createdAt and Meeting.sealedAt (D-35 b)', async () => {
    const cols = (await columns()).filter((c) => QUORUM_TABLES.includes(c.table));
    expect(cols.filter((c) => c.type === 'date')).toEqual([]);
    const stamps = cols.filter((c) => /timestamp/.test(c.type)).map((c) => `${c.table}.${c.column}`);
    expect(stamps.sort()).toEqual(['Meeting.createdAt', 'Meeting.sealedAt']);
    // and every meeting-axis instant or day is a fixed-width CHAR with a CHECK (the regex is the engine's)
    const chars = cols.filter((c) => c.type === 'character').map((c) => `${c.table}.${c.column}`);
    for (const want of ['UnitShare.effectiveFrom', 'Ownership.fromDate', 'Ownership.toDate', 'LedgerEntry.date', 'Meeting.closedAt', 'Proxy.receivedAt', 'Proxy.revokedAt', 'Ballot.castAt', 'BallotStatusEvent.at']) expect(chars, want).toContain(want);
  });

  it('a malformed day or instant is refused by CHECK, with the constraint named (D-8)', async () => {
    await resetAuthTables();
    const org = await db.org.create({ data: { slug: 'schema-a', name: 'a' } });
    const unit = await db.unit.create({ data: { orgId: org.id, unitId: 'U1' } });
    const bad = asOwner((tx) => tx.unitShare.create({ data: { unitId: unit.id, shareBps: 1, effectiveFrom: '2026-1-01 ' } }));
    await expect(bad).rejects.toMatchObject({ name: 'CheckViolation', sqlState: '23514', detail: expect.stringContaining('UnitShare_effectiveFrom_day') });
    await expect(asOwner((tx) => tx.ledgerEntry.create({ data: { unitId: unit.id, entryId: 'L1', kind: 'CHARGE', amountCents: -1, date: '2026-01-01' } }))).rejects.toBeInstanceOf(CheckViolation);
    await expect(asOwner((tx) => tx.ownership.create({ data: { unitId: unit.id, ownerId: unit.id, fromDate: '2026-01-01', toDate: '2026-01-01' } }))).rejects.toMatchObject({ detail: expect.stringMatching(/Ownership_half_open|Ownership_ownerId_fkey|foreign key/) });
  });
});

describe('2.10 the enums equal the TypeScript tuples', () => {
  const labels = async (type: string) =>
    (await db.$queryRaw<{ l: string }[]>`SELECT e.enumlabel AS l FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = ${type} ORDER BY e.enumsortorder`).map((r) => r.l);
  it('BallotCode is BALLOT_REJECT_CODES, same members, same precedence order', async () => {
    expect(await labels('BallotCode')).toEqual([...BALLOT_REJECT_CODES]);
  });
  it('BallotStatus is COUNTED | REJECTED and LedgerKind the three kinds E-4 reads', async () => {
    expect(await labels('BallotStatus')).toEqual(['COUNTED', 'REJECTED']);
    expect(await labels('LedgerKind')).toEqual(['CHARGE', 'PAYMENT', 'FINE']);
  });
});

describe('2.2 append-only triggers', () => {
  let ids: Record<string, string> = {};
  beforeAll(async () => {
    await resetAuthTables();
    const org = await db.org.create({ data: { slug: 'append-only', name: 'a' } });
    const unit = await db.unit.create({ data: { orgId: org.id, unitId: 'U1' } });
    const owner = await db.owner.create({ data: { orgId: org.id, ownerId: 'O1' } });
    const meeting = await db.meeting.create({ data: { orgId: org.id, meetingId: 'M', definition: {}, definitionHash: 'a'.repeat(64), salt: 'b'.repeat(32) } });
    const ledger = await db.ledgerEntry.create({ data: { unitId: unit.id, entryId: 'L1', kind: 'CHARGE', amountCents: 100, date: '2026-01-01' } });
    const proxy = await db.proxy.create({ data: { meetingId: meeting.id, proxyId: 'P1', grantorUnitId: unit.id, grantorOwnerId: owner.id, holderOwnerId: owner.id, receivedAt: '2026-11-01T10:00:00' } });
    // Ballot, BallotSecret, BallotStatusEvent only ever come from quorum_cast_ballot (D-33); the owner may call it too.
    const [row] = await db.$queryRaw<{ id: string }[]>`SELECT quorum_cast_ballot(${meeting.id}::uuid, 'B-001', ${'c'.repeat(64)}, 0, '2026-11-02T10:00:00', false, '{}', ${'d'.repeat(64)}, ${'e'.repeat(64)}, 'UNKNOWN_UNIT'::"BallotCode", NULL, 'U-9', NULL, 'O1', ${owner.id}::uuid, '', NULL) AS id`;
    const result = await db.contestResult.create({ data: { meetingId: meeting.id, contestId: 'E1', tally: {}, commitment: 'f'.repeat(64) } });
    ids = { Ballot: row!.id, BallotSecret: row!.id, LedgerEntry: ledger.id, Proxy: proxy.id, ContestResult: result.id, Meeting: meeting.id };
  });

  for (const table of APPEND_ONLY) {
    it(`${table}: UPDATE and DELETE are refused by trigger, from raw SQL and from the client, naming the table`, async () => {
      const where = table === 'BallotSecret' ? `"ballotId" = '${ids.BallotSecret}'` : table === 'BallotStatusEvent' ? `"ballotId" = '${ids.Ballot}'` : `id = '${ids[table]}'`;
      const col = { Ballot: '"bpsAsOf" = 1', BallotStatusEvent: 'seq = 9', BallotSecret: `"unitRef" = 'x'`, Proxy: `"proxyId" = 'x'`, LedgerEntry: `memo = 'x'`, ContestResult: `"contestId" = 'x'` }[table];
      const update = asOwner((tx) => tx.$executeRawUnsafe(`UPDATE "${table}" SET ${col} WHERE ${where}`));
      await expect(update).rejects.toBeInstanceOf(AppendOnlyViolation);
      await expect(update).rejects.toMatchObject({ sqlState: 'P0001', detail: `${table} is append-only (D-19)` });
      await expect(asOwner((tx) => tx.$executeRawUnsafe(`DELETE FROM "${table}" WHERE ${where}`))).rejects.toMatchObject({ name: 'AppendOnlyViolation', detail: `${table} is append-only (D-19)` });
    });
  }

  it('Meeting: DELETE is refused; an open meeting keeps its definition, salt and identity (D-35)', async () => {
    await expect(asOwner((tx) => tx.meeting.delete({ where: { id: ids.Meeting } }))).rejects.toMatchObject({ sqlState: 'P0001', detail: 'Meeting is never deleted (D-19)' });
    await expect(asOwner((tx) => tx.meeting.update({ where: { id: ids.Meeting }, data: { salt: 'c'.repeat(32) } }))).rejects.toMatchObject({ detail: expect.stringContaining('fixed at creation (D-35)') });
    await expect(asOwner((tx) => tx.meeting.update({ where: { id: ids.Meeting }, data: { merkleRoot: 'a'.repeat(64) } }))).rejects.toMatchObject({ detail: expect.stringContaining('written only by closing (D-20)') });
    await asOwner((tx) => tx.meeting.update({ where: { id: ids.Meeting }, data: { title: 'renamed' } }));
    expect((await db.meeting.findUniqueOrThrow({ where: { id: ids.Meeting } })).title).toBe('renamed');
  });

  it('the row count is what it was before the refusals', async () => {
    expect(await db.ballot.count()).toBe(1);
    expect(await db.ballotStatusEvent.count()).toBe(1);
    expect(await db.ballotSecret.count()).toBe(1);
  });
});

describe('D-33 the application role', () => {
  it('quorum_app exists, NOLOGIN, and cannot INSERT into Ballot, BallotSecret, BallotStatusEvent or ContestResult', async () => {
    const [role] = await db.$queryRaw<{ rolcanlogin: boolean }[]>`SELECT rolcanlogin FROM pg_roles WHERE rolname = 'quorum_app'`;
    expect(role).toEqual({ rolcanlogin: false });
    const grants = await db.$queryRaw<{ t: string; p: string }[]>`SELECT table_name AS t, privilege_type AS p FROM information_schema.role_table_grants WHERE grantee = 'quorum_app' ORDER BY 1, 2`;
    const by = new Map<string, string[]>();
    for (const g of grants) by.set(g.t, [...(by.get(g.t) ?? []), g.p]);
    for (const t of ['Ballot', 'BallotStatusEvent', 'BallotSecret', 'ContestResult']) expect(by.get(t), t).toEqual(['SELECT']);
    for (const t of ['Unit', 'UnitShare', 'Owner', 'Ownership', 'LedgerEntry', 'Proxy']) expect(by.get(t), t).toEqual(['INSERT', 'SELECT']);
    expect(by.get('Meeting')).toEqual(['INSERT', 'SELECT']); // UPDATE is column-level, title only:
    const cols = await db.$queryRaw<{ c: string }[]>`SELECT column_name AS c FROM information_schema.role_column_grants WHERE grantee = 'quorum_app' AND privilege_type = 'UPDATE'`;
    expect(cols).toEqual([{ c: 'title' }]);
    expect(by.get('Org')).toEqual(['SELECT']);
    expect(by.has('User')).toBe(false);
  });

  it('a direct INSERT into Ballot as the app role is 42501, typed PrivilegeDenied', async () => {
    const org = await db.org.create({ data: { slug: 'role-' + Date.now(), name: 'a' } });
    const meeting = await db.meeting.create({ data: { orgId: org.id, meetingId: 'M2', definition: {}, definitionHash: 'a'.repeat(64), salt: 'b'.repeat(32) } });
    const attempt = asApp((tx) => tx.ballot.create({ data: { meetingId: meeting.id, ballotId: 'B-9', unitHash: 'a'.repeat(64), bpsAsOf: 0, castAt: '2026-11-02T10:00:00', viaProxy: false, choicesCanonical: '{}', nonceHash: 'a'.repeat(64), receipt: 'a'.repeat(64) } }));
    await expect(attempt).rejects.toBeInstanceOf(PrivilegeDenied);
    await expect(attempt).rejects.toMatchObject({ sqlState: '42501', detail: 'permission denied for table Ballot' });
    // the same connection, outside the transaction, is the login role again
    expect((await db.$queryRaw<{ r: string }[]>`SELECT current_user AS r`)[0]!.r).not.toBe('quorum_app');
  });
});
