'use server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { assertFresh } from '@/core/auth/session';
import { orgAction } from '@/core/authz/action';
import { audit } from '@/core/audit';
import { archiveOrg } from '@/meetings/archive';
import { refusing } from '@/meetings/refuse';

// D-43: archiving is the owner's act (org.delete), on a fresh sign-in like deletion (INV-26), and it is permanent.
export const archiveAssociation = orgAction('org.delete', z.object({ reason: z.string().trim().min(1, 'Give a reason for archiving.').max(500) }), async (ctx, { reason }) => {
  assertFresh(ctx.session);
  const r = await refusing(() => archiveOrg(ctx.orgId, ctx.userId, reason));
  if (r.archived) await audit(ctx, 'org.archived', { targetType: 'org', targetId: ctx.orgId, data: { reason } });
  redirect(`/o/${ctx.slug}`);
});
