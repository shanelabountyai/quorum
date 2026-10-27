import Link from 'next/link';
import { Pill } from '@/components/pill';
import { requireOrg } from '@/core/authz/guards';
import { can } from '@/core/authz/permissions';
import { ActionForm } from '@/core/ui/action-form';
import { ScopeNote } from '@/components/honesty';
import { balancesInTx } from '@/ledger/ledger';
import { formatCents } from '@/ledger/money';
import { associationZone } from '@/meetings/admin';
import { wallDay } from '@/meetings/clock';
import { asApp } from '@/meetings/db';
import { ownUnitRowIds } from '@/meetings/owners';
import { isCalendarDay, type CalendarDay } from '@/tally/time';
import { runDuesAction } from './actions';

export const metadata = { title: 'Ledger' };

// Task 3.5: balances as of a day (E-4, the engine's), the dues runs, and the run form. Board and manager see every
// unit (O-8); a member sees only the units they own.
export default async function Ledger({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<{ asOf?: string }> }) {
  const ctx = await requireOrg((await params).org);
  const q = await searchParams;
  const board = can(ctx.role, 'org.update');
  const v = await asApp(async (tx) => {
    const asOf = (isCalendarDay(q.asOf) ? q.asOf : wallDay(await associationZone(tx, ctx.orgId))) as CalendarDay;
    const own = board ? null : await ownUnitRowIds(tx, ctx.orgId, ctx.userId);
    const balances = (await balancesInTx(tx, ctx.orgId, asOf)).filter((b) => own === null || own.has(b.unitRowId));
    const runs = board ? await tx.duesRun.findMany({ where: { orgId: ctx.orgId }, orderBy: { month: 'desc' } }) : [];
    return { asOf, balances, runs };
  });
  const base = `/o/${ctx.slug}/ledger`;
  const delinquent = v.balances.filter((b) => b.delinquent);
  return (
    <main>
      <h1>Ledger</h1>
      <ScopeNote>Balances are Σ charges and fines − Σ payments and credits dated on or before the day (E-4), in integer cents; nothing is collected.</ScopeNote>
      <form method="get">
        <label>As of <input name="asOf" defaultValue={v.asOf} pattern="\d{4}-\d{2}-\d{2}" /></label> <button type="submit">Show</button>
      </form>
      {board && <p>Delinquent as of {v.asOf}: {delinquent.map((b) => b.unitId).join(', ') || 'none'}.</p>}
      {!board && v.balances.length === 0 && <p>Your account is not linked to a roster owner, so there is no unit to show. Board and manager see every unit (O-8).</p>}
      {v.balances.length > 0 && (
        <table>
          <thead><tr><th scope="col">Unit</th><th scope="col" className="num">Balance as of {v.asOf}</th><th scope="col">Standing</th></tr></thead>
          <tbody>
            {v.balances.map((b) => (
              <tr key={b.unitRowId}><td><Link href={`${base}/${b.unitRowId}?asOf=${v.asOf}`}>{b.unitId}</Link></td><td className="num">{formatCents(b.balanceCents)}</td><td><Pill k={b.delinquent ? 'risk' : 'good'}>{b.delinquent ? 'delinquent' : 'good standing'}</Pill></td></tr>
            ))}
          </tbody>
        </table>
      )}
      {board && (
        <>
          <h2>Dues runs</h2>
          {v.runs.length ? (
            <table>
              <thead><tr><th scope="col">Month</th><th scope="col" className="num">Budget</th><th scope="col" className="num">Charged to {v.runs[0]!.units} units</th><th scope="col" className="num">ROUNDING line</th></tr></thead>
              <tbody>
                {v.runs.map((r) => (
                  <tr key={r.id}><td>{r.month}</td><td className="num">{formatCents(r.budgetCents)}</td><td className="num">{formatCents(r.postedCents)}</td><td className="num">{formatCents(r.roundingCents)}</td></tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>No dues run posted from this screen yet.</p>
          )}
          <h2>Post a month&apos;s dues</h2>
          <p>Each unit is charged budget × its share ÷ 10000, rounded down to the cent; what that leaves is the association&apos;s ROUNDING line, so the month sums to the budget exactly (D-21). A month posts once.</p>
          <ActionForm action={runDuesAction.bind(null, ctx.slug)}>
            <label>Month <input name="month" placeholder="YYYY-MM" pattern="\d{4}-\d{2}" required /></label>
            <label>Monthly budget ($) <input name="budget" placeholder="35000.00" inputMode="decimal" required /></label>
            <button type="submit">Post dues</button>
          </ActionForm>
        </>
      )}
    </main>
  );
}
