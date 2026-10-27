import { requireOrg } from '@/core/authz/guards';
import { ActionForm } from '@/core/ui/action-form';
import { asApp } from '@/meetings/db';
import { archiveAssociation } from './actions';

export const metadata = { title: 'Archive association' };

export default async function Archive({ params }: { params: Promise<{ org: string }> }) {
  const ctx = await requireOrg((await params).org, 'org.delete');
  const archive = await asApp((tx) => tx.orgArchive.findUnique({ where: { orgId: ctx.orgId } }));
  return (
    <main>
      <h1>Archive this association</h1>
      <p>
        An association with meetings, units, ledger entries or violations keeps them: those records are append-only and the
        tally&apos;s proof depends on them, so the association cannot be deleted (D-43). Archiving keeps every record readable
        and refuses every new write. It is permanent.
      </p>
      {archive ? (
        <p className="archived">Archived on {archive.archivedAt.toISOString()}: {archive.reason}</p>
      ) : (
        <ActionForm action={archiveAssociation.bind(null, ctx.slug)}>
          <label>
            Reason <input name="reason" required maxLength={500} />
          </label>
          <button type="submit">Archive association</button>
        </ActionForm>
      )}
    </main>
  );
}
