'use server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { orgAction } from '@/core/authz/action';
import { audit } from '@/core/audit';
import { createMeeting } from '@/meetings/admin';
import { refusing } from '@/meetings/refuse';

// Task 3.1: a meeting from a pasted meeting.json — the engine's closed schema decides (RULES_INVALID is shown).
export const createMeetingAction = orgAction('org.update', z.object({ definition: z.string().max(200_000) }), async (ctx, { definition }) => {
  const m = await refusing(() => createMeeting(ctx.orgId, definition));
  if (m.created) await audit(ctx, 'meeting.created', { targetType: 'meeting', targetId: m.id, data: { meetingId: m.meetingId, definitionHash: m.definitionHash } });
  redirect(`/o/${ctx.slug}/meetings/${m.id}`);
});
