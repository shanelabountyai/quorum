'use server';
import { z } from 'zod';
import { assertFresh } from '@/core/auth/session';
import { notRef, orgAction, ref } from '@/core/authz/action';
import { audit } from '@/core/audit';
import { closeMeetingNow, importProxies, intakeProxy, queueMeetingNotice } from '@/meetings/admin';
import { refusing } from '@/meetings/refuse';
import { declareAssessment, describeAssessment, postAssessment } from '@/ledger/assessment';

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

// D-56: declare a resolution a special assessment (open meeting, before the first ballot), and post a PASSED one once.
// contestId is a contest id inside the meeting's definition ("R2"), not a row id, hence notRef.
export const declareAssessmentAction = orgAction('org.update', z.object({ meetingId: ref('meeting'), contestId: notRef(z.string().max(40)), amount: z.string().max(20) }), async (ctx, { meetingId, contestId, amount }) => {
  const r = await refusing(() => declareAssessment(ctx, { meetingRowId: meetingId, contestId, amount }));
  return { notice: `${r.contestId} declared a special assessment of ${r.amountCents} cents. It posts after close only if it passes.` };
});

export const postAssessmentAction = orgAction('org.update', z.object({ meetingId: ref('meeting'), contestId: notRef(z.string().max(40)) }), async (ctx, { meetingId, contestId }) => {
  const r = await refusing(() => postAssessment(ctx, { meetingRowId: meetingId, contestId }));
  return { notice: `Posted ${r.resolution} on ${r.chargedOn}: ${describeAssessment({ contestId, amountCents: r.allocation.budgetCents, postedCents: r.allocation.postedCents, roundingCents: r.allocation.roundingCents, units: r.allocation.charges.length })}.` };
});
