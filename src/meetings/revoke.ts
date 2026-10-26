// D-55 (owner decision, 2026-10-26; the D-35 i seam): revoking a proxy after it was recorded. A revocation is a new
// append-only ProxyRevocation row — never an UPDATE of the Proxy — written under the meeting lock at the meeting's
// wall clock, so it sorts with the casts (D-36): a cast after it reads `revoked_at <= cast_at` and the engine's P-5,
// unchanged, labels the ballot PROXY_REVOKED; a ballot already cast with the proxy keeps the label it was given then.
// Two doors: the grantor through their linked account (OwnerLink), and the board at the desk for the grantor, with
// the operator and a reason recorded. A proxy of another meeting or association is notFound (INV-04); a proxy of this
// meeting that the caller may not revoke is a refusal naming who may — the meeting page already lists every proxy's
// grantor and holder to the association's members, so "not found" would hide nothing. Audited.
import { notFound } from 'next/navigation';
import { audit } from '@/core/audit';
import { can } from '@/core/authz/permissions';
import { Refused } from '@/core/errors';
import type { Role } from '@/generated/prisma/enums';
import type { Timestamp } from '@/tally/time';
import { meetingInOrg, assertUuid } from './admin';
import { assertNotArchived } from './archive';
import { wallClock } from './clock';
import { asApp, type Tx } from './db';
import { CastOutOfOrder } from './errors';
import { linkedOwner } from './owners';

export type RevocationChannel = 'GRANTOR' | 'DESK';
export type Revocation = { proxyId: string; revokedAt: Timestamp; channel: RevocationChannel };
type Who = { orgId: string; userId: string };
type Input = { meetingRowId: string; proxyRowId: string; reason?: string };

export const NOT_YOURS = 'Only the owner who granted this proxy, or the board at the desk, can revoke it.';

async function revokeInTx(tx: Tx, who: Who, input: Input, channel: RevocationChannel, mayRevoke: (grantorOwnerRowId: string) => Promise<boolean>): Promise<Revocation> {
  const head = await meetingInOrg(tx, who.orgId, input.meetingRowId);
  assertUuid(input.proxyRowId);
  const proxy = await tx.proxy.findFirst({ where: { id: input.proxyRowId, meetingId: head.id }, include: { revocation: true } });
  if (!proxy) notFound();
  if (!(await mayRevoke(proxy.grantorOwnerId))) throw new Refused(NOT_YOURS);
  // the lock first, so the instant below is ordered with every cast in this meeting (D-36)
  const [lock] = await tx.$queryRaw<{ closedAt: string | null }[]>`SELECT "closedAt" FROM quorum_lock_meeting(${head.id}::uuid)`;
  if (lock?.closedAt) throw new Refused(`This meeting closed at ${lock.closedAt}; a proxy can no longer be revoked.`);
  await assertNotArchived(tx, who.orgId);
  const already = proxy.revocation?.revokedAt ?? proxy.revokedAt;
  if (already) throw new Refused(`Proxy ${proxy.proxyId} was already revoked at ${already}.`);
  const reason = (input.reason ?? '').trim();
  if (channel === 'DESK' && !reason) throw new Refused('Give the reason for revoking at the desk (for example, the grantor presented a signed revocation).');
  const revokedAt = wallClock(head.definition.rules.timezone_label);
  const [latest] = await tx.$queryRaw<{ at: string | null }[]>`SELECT max("castAt") AS at FROM "Ballot" WHERE "meetingId" = ${head.id}::uuid`;
  if (latest?.at && revokedAt < latest.at) throw new CastOutOfOrder(revokedAt, latest.at); // never on a live clock; a stored label must not be contradicted
  await tx.proxyRevocation.create({ data: { proxyId: proxy.id, meetingId: head.id, revokedAt, channel, byUserId: who.userId, reason } });
  await audit(who, 'proxy.revoked', { targetType: 'proxy', targetId: proxy.id, data: { proxyId: proxy.proxyId, channel, revokedAt } }, tx);
  return { proxyId: proxy.proxyId, revokedAt, channel };
}

/** The grantor revokes a proxy they granted, through the account linked to them on the roster. */
export const revokeOwnProxy = (who: Who, input: Input) =>
  asApp(async (tx) => {
    const me = await linkedOwner(tx, who.orgId, who.userId);
    return revokeInTx(tx, who, input, 'GRANTOR', async (grantor) => me !== null && me.ownerRowId === grantor);
  });

/** The board (org.update) at the desk revokes for the grantor; the operator and the reason are recorded. */
export const revokeProxyAtDesk = (who: Who & { role: Role }, input: Input & { reason: string }) =>
  asApp((tx) => revokeInTx(tx, who, input, 'DESK', async () => can(who.role, 'org.update')));

export type GrantedProxy = { id: string; proxyId: string; grantorUnit: string; holderOwner: string; holderName: string; receivedAt: string; revokedAt: string | null };

/** The proxies this user's roster owner granted in this meeting, with any revocation (import or D-55 row). */
export async function proxiesGrantedBy(tx: Tx, orgId: string, userId: string, meetingRowId: string): Promise<GrantedProxy[]> {
  const me = await linkedOwner(tx, orgId, userId);
  if (!me) return [];
  const rows = await tx.proxy.findMany({
    where: { meetingId: meetingRowId, grantorOwnerId: me.ownerRowId, meeting: { orgId } },
    orderBy: { proxyId: 'asc' },
    include: { grantorUnit: { select: { unitId: true } }, holderOwner: { select: { ownerId: true, name: true } }, revocation: { select: { revokedAt: true } } },
  });
  return rows.map((p) => ({ id: p.id, proxyId: p.proxyId, grantorUnit: p.grantorUnit.unitId, holderOwner: p.holderOwner.ownerId, holderName: p.holderOwner.name, receivedAt: p.receivedAt, revokedAt: p.revocation?.revokedAt ?? p.revokedAt }));
}
