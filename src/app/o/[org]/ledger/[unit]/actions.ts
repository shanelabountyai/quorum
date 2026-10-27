'use server';
import { z } from 'zod';
import { orgAction, ref } from '@/core/authz/action';
import { postEntry } from '@/ledger/ledger';
import { formatCents } from '@/ledger/money';
import { refusing } from '@/meetings/refuse';

// Task 3.5: a payment or a credit on one unit (board and manager). A credit says why and may reverse an entry. The
// amount is parsed inside postEntry, after the ids are checked, so a foreign id is notFound before any form error.
const base = { unitId: ref('unit'), amount: z.string().max(20), date: z.string().max(10), memo: z.string().max(200).default('') };

export const postPaymentAction = orgAction('org.update', z.object(base), async (ctx, i) => {
  const r = await refusing(() => postEntry(ctx, { unitRowId: i.unitId, kind: 'PAYMENT', amount: i.amount, date: i.date, memo: i.memo, reason: '' }));
  return { notice: `Payment ${r.entryId} of ${formatCents(r.amountCents)} posted.` };
});

export const postCreditAction = orgAction('org.update', z.object({ ...base, reason: z.string().max(200) }), async (ctx, i) => {
  const r = await refusing(() => postEntry(ctx, { unitRowId: i.unitId, kind: 'CREDIT', amount: i.amount, date: i.date, memo: i.memo, reason: i.reason }));
  return { notice: `Credit ${r.entryId} of ${formatCents(r.amountCents)} posted.` };
});

/** D-21: a CREDIT that names the entry it reverses (same unit, enforced by the database too). */
export const reverseEntryAction = orgAction('org.update', z.object({ ...base, reason: z.string().max(200), reversesId: ref('ledgerEntry') }), async (ctx, i) => {
  const r = await refusing(() => postEntry(ctx, { unitRowId: i.unitId, kind: 'CREDIT', amount: i.amount, date: i.date, memo: i.memo, reason: i.reason, reversesEntryRowId: i.reversesId }));
  return { notice: `Credit ${r.entryId} of ${formatCents(r.amountCents)} posted, reversing the entry.` };
});
