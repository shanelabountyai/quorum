// Owner decision 2026-10-26 (D-55, builds the D-35 i / D-49 seam): an owner revokes a proxy they granted, before the
// meeting closes, through the write layer. Revocation is a NEW append-only row (ProxyRevocation), never an UPDATE of
// the Proxy; the one reader (readProxies) folds it into the engine's `revoked_at`, so the engine's P-5 rule — not
// changed, and the frozen fixtures not touched — decides PROXY_REVOKED on the next cast through the database path.
// Only the grantor (their linked account) or the board at the desk (recorded: who, channel, reason) may revoke;
// every revocation is audited; a closed meeting, an archived org, a second revocation are refused.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/core/db';
import { Refused } from '@/core/errors';
import { closeMeetingNow, createMeeting, importProxies, intakeProxy } from '@/meetings/admin';
import { archiveOrg } from '@/meetings/archive';
import { castByProxy } from '@/meetings/casting';
import { asApp, asOwner } from '@/meetings/db';
import { loadRoster } from '@/meetings/load';
import { readProxies } from '@/meetings/roster';
import { NOT_YOURS, proxiesGrantedBy, revokeOwnProxy, revokeProxyAtDesk } from '@/meetings/revoke';
import { NavSignal } from '../helpers/next';
import { emptyDatabase } from '../../scripts/tally-eval-db';
import { ensureOrg } from '../../scripts/quorum-load';
import { loadRosterFixtures } from '../../scripts/tally-fixtures';

const fixtureMeeting = JSON.parse(readFileSync('fixtures/meeting.json', 'utf8'));
// the fixture's rules with a window that holds "now", so the app clock casts and revokes inside it; record date unchanged
const live = (id: string) => JSON.stringify({ ...fixtureMeeting, meeting_id: id, rules: { ...fixtureMeeting.rules, open_at: '2026-01-01T00:00:00', close_at: '2099-12-31T23:59:59' } });

let orgId = '';
let meetingRowId = '';
const users: Record<string, string> = {};
const ownerRow = async (ownerId: string) => (await db.owner.findFirstOrThrow({ where: { orgId, ownerId } })).id;
const unitRow = async (unitId: string) => (await db.unit.findFirstOrThrow({ where: { orgId, unitId } })).id;
const notFoundOf = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e instanceof NavSignal ? e.kind : e));

/** A board-recorded paper proxy: grantor owner of `unit` → holder, received now on the meeting clock. */
async function proxy(unit: string, grantor: string, holder: string, meeting = meetingRowId) {
  await intakeProxy(orgId, { meetingRowId: meeting, grantorUnitRowId: await unitRow(unit), grantorOwnerRowId: await ownerRow(grantor), holderOwnerRowId: await ownerRow(holder) });
  return db.proxy.findFirstOrThrow({ where: { meetingId: meeting, grantorUnit: { unitId: unit } }, orderBy: { proxyId: 'desc' } });
}

describe('D-55 proxy revocation', () => {
  beforeAll(async () => {
    await emptyDatabase();
    orgId = await ensureOrg('revocation');
    await asApp((tx) => loadRoster(tx, orgId, loadRosterFixtures()));
    meetingRowId = (await createMeeting(orgId, live('AM-REVOKE'))).id;
    for (const [who, ownerId] of [['grantor1', 'O-001'], ['holder2', 'O-002'], ['grantor3', 'O-003'], ['grantor4', 'O-004']] as const) {
      users[who] = (await db.user.create({ data: { email: `${who}@example.test` } })).id;
      await db.ownerLink.create({ data: { orgId, ownerId: await ownerRow(ownerId), userId: users[who]! } }); // as the Invite trigger would (owner-link.test.ts proves it)
    }
    users.board = (await db.user.create({ data: { email: 'board@example.test' } })).id;
  }, 60_000);

  it('the grantor revokes; the holder then casts with it through the database path and the engine says PROXY_REVOKED (P-5)', async () => {
    const p = await proxy('A-101', 'O-001', 'O-002');
    const r = await revokeOwnProxy({ orgId, userId: users.grantor1! }, { meetingRowId, proxyRowId: p.id });
    expect(r).toMatchObject({ proxyId: p.proxyId, channel: 'GRANTOR' });
    expect(r.revokedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    // a new row; the Proxy row is exactly as recorded (append-only: no UPDATE)
    expect(await db.proxyRevocation.findMany({ where: { proxyId: p.id } })).toEqual([expect.objectContaining({ revokedAt: r.revokedAt, channel: 'GRANTOR', byUserId: users.grantor1, meetingId: meetingRowId })]);
    expect(await db.proxy.findUniqueOrThrow({ where: { id: p.id } })).toEqual(p);
    // the one reader hands the engine revoked_at
    expect((await asApp((tx) => readProxies(tx, meetingRowId))).find((x) => x.row_id === p.id)?.revoked_at).toBe(r.revokedAt);
    // the holder casts on it: received, rejected PROXY_REVOKED, and that is the stored label
    const cast = await castByProxy({ orgId, userId: users.holder2! }, { meetingRowId, proxyRowId: p.id, fields: { 'c:R1': 'YES' } });
    expect(cast).toMatchObject({ status: 'REJECTED', code: 'PROXY_REVOKED' });
    expect(cast.castAt >= r.revokedAt).toBe(true);
    const label = await db.ballotStatusEvent.findFirstOrThrow({ where: { ballot: { meetingId: meetingRowId, ballotId: cast.ballotId } } });
    expect(label).toMatchObject({ seq: 1, status: 'REJECTED', code: 'PROXY_REVOKED' });
    // audited: who, which proxy, which channel — no ballot, no choice
    const ev = await db.auditEvent.findFirstOrThrow({ where: { orgId, action: 'proxy.revoked', targetId: p.id } });
    expect(ev).toMatchObject({ actorUserId: users.grantor1, targetType: 'proxy', data: { proxyId: p.proxyId, channel: 'GRANTOR', revokedAt: r.revokedAt } });
  });

  it('the grantor sees the proxies they granted, with the revocation', async () => {
    const mine = await asApp((tx) => proxiesGrantedBy(tx, orgId, users.grantor1!, meetingRowId));
    expect(mine.map((p) => [p.grantorUnit, p.holderOwner, p.revokedAt !== null])).toEqual([['A-101', 'O-002', true]]);
  });

  it('a second revocation is refused, naming the first', async () => {
    const p = await db.proxy.findFirstOrThrow({ where: { meetingId: meetingRowId, grantorUnit: { unitId: 'A-101' } } });
    await expect(revokeOwnProxy({ orgId, userId: users.grantor1! }, { meetingRowId, proxyRowId: p.id })).rejects.toThrow(/already revoked at \d{4}-/);
    // and the database refuses a second row on its own (one revocation per proxy)
    const twice = asOwner((tx) => tx.proxyRevocation.create({ data: { proxyId: p.id, meetingId: meetingRowId, revokedAt: '2098-01-01T00:00:00', channel: 'DESK', reason: 'again' } }));
    await expect(twice).rejects.toThrow();
    expect(await db.proxyRevocation.count({ where: { proxyId: p.id } })).toBe(1);
  });

  it('only the grantor: the holder, another owner and an unlinked board user on the owner path are refused; a proxy of another meeting is notFound', async () => {
    const p = await proxy('A-103', 'O-003', 'O-002');
    for (const userId of [users.holder2!, users.grantor4!, users.board!]) {
      await expect(revokeOwnProxy({ orgId, userId }, { meetingRowId, proxyRowId: p.id })).rejects.toThrow(NOT_YOURS);
    }
    const elsewhere = (await createMeeting(orgId, live('AM-REVOKE-ELSEWHERE'))).id;
    expect(await notFoundOf(revokeOwnProxy({ orgId, userId: users.grantor3! }, { meetingRowId: elsewhere, proxyRowId: p.id }))).toBe('notFound');
    expect(await notFoundOf(revokeOwnProxy({ orgId: '00000000-0000-4000-8000-000000000000', userId: users.grantor3! }, { meetingRowId, proxyRowId: p.id }))).toBe('notFound');
    expect(await db.proxyRevocation.count({ where: { proxyId: p.id } })).toBe(0);
  });

  it('the board at the desk may revoke for the grantor, recorded with the operator, the channel and a reason, and audited', async () => {
    const p = await db.proxy.findFirstOrThrow({ where: { meetingId: meetingRowId, grantorUnit: { unitId: 'A-103' } } });
    await expect(revokeProxyAtDesk({ orgId, userId: users.board!, role: 'admin' }, { meetingRowId, proxyRowId: p.id, reason: '  ' })).rejects.toThrow(/reason/);
    await expect(revokeProxyAtDesk({ orgId, userId: users.grantor3!, role: 'member' }, { meetingRowId, proxyRowId: p.id, reason: 'mine' })).rejects.toThrow(NOT_YOURS); // a member is not the desk, even the grantor (they have their own door)
    const r = await revokeProxyAtDesk({ orgId, userId: users.board!, role: 'admin' }, { meetingRowId, proxyRowId: p.id, reason: 'O-003 presented a signed revocation at the desk' });
    expect(r.channel).toBe('DESK');
    expect(await db.proxyRevocation.findUniqueOrThrow({ where: { proxyId: p.id } })).toMatchObject({ channel: 'DESK', byUserId: users.board, reason: 'O-003 presented a signed revocation at the desk' });
    expect(await db.auditEvent.findFirstOrThrow({ where: { orgId, action: 'proxy.revoked', targetId: p.id } })).toMatchObject({ actorUserId: users.board, data: { channel: 'DESK' } });
  });

  it('a proxy revoked in the imported proxies.csv (Proxy.revokedAt) cannot be revoked again', async () => {
    const m = (await createMeeting(orgId, live('AM-REVOKE-CSV'))).id;
    await importProxies(orgId, m, readFileSync('fixtures/proxies.csv', 'utf8'));
    const pre = await db.proxy.findFirstOrThrow({ where: { meetingId: m, revokedAt: { not: null } }, include: { grantorOwner: true } });
    await expect(revokeProxyAtDesk({ orgId, userId: users.board!, role: 'owner' }, { meetingRowId: m, proxyRowId: pre.id, reason: 'x' })).rejects.toThrow(`already revoked at ${pre.revokedAt}`);
  });

  it('UPDATE and DELETE on ProxyRevocation are refused by trigger, naming the table', async () => {
    const row = await db.proxyRevocation.findFirstOrThrow();
    await expect(asOwner((tx) => tx.proxyRevocation.update({ where: { id: row.id }, data: { reason: 'edited' } }))).rejects.toMatchObject({ name: 'AppendOnlyViolation', detail: 'ProxyRevocation is append-only (D-19)' });
    await expect(asOwner((tx) => tx.$executeRawUnsafe(`DELETE FROM "ProxyRevocation" WHERE id = '${row.id}'`))).rejects.toMatchObject({ name: 'AppendOnlyViolation' });
    // and the application role was never granted either
    const grants = await db.$queryRaw<{ p: string }[]>`SELECT privilege_type AS p FROM information_schema.role_table_grants WHERE grantee = 'quorum_app' AND table_name = 'ProxyRevocation' ORDER BY 1`;
    expect(grants.map((g) => g.p)).toEqual(['INSERT', 'SELECT']);
  });

  it('after the meeting closes a revocation is refused, by the write layer and by the database', async () => {
    const m = (await createMeeting(orgId, live('AM-REVOKE-CLOSED'))).id;
    const p = await proxy('A-104', 'O-004', 'O-002', m);
    await closeMeetingNow(orgId, m);
    await expect(revokeOwnProxy({ orgId, userId: users.grantor4! }, { meetingRowId: m, proxyRowId: p.id })).rejects.toThrow(Refused);
    await expect(revokeOwnProxy({ orgId, userId: users.grantor4! }, { meetingRowId: m, proxyRowId: p.id })).rejects.toThrow(/closed/);
    const raw = asOwner((tx) => tx.proxyRevocation.create({ data: { proxyId: p.id, meetingId: m, revokedAt: '2099-12-31T23:59:59', channel: 'DESK', reason: 'late' } }));
    await expect(raw).rejects.toMatchObject({ name: 'MeetingClosed' });
    expect(await db.proxyRevocation.count({ where: { proxyId: p.id } })).toBe(0);
  });

  it('the database refuses a revocation filed under another meeting than its proxy', async () => {
    const other = (await createMeeting(orgId, live('AM-REVOKE-OTHER'))).id;
    const p = await proxy('A-102', 'O-002', 'O-001');
    await expect(asOwner((tx) => tx.proxyRevocation.create({ data: { proxyId: p.id, meetingId: other, revokedAt: '2099-01-01T00:00:00', channel: 'DESK', reason: 'x' } }))).rejects.toThrow(/belongs to meeting/);
  });

  it('an archived org revokes nothing', async () => {
    const p = await db.proxy.findFirstOrThrow({ where: { meetingId: meetingRowId, revocation: null } });
    await archiveOrg(orgId, users.board!, 'test');
    await expect(revokeProxyAtDesk({ orgId, userId: users.board!, role: 'owner' }, { meetingRowId, proxyRowId: p.id, reason: 'x' })).rejects.toThrow(/archived/);
  });
});
