'use server';
import { z } from 'zod';
import { orgAction } from '@/core/authz/action';
import { describeRun, runDues } from '@/ledger/ledger';
import { parseDollars } from '@/ledger/money';
import { refusing } from '@/meetings/refuse';
import { Refused } from '@/core/errors';

// Task 3.5: the monthly dues run (D-21), board and manager only. The budget is typed in dollars and read as integer
// cents by string; a month posts once.
export const runDuesAction = orgAction('org.update', z.object({ month: z.string().max(7), budget: z.string().max(20) }), async (ctx, { month, budget }) => {
  const cents = parseDollars(budget);
  if (cents === null) throw new Refused('Give the monthly budget in dollars, e.g. 35000.00.');
  const r = await refusing(() => runDues(ctx, month, cents));
  return { notice: `Posted ${describeRun({ month: r.month, budgetCents: cents, postedCents: r.allocation.postedCents, roundingCents: r.allocation.roundingCents, units: r.allocation.charges.length })}.` };
});
