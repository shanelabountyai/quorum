'use server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { orgAction, ref } from '@/core/authz/action';
import { refusing } from '@/meetings/refuse';
import { openViolation } from '@/violations/violations';

// Task 3.6: open a violation (NOTICE_SENT), board and manager only; the notice is queued, never sent.
export const openViolationAction = orgAction('org.update', z.object({ unitId: ref('unit'), title: z.string().max(300), day: z.string().max(10) }), async (ctx, i) => {
  const r = await refusing(() => openViolation(ctx, { unitRowId: i.unitId, title: i.title, day: i.day }));
  redirect(`/o/${ctx.slug}/violations/${r.violationRowId}`);
});
