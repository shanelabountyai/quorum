import Link from 'next/link';
import { Pill } from '@/components/pill';
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
      <h1>Association home</h1>
      {v.archive && (
        <p className="archived" role="note">
          Archived on {v.archive.archivedAt.toISOString()} — {v.archive.reason}. The history can be read; nothing new can be written (D-43).
        </p>
      )}
      <ScopeNote />
      <p>
        {v.units} units, {v.owners} owners on the roster, {v.meetings.length} meetings, {v.violations} violations.{' '}
        {v.units === 0 && board && <Link href={`${base}/roster`}>Import the roster</Link>}
      </p>
      <p>
        You are signed in as a <strong>{ctx.role}</strong>
        {v.me ? <> linked to roster owner <strong>{v.me.ownerId}</strong> ({v.me.name}).</> : <>. Your account is not linked to a roster owner: a link is made when you accept an invite sent to the email the association has on file for you (D-39).</>}
      </p>
      <h2>Meetings</h2>
      {v.meetings.length ? (
        <ul>
          {v.meetings.map((m) => (
            <li key={m.id}>
              <Link href={`${base}/meetings/${m.id}`}>{m.meetingId}</Link> {m.title} <Pill k={m.status === 'CLOSED' ? 'done' : 'info'}>{m.status}</Pill>
            </li>
          ))}
        </ul>
      ) : (
        <p>No meetings yet.</p>
      )}
    </main>
  );
}
