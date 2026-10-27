import Link from 'next/link';
import { EmptyState, PageHeader, Pill, Section, violationKind } from '@/components/ui';
import { requireOrg } from '@/core/authz/guards';
import { can } from '@/core/authz/permissions';
import { ActionForm } from '@/core/ui/action-form';
import { ScopeNote } from '@/components/honesty';
import { associationZone } from '@/meetings/admin';
import { wallDay } from '@/meetings/clock';
import { asApp } from '@/meetings/db';
import { ownUnitRowIds } from '@/meetings/owners';
import { openViolationAction } from './actions';

export const metadata = { title: 'Violations' };

// Task 3.6: the list, each with its current state (its latest event). A member sees their own units' records.
export default async function Violations({ params }: { params: Promise<{ org: string }> }) {
  const ctx = await requireOrg((await params).org);
  const board = can(ctx.role, 'org.update');
  const v = await asApp(async (tx) => {
    const own = board ? null : await ownUnitRowIds(tx, ctx.orgId, ctx.userId);
    const rows = await tx.violation.findMany({ where: { orgId: ctx.orgId, ...(own ? { unitId: { in: [...own] } } : {}) }, orderBy: { number: 'asc' }, include: { unit: { select: { unitId: true } }, events: { orderBy: { seq: 'desc' }, take: 1 } } });
    const units = board ? await tx.unit.findMany({ where: { orgId: ctx.orgId }, orderBy: { unitId: 'asc' }, select: { id: true, unitId: true } }) : [];
    return { rows, units, today: wallDay(await associationZone(tx, ctx.orgId)) };
  });
  return (
    <main>
      <PageHeader eyebrow="Association" title="Violations" lead="Each record moves only along the workflow, and every step is permanent." />
      <ScopeNote>A violation moves only along the workflow (notice, hearing, continued, fine or dismissed); each step is a permanent record with who, when and why (D-22).</ScopeNote>
      {v.rows.length ? (
        <table>
          <thead><tr><th scope="col">Record</th><th scope="col">Unit</th><th scope="col">Opened</th><th scope="col">State</th></tr></thead>
          <tbody>
            {v.rows.map((r) => (
              <tr key={r.id}><td><Link href={`/o/${ctx.slug}/violations/${r.id}`}>{r.number}</Link> {r.title}</td><td>{r.unit.unitId}</td><td>{r.openedOn}</td><td>{r.events[0] && <Pill k={violationKind(r.events[0].state)}>{r.events[0].state}</Pill>}</td></tr>
            ))}
          </tbody>
        </table>
      ) : (
        <EmptyState>No violations{board ? '' : ' on your units'}.</EmptyState>
      )}
      {board && (
        <Section id="open-h" title="Open a violation">
          <ActionForm action={openViolationAction.bind(null, ctx.slug)}>
            <label>Unit <select name="unitId" required>{v.units.map((u) => <option key={u.id} value={u.id}>{u.unitId}</option>)}</select></label>
            <label>What <input name="title" required maxLength={300} /></label>
            <label>Notice date <input name="day" defaultValue={v.today} pattern="\d{4}-\d{2}-\d{2}" required /></label>
            <button type="submit">Open and queue the notice</button>
          </ActionForm>
        </Section>
      )}
    </main>
  );
}
