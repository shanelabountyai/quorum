import { requireOrg } from '@/core/authz/guards';
import { EmptyState, PageHeader, Section } from '@/components/ui';
import { can } from '@/core/authz/permissions';
import { ActionForm } from '@/core/ui/action-form';
import { ScopeNote } from '@/components/honesty';
import { associationZone } from '@/meetings/admin';
import { asApp } from '@/meetings/db';
import { readRoster } from '@/meetings/roster';
import { wallDay } from '@/meetings/clock';
import { ownersOfUnit, shareBps } from '@/tally/asof';
import { isCalendarDay, type CalendarDay } from '@/tally/time';
import { importRosterAction } from './actions';

export const metadata = { title: 'Roster' };

const FILES = [
  ['units', 'units.csv (unit_id, unit_type, building, floor)'],
  ['unit_shares', 'unit_shares.csv (unit_id, share_bps, effective_from)'],
  ['owners', 'owners.csv (owner_id, name, email)'],
  ['ownerships', 'ownerships.csv (unit_id, owner_id, from_date, to_date)'],
  ['assessments', 'assessments.csv (entry_id, unit_id, kind, amount_cents, date, memo)'],
] as const;

// Task 3.4: units with the share and owners as of a chosen day (E-1, E-3), owners with their link state, the import.
export default async function Roster({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<{ asOf?: string }> }) {
  const ctx = await requireOrg((await params).org);
  const q = await searchParams;
  const board = can(ctx.role, 'org.update');
  const v = await asApp(async (tx) => {
    const zone = await associationZone(tx, ctx.orgId);
    const asOf = (isCalendarDay(q.asOf) ? q.asOf : wallDay(zone)) as CalendarDay;
    const roster = await readRoster(tx, ctx.orgId);
    const rows = await tx.unit.findMany({ where: { orgId: ctx.orgId }, orderBy: { unitId: 'asc' } });
    const owners = await tx.owner.findMany({ where: { orgId: ctx.orgId }, orderBy: { ownerId: 'asc' }, include: { link: { select: { linkedAt: true } } } });
    return { roster, rows, owners, asOf };
  });
  const asOf = v.asOf;
  const bpsOf = (unitId: string): number | null => {
    try {
      return shareBps(v.roster.shares, unitId, asOf);
    } catch {
      return null; // no share row in force on that day (before the declaration)
    }
  };
  const units = v.rows.map((u) => ({ ...u, bps: bpsOf(u.unitId), owners: [...ownersOfUnit(v.roster.ownerships, u.unitId, asOf)].sort() }));
  const total = units.reduce((n, u) => n + (u.bps ?? 0), 0);
  return (
    <main>
      <PageHeader eyebrow="Association" title="Roster" lead="Units, their shares and their owners, read as of the day you choose." />
      <ScopeNote>Shares and owners are read as of the day chosen (E-1, E-3); shares must sum to 10000 bps on every day (D-9).</ScopeNote>
      <form method="get">
        <label>As of <input name="asOf" defaultValue={asOf} pattern="\d{4}-\d{2}-\d{2}" /></label> <button type="submit">Show</button>
      </form>
      <p>{units.length} units; shares as of {asOf} sum to <strong>{total}</strong> bps{units.length && total !== 10000 ? ' — not 10000: a tally or a dues run on this day refuses (D-9)' : ''}.</p>
      {units.length > 0 && (
        <table>
          <thead><tr><th scope="col">Unit</th><th scope="col">Type</th><th scope="col">Building / floor</th><th scope="col" className="num">Share (bps)</th><th scope="col">Owners as of {asOf}</th></tr></thead>
          <tbody>
            {units.map((u) => (
              <tr key={u.id}><td>{u.unitId}</td><td>{u.unitType}</td><td>{u.building} / {u.floor}</td><td className="num">{u.bps ?? '—'}</td><td>{u.owners.join(', ') || '—'}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      <Section id="owners-h" title={`Owners (${v.owners.length})`}>
      {v.owners.length === 0 && <EmptyState>No owners on the roster yet.</EmptyState>}
      {v.owners.length > 0 && (
        <table>
          <thead><tr><th scope="col">Owner</th><th scope="col">Name</th>{board && <th scope="col">Email</th>}<th scope="col">Account linked</th></tr></thead>
          <tbody>
            {v.owners.map((o) => (
              <tr key={o.id}><td>{o.ownerId}</td><td>{o.name}</td>{board && <td>{o.email}</td>}<td>{o.link ? 'yes' : 'no'}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      </Section>
      {board && (
        <Section id="import-h" title="Import the roster">
          <p>Write-once: a first import inserts every row; importing the same files again inserts nothing and says so; files that differ from what is stored are refused before anything is written.</p>
          <ActionForm action={importRosterAction.bind(null, ctx.slug)}>
            {FILES.map(([name, label]) => (
              <p key={name}>
                <label htmlFor={`f-${name}`}>{label}</label>
                <textarea id={`f-${name}`} name={name} rows={4} required />
              </p>
            ))}
            <button type="submit">Import roster</button>
          </ActionForm>
        </Section>
      )}
    </main>
  );
}
