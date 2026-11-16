// D-63 / D-66: two revocations of the same proxy at once. revokeInTx used to read the proxy's revocation BEFORE taking
// the meeting lock, so the second call checked a stale read, passed, and hit the ProxyRevocation_proxyId_key unique
// index as a raw error (a 500). Now the revocation is read under the lock, and a unique violation that still gets
// through is the domain refusal. No database: the transaction is a stub that plays the second caller's view.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Refused } from '@/core/errors';

const tx = {
  proxy: { findFirst: vi.fn() },
  proxyRevocation: { findUnique: vi.fn(), create: vi.fn() },
  $queryRaw: vi.fn(),
};
const lockTaken = vi.fn();

vi.mock('@/meetings/db', () => ({ asApp: (fn: (t: typeof tx) => unknown) => fn(tx) }));
vi.mock('@/meetings/admin', () => ({
  meetingInOrg: async () => ({ id: 'meeting-row', definition: { rules: { timezone_label: 'America/Chicago' } } }),
  assertUuid: () => undefined,
}));
vi.mock('@/meetings/archive', () => ({ assertNotArchived: async () => undefined }));
vi.mock('@/meetings/owners', () => ({ linkedOwner: async () => null }));
vi.mock('@/meetings/clock', () => ({ wallClock: () => '2026-11-01T10:00:00' }));
vi.mock('@/core/audit', () => ({ audit: async () => undefined }));

const { revokeProxyAtDesk } = await import('@/meetings/revoke');

const who = { orgId: 'org', userId: 'board-user', role: 'owner' as const };
const input = { meetingRowId: 'meeting-row', proxyRowId: 'proxy-row', reason: 'signed revocation' };

beforeEach(() => {
  vi.clearAllMocks();
  lockTaken.mockReset();
  // the stale view: before the lock, no revocation is visible and the import did not revoke it
  tx.proxy.findFirst.mockResolvedValue({ id: 'proxy-row', proxyId: 'P-001', grantorOwnerId: 'owner-row', revokedAt: null });
  tx.$queryRaw.mockImplementation(async (parts: TemplateStringsArray) => {
    if (parts.join('?').includes('quorum_lock_meeting')) {
      lockTaken();
      return [{ closedAt: null }];
    }
    return [{ at: null }]; // max(castAt): no ballot yet
  });
});

describe('concurrent revocation of one proxy', () => {
  it('reads the revocation after the lock, so the second caller is refused "already revoked", not a 500', async () => {
    // the first caller committed while this one waited on the lock
    tx.proxyRevocation.findUnique.mockImplementation(async () => {
      expect(lockTaken).toHaveBeenCalledTimes(1); // the read happens under the lock, not before it
      return { revokedAt: '2026-11-01T09:59:59' };
    });
    const err = await revokeProxyAtDesk(who, input).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(Refused);
    expect((err as Error).message).toBe('Proxy P-001 was already revoked at 2026-11-01T09:59:59.');
    expect(tx.proxyRevocation.create).not.toHaveBeenCalled();
  });

  it('turns a unique violation on ProxyRevocation.proxyId into the same refusal', async () => {
    tx.proxyRevocation.findUnique.mockResolvedValue(null);
    tx.proxyRevocation.create.mockRejectedValue(Object.assign(new Error('Unique constraint failed on the fields: (`proxyId`)'), { code: 'P2002' }));
    const err = await revokeProxyAtDesk(who, input).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(Refused);
    expect((err as Error).message).toBe('Proxy P-001 was already revoked.');
  });

  it('passes any other database error through unchanged', async () => {
    tx.proxyRevocation.findUnique.mockResolvedValue(null);
    const boom = Object.assign(new Error('connection reset'), { code: 'P1017' });
    tx.proxyRevocation.create.mockRejectedValue(boom);
    await expect(revokeProxyAtDesk(who, input)).rejects.toBe(boom);
  });

  it('records the revocation when nothing revoked it first', async () => {
    tx.proxyRevocation.findUnique.mockResolvedValue(null);
    tx.proxyRevocation.create.mockResolvedValue({});
    await expect(revokeProxyAtDesk(who, input)).resolves.toEqual({ proxyId: 'P-001', revokedAt: '2026-11-01T10:00:00', channel: 'DESK' });
    expect(tx.proxyRevocation.create).toHaveBeenCalledWith({ data: { proxyId: 'proxy-row', meetingId: 'meeting-row', revokedAt: '2026-11-01T10:00:00', channel: 'DESK', byUserId: 'board-user', reason: 'signed revocation' } });
  });
});
