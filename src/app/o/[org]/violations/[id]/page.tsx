import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOrg } from '@/core/authz/guards';
import { can } from '@/core/authz/permissions';
import { ActionForm } from '@/core/ui/action-form';
import { ScopeNote } from '@/components/honesty';
import { formatCents } from '@/ledger/money';
import { assertUuid, associationZone } from '@/meetings/admin';
import { wallDay } from '@/meetings/clock';
import { asApp } from '@/meetings/db';
import { ownUnitRowIds } from '@/meetings/owners';
import { nextStates } from '@/violations/machine';
import { transitionAction } from './actions';

export const metadata = { title: 'Violation' };

// Task 3.6: one record with its event trail and the transitions the machine allows from its current state.
export default async function ViolationPage({ params }: { params: Promise<{ org: string; id: string }> }) {
  const ctx = await requireOrg((await params).org);
  const { id } = await params;
  const board = can(ctx.role, 'org.update');
  const v = await asApp(async (tx) => {
    assertUuid(id);
    const row = await tx.violation.findFirst({ where: { id, orgId: ctx.orgId }, include: { unit: { select: { id: true, unitId: true } }, events: { orderBy: { seq: 'asc' }, include: { ledgerEntry: { select: { entryId: true } } } } } });
    if (!row) notFound();
    if (!board && !(await ownUnitRowIds(tx, ctx.orgId, ctx.userId)).has(row.unit.id)) notFound();
    return { row, today: wallDay(await associationZone(tx, ctx.orgId)) };
  });
  const r = v.row;
  const current = r.events.at(-1)!.state;
  const next = nextStates(current);
  return (
    <main>
      <h1>{r.number}: {r.title}</h1>
      <ScopeNote />
      <p><Link href={`/o/${ctx.slug}/violations`}>All violations</Link> · unit <Link href={`/o/${ctx.slug}/ledger/${r.unit.id}`}>{r.unit.unitId}</Link> · opened {r.openedOn} · now <strong>{current}</strong></p>
      <h2>Trail</h2>
      <table>
        <thead><tr><th scope="col">#</th><th scope="col">State</th><th scope="col">Day</th><th scope="col">Detail</th><th scope="col">Reason</th></tr></thead>
        <tbody>
          {r.events.map((e) => (
            <tr key={e.id}><td>{e.seq}</td><td>{e.state}</td><td>{e.day}</td><td>{e.hearingOn ? `hearing ${e.hearingOn}` : ''}{e.fineCents ? `fine ${formatCents(e.fineCents)} posted as ${e.ledgerEntry?.entryId}` : ''}</td><td>{e.reason}</td></tr>
          ))}
        </tbody>
      </table>
      {board && (next.length ? (
        <>
          <h2>Next step</h2>
          <ActionForm action={transitionAction.bind(null, ctx.slug)}>
            <input type="hidden" name="violationId" value={r.id} />
            <label>To <select name="to" required>{next.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
            <label>Day <input name="day" defaultValue={v.today} pattern="\d{4}-\d{2}-\d{2}" required /></label>
            <label>Hearing date (for HEARING_SCHEDULED) <input name="hearingOn" pattern="\d{4}-\d{2}-\d{2}" /></label>
            <label>Fine ($, for FINE_ASSESSED) <input name="fine" inputMode="decimal" /></label>
            <label>Reason <input name="reason" /></label>
            <button type="submit">Record step</button>
          </ActionForm>
        </>
      ) : (
        <p>{current} is final: nothing follows it.</p>
      ))}
    </main>
  );
}
