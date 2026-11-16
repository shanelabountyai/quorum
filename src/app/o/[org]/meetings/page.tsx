import Link from 'next/link';
import { EmptyState, PageHeader, Pill, Section } from '@/components/ui';
import { requireOrg } from '@/core/authz/guards';
import { can } from '@/core/authz/permissions';
import { ActionForm } from '@/core/ui/action-form';
import { asApp } from '@/meetings/db';
import { parseMeeting } from '@/tally/rules';
import { createMeetingAction } from './actions';

export const metadata = { title: 'Meetings' };

export default async function Meetings({ params }: { params: Promise<{ org: string }> }) {
  const ctx = await requireOrg((await params).org);
  const rows = await asApp((tx) => tx.meeting.findMany({ where: { orgId: ctx.orgId }, orderBy: { createdAt: 'desc' } }));
  const base = `/o/${ctx.slug}`;
  return (
    <main>
      <PageHeader eyebrow="Association" title="Meetings" lead="Each meeting is its rules, its contests and its ballots. Results are computed once, when the board closes it." />
      {rows.length ? (
        <table>
          <thead>
            <tr><th scope="col">Meeting</th><th scope="col">Status</th><th scope="col">Record date</th><th scope="col">Window</th></tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const r = parseMeeting(m.definition).rules;
              return (
                <tr key={m.id}>
                  <td><Link href={`${base}/meetings/${m.id}`}>{m.meetingId}</Link> {m.title}</td>
                  <td><Pill k={m.status === 'CLOSED' ? 'done' : 'info'}>{m.status}</Pill></td>
                  <td>{r.record_date}</td>
                  <td>{r.open_at} to {r.close_at} ({r.timezone_label})</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <EmptyState>No meetings yet.</EmptyState>
      )}
      {can(ctx.role, 'org.update') && (
        <Section id="create-h" title="Create a meeting">
          <p>Paste the meeting&apos;s <code>meeting.json</code>: its rules (record date, window, quorum, proxy and delinquency rules) and its contests. The engine&apos;s closed vocabulary decides what is valid; nothing outside it is accepted.</p>
          <ActionForm action={createMeetingAction.bind(null, ctx.slug)}>
            <label htmlFor="definition">meeting.json</label>
            <textarea id="definition" name="definition" rows={12} required />
            <button type="submit">Create meeting</button>
          </ActionForm>
        </Section>
      )}
    </main>
  );
}
