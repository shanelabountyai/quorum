'use server';
import { z } from 'zod';
import { orgAction, ref } from '@/core/authz/action';
import { castByProxy, castOwn } from '@/meetings/casting';
import { refusing } from '@/meetings/refuse';

// Task 3.2, the member's side (D-39 a). Any role may call; the body requires an OwnerLink. The extra fields are the
// ballot (`c:<contest>[:<candidate>]`), read against the meeting's own contests by choicesFromForm.
const ballot = z.object({ meetingId: ref('meeting') }).catchall(z.string().max(200));

export const castOwnAction = orgAction(null, ballot.extend({ unitId: ref('unit') }), async (ctx, { meetingId, unitId, ...fields }) => ({
  receipt: await refusing(() => castOwn(ctx, { meetingRowId: meetingId, unitRowId: unitId, fields })),
}));

export const castByProxyAction = orgAction(null, ballot.extend({ proxyId: ref('proxy') }), async (ctx, { meetingId, proxyId, ...fields }) => ({
  receipt: await refusing(() => castByProxy(ctx, { meetingRowId: meetingId, proxyRowId: proxyId, fields })),
}));
