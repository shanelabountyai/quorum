'use server';
import { z } from 'zod';
import { orgAction, ref } from '@/core/authz/action';
import { verifyOnList } from '@/meetings/results';
import { refusing } from '@/meetings/refuse';

// C-7 on the page: is this receipt a leaf of the published root; and, given the nonce, does it recompute from the
// published ballot id and choices? Read-only. A POST, so a nonce never lands in a URL or a server log.
export const verifyReceiptAction = orgAction(null, z.object({ meetingId: ref('meeting'), receipt: z.string().max(80), nonce: z.string().max(80).optional() }), async (ctx, i) => {
  const v = await refusing(() => verifyOnList(ctx.orgId, i.meetingId, i.receipt, i.nonce ?? ''));
  return { notice: v };
});
