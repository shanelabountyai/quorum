'use server';
import { z } from 'zod';
import { orgAction, ref } from '@/core/authz/action';
import { formatCents } from '@/ledger/money';
import { refusing } from '@/meetings/refuse';
import { transitionViolation } from '@/violations/violations';

// Task 3.6: one transition through the state machine (D-22); anything the table does not list is TRANSITION_INVALID.
export const transitionAction = orgAction(
  'org.update',
  z.object({ violationId: ref('violation'), to: z.string().max(40), day: z.string().max(10), hearingOn: z.string().max(10).optional(), fine: z.string().max(20).optional(), reason: z.string().max(500).default('') }),
  async (ctx, i) => {
    const r = await refusing(() => transitionViolation(ctx, { violationRowId: i.violationId, to: i.to, day: i.day, hearingOn: i.hearingOn || undefined, fine: i.fine, reason: i.reason }));
    return { notice: `Now ${r.state} (event ${r.seq})${r.fineCents ? `; the fine of ${formatCents(r.fineCents)} is on the unit's ledger` : ''}; ${r.queued} notice(s) queued, none sent.` };
  },
);
