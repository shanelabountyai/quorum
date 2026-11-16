import Link from 'next/link';
import { EmptyState, LinkButton, Notice, PageHeader, Pill, Section, Stat, Stats } from '@/components/ui';
import { requireOrg } from '@/core/authz/guards';
import { can } from '@/core/authz/permissions';
import { ScopeNote } from '@/components/honesty';
import { asApp } from '@/meetings/db';
import { linkedOwner } from '@/meetings/owners';

export const metadata = { title: 'Association' };

// The association's home: what it holds, who the signed-in user is on the roster, and whether it is archived.
export default async function OrgHome({ params }: { params: Promise<{ org: string }> }) {
  const ctx = await requireOrg((await params).org);
  const base = `/o/${ctx.slug}`;
  const v = await asApp(async (tx) => ({
    archive: await tx.orgArchive.findUnique({ where: { orgId: ctx.orgId } }),
    units: await tx.unit.count({ where: { orgId: ctx.orgId } }),
    owners: await tx.owner.count({ where: { orgId: ctx.orgId } }),
    meetings: await tx.meeting.findMany({ where: { orgId: ctx.orgId }, orderBy: { createdAt: 'desc' }, select: { id: true, meetingId: true, title: true, status: true } }),
    violations: await tx.violation.count({ where: { orgId: ctx.orgId } }),
    me: await linkedOwner(tx, ctx.orgId, ctx.userId),
  }));
  const board = can(ctx.role, 'org.update');
  return (
    <main>
      <PageHeader eyebrow="Association" title="Association home" lead="Meetings, the roster, the dues ledger and violations for this association." />
      {v.archive && (
        <Notice k="done" title="Archived">
          Archived on {v.archive.archivedAt.toISOString()} — {v.archive.reason}. The history can be read; nothing new can be written (D-43).
        </Notice>
      )}
      <ScopeNote />
      {v.units === 0 && board ? (
        <EmptyState action={<LinkButton href={`${base}/roster`}>Import the roster</LinkButton>}>No roster yet: the units, shares and owners come first.</EmptyState>
      ) : (
        <Stats>
          <Stat label="Units" value={v.units} />
          <Stat label="Owners on the roster" value={v.owners} />
          <Stat label="Meetings" value={v.meetings.length} />
          <Stat label="Violations" value={v.violations} />
        </Stats>
      )}
      <p>
        You are signed in as a <strong>{ctx.role}</strong>
        {v.me ? <> linked to roster owner <strong>{v.me.ownerId}</strong> ({v.me.name}).</> : <>. Your account is not linked to a roster owner: a link is made when you accept an invite sent to the email the association has on file for you (D-39).</>}
      </p>
      <Section id="meetings-h" title="Meetings" aside={<LinkButton href={`${base}/meetings`} variant="ghost">All meetings</LinkButton>}>
        {v.meetings.length ? (
          <ul className="stack" style={{ listStyle: 'none', padding: 0 }}>
            {v.meetings.map((m) => (
              <li key={m.id} className="cluster">
                <Link href={`${base}/meetings/${m.id}`}>{m.meetingId}</Link> {m.title} <Pill k={m.status === 'CLOSED' ? 'done' : 'info'}>{m.status}</Pill>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState>No meetings yet.</EmptyState>
        )}
      </Section>
    </main>
  );
}
