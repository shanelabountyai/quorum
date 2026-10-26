'use server';
import { z } from 'zod';
import { assertFresh } from '@/core/auth/session';
import { orgAction, ref } from '@/core/authz/action';
import { audit } from '@/core/audit';
import { closeMeetingNow, importProxies, intakeProxy, queueMeetingNotice } from '@/meetings/admin';
import { refusing } from '@/meetings/refuse';

// Task 3.1: the board's meeting actions. Every id is ref('<model>') so the INV harness scopes it; a meeting, unit or
// owner of another association is notFound, exactly like one that does not exist (INV-04).

export const importProxiesAction = orgAction('org.update', z.object({ meetingId: ref('meeting'), proxies: z.string().max(500_000) }), async (ctx, { meetingId, proxies }) => {
  const r = await refusing(() => importProxies(ctx.orgId, meetingId, proxies));
  if (r.inserted) await audit(ctx, 'proxies.imported', { targetType: 'meeting', targetId: meetingId, data: { inserted: r.inserted } });
  return { notice: r.inserted ? `${r.inserted} proxies recorded.` : `0 inserted: all ${r.existing} proxies already match, column for column.` };
});

export const intakeProxyAction = orgAction(
  'org.update',
  z.object({ meetingId: ref('meeting'), unitId: ref('unit'), grantorId: ref('owner'), holderId: ref('owner'), receivedAt: z.string().max(19).optional() }),
  async (ctx, i) => {
    const r = await refusing(() => intakeProxy(ctx.orgId, { meetingRowId: i.meetingId, grantorUnitRowId: i.unitId, grantorOwnerRowId: i.grantorId, holderOwnerRowId: i.holderId, receivedAt: i.receivedAt || undefined }));
    await audit(ctx, 'proxy.recorded', { targetType: 'meeting', targetId: i.meetingId, data: { proxyId: r.proxyId, intake: r.code } });
    return { notice: r.code ? `Proxy ${r.proxyId} recorded at ${r.receivedAt}. At intake it is ${r.code}: a ballot cast with it will be rejected with that code.` : `Proxy ${r.proxyId} recorded at ${r.receivedAt}. Nothing in the proxy itself refuses it; the rest is judged when the ballot is cast.` };
  },
);

// Closing is final and seals the voter link, so it asks for a fresh sign-in, like the foundation's destructive actions (INV-26).
export const closeMeetingAction = orgAction('org.update', z.object({ meetingId: ref('meeting') }), async (ctx, { meetingId }) => {
  assertFresh(ctx.session);
  const r = await refusing(() => closeMeetingNow(ctx.orgId, meetingId));
  if (r.closed) await audit(ctx, 'meeting.closed', { targetType: 'meeting', targetId: meetingId, data: { closedAt: r.closedAt, commitment: r.stored.commitment } });
  return { notice: r.closed ? `Closed at ${r.closedAt} and sealed. Meeting commitment ${r.stored.commitment}.` : `Already closed at ${r.closedAt}; nothing was written. Meeting commitment ${r.stored.commitment}.` };
});

export const queueNoticeAction = orgAction('org.update', z.object({ meetingId: ref('meeting') }), async (ctx, { meetingId }) => {
  const r = await refusing(() => queueMeetingNotice(ctx, meetingId));
  return { notice: r.queued ? `${r.queued} notices queued (not sent: notices stay in the outbox).` : `Already queued: ${r.already} notices. Nothing new was queued.` };
});
