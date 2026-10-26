import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOrg } from '@/core/authz/guards';
import { can } from '@/core/authz/permissions';
import { ActionForm } from '@/core/ui/action-form';
import { ScopeNote } from '@/components/honesty';
import { statementInTx, type StatementLine } from '@/ledger/ledger';
import { formatCents } from '@/ledger/money';
import { assertUuid, associationZone } from '@/meetings/admin';
import { wallDay } from '@/meetings/clock';
import { asApp } from '@/meetings/db';
import { ownUnitRowIds } from '@/meetings/owners';
import { isCalendarDay, type CalendarDay } from '@/tally/time';
import { postCreditAction, postPaymentAction, reverseEntryAction } from './actions';

export const metadata = { title: 'Unit statement' };

function Lines({ lines }: { lines: StatementLine[] }) {
  return (
    <table>
      <thead><tr><th scope="col">Date</th><th scope="col">Entry</th><th scope="col">Kind</th><th scope="col" className="num">Amount</th><th scope="col">Memo / reason</th><th scope="col" className="num">Balance after the day</th></tr></thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.rowId}><td>{l.date}</td><td>{l.entryId}</td><td>{l.kind}</td><td className="num">{formatCents(l.amountCents)}</td><td>{l.memo}{l.reason ? ` — ${l.reason}` : ''}{l.reverses ? ` (reverses ${l.reverses})` : ''}</td><td className="num">{formatCents(l.balanceAfterDay)}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

// Task 3.5: one unit's statement as of a day. A member sees only a unit they own (O-8); the board sees all.
export default async function Statement({ params, searchParams }: { params: Promise<{ org: string; unit: string }>; searchParams: Promise<{ asOf?: string }> }) {
  const ctx = await requireOrg((await params).org);
  const { unit } = await params;
  const q = await searchParams;
  const board = can(ctx.role, 'org.update');
  const v = await asApp(async (tx) => {
    assertUuid(unit);
    if (!board && !(await ownUnitRowIds(tx, ctx.orgId, ctx.userId)).has(unit)) notFound();
    const asOf = (isCalendarDay(q.asOf) ? q.asOf : wallDay(await associationZone(tx, ctx.orgId))) as CalendarDay;
    return { asOf, today: wallDay(await associationZone(tx, ctx.orgId)), s: await statementInTx(tx, ctx.orgId, unit, asOf) };
  });
  const s = v.s;
  return (
    <main>
      <h1>Unit {s.unitId}: statement</h1>
      <ScopeNote />
      <p><Link href={`/o/${ctx.slug}/ledger`}>All units</Link></p>
      <form method="get">
        <label>As of <input name="asOf" defaultValue={v.asOf} pattern="\d{4}-\d{2}-\d{2}" /></label> <button type="submit">Show</button>
      </form>
      <p>Balance as of {s.asOf}: <strong data-testid="balance">{formatCents(s.balanceCents)}</strong> ({s.delinquent ? 'delinquent: a ballot from this unit is rejected INELIGIBLE_DELINQUENT when the meeting suspends delinquent units' : 'good standing'}).</p>
      <Lines lines={s.lines} />
      {s.later.length > 0 && (<><h2>Dated after {s.asOf}</h2><Lines lines={s.later} /></>)}
      {board && (
        <>
          <h2>Post a payment</h2>
          <ActionForm action={postPaymentAction.bind(null, ctx.slug)}>
            <input type="hidden" name="unitId" value={unit} />
            <label>Amount ($) <input name="amount" inputMode="decimal" required /></label>
            <label>Date <input name="date" defaultValue={v.today} pattern="\d{4}-\d{2}-\d{2}" required /></label>
            <label>Memo <input name="memo" /></label>
            <button type="submit">Post payment</button>
          </ActionForm>
          <h2>Post a credit</h2>
          <ActionForm action={postCreditAction.bind(null, ctx.slug)}>
            <input type="hidden" name="unitId" value={unit} />
            <label>Amount ($) <input name="amount" inputMode="decimal" required /></label>
            <label>Date <input name="date" defaultValue={v.today} pattern="\d{4}-\d{2}-\d{2}" required /></label>
            <label>Reason <input name="reason" required /></label>
            <label>Memo <input name="memo" /></label>
            <button type="submit">Post credit</button>
          </ActionForm>
          {s.lines.filter((l) => l.kind !== 'CREDIT' && l.kind !== 'PAYMENT').length > 0 && (
            <>
              <h2>Reverse a charge or fine</h2>
              <ActionForm action={reverseEntryAction.bind(null, ctx.slug)}>
                <input type="hidden" name="unitId" value={unit} />
                <label>Entry <select name="reversesId" required>{[...s.lines, ...s.later].filter((l) => l.kind === 'CHARGE' || l.kind === 'FINE').map((l) => <option key={l.rowId} value={l.rowId}>{l.date} {l.entryId} {l.kind} {formatCents(l.amountCents)}</option>)}</select></label>
                <label>Amount ($) <input name="amount" inputMode="decimal" required /></label>
                <label>Date <input name="date" defaultValue={v.today} pattern="\d{4}-\d{2}-\d{2}" required /></label>
                <label>Reason <input name="reason" required /></label>
                <button type="submit">Post reversing credit</button>
              </ActionForm>
            </>
          )}
        </>
      )}
    </main>
  );
}
