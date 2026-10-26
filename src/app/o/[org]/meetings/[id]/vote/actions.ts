'use server';
import { z } from 'zod';
import { orgAction, ref } from '@/core/authz/action';
import { castByProxy, castOwn } from '@/meetings/casting';
import { refusing } from '@/meetings/refuse';
import { revokeOwnProxy } from '@/meetings/revoke';

// Task 3.2, the member's side (D-39 a). Any role may call; the body requires an OwnerLink. The extra fields are the
// ballot (`c:<contest>[:<candidate>]`), read against the meeting's own contests by choicesFromForm.
const ballot = z.object({ meetingId: ref('meeting') }).catchall(z.string().max(200));

export const castOwnAction = orgAction(null, ballot.extend({ unitId: ref('unit') }), async (ctx, { meetingId, unitId, ...fields }) => ({
  receipt: await refusing(() => castOwn(ctx, { meetingRowId: meetingId, unitRowId: unitId, fields })),
}));

export const castByProxyAction = orgAction(null, ballot.extend({ proxyId: ref('proxy') }), async (ctx, { meetingId, proxyId, ...fields }) => ({
  receipt: await refusing(() => castByProxy(ctx, { meetingRowId: meetingId, proxyRowId: proxyId, fields })),
}));

// D-57: the grantor revokes a proxy they granted. Any role may call; the body requires the OwnerLink to the grantor
// (anyone else is notFound). The revocation is a new row; the ballot rules judge the next cast with it (P-5).
export const revokeOwnProxyAction = orgAction(null, z.object({ meetingId: ref('meeting'), proxyId: ref('proxy') }), async (ctx, { meetingId, proxyId }) => {
  const r = await refusing(() => revokeOwnProxy(ctx, { meetingRowId: meetingId, proxyRowId: proxyId }));
  return { notice: `Proxy ${r.proxyId} revoked at ${r.revokedAt}. A ballot cast with it from now on is rejected PROXY_REVOKED; one already cast with it keeps its label — cast your own ballot to supersede it (D-26).` };
});
