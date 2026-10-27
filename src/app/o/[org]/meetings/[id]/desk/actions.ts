'use server';
import { z } from 'zod';
import { orgAction, ref } from '@/core/authz/action';
import { castAtDesk, castAtDeskByProxy } from '@/meetings/casting';
import { refusing } from '@/meetings/refuse';

// Task 3.2, the desk (D-39 b): board and manager only (org.update). The operator is written into the sealed link,
// not the audit log; the audit row says a desk ballot was cast in this meeting and nothing else.
const ballot = z.object({ meetingId: ref('meeting') }).catchall(z.string().max(200));

export const deskCastAction = orgAction('org.update', ballot.extend({ ownerId: ref('owner'), unitId: ref('unit') }), async (ctx, { meetingId, ownerId, unitId, ...fields }) => ({
  receipt: await refusing(() => castAtDesk(ctx, { meetingRowId: meetingId, ownerRowId: ownerId, unitRowId: unitId, fields })),
}));

export const deskProxyCastAction = orgAction('org.update', ballot.extend({ proxyId: ref('proxy') }), async (ctx, { meetingId, proxyId, ...fields }) => ({
  receipt: await refusing(() => castAtDeskByProxy(ctx, { meetingRowId: meetingId, proxyRowId: proxyId, fields })),
}));
