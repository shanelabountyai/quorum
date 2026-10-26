import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOrg } from '@/core/authz/guards';
import { can } from '@/core/authz/permissions';
import { ActionForm } from '@/core/ui/action-form';
import { CastForm } from '@/components/cast-form';
import { contestFields } from '@/components/contest-fields';
import { RECEIPT_LIMIT, ScopeNote } from '@/components/honesty';
import { meetingInOrg } from '@/meetings/admin';
import { asApp } from '@/meetings/db';
import { deskCastAction, deskProxyCastAction, deskRevokeProxyAction } from './actions';

export const metadata = { title: 'Desk' };

// Task 3.2, the desk (D-39 b): board and manager cast for an owner chosen from the roster, or for a proxy holder.
// D-54 (owner decision, reverses D-45 here): anyone else is notFound — the same answer as a meeting that does not
// exist — decided from the membership row alone, before any meeting, roster or proxy row is read.
export default async function Desk({ params }: { params: Promise<{ org: string; id: string }> }) {
  const ctx = await requireOrg((await params).org);
  if (!can(ctx.role, 'org.update')) notFound();
  const { id } = await params;
  const v = await asApp(async (tx) => {
    const head = await meetingInOrg(tx, ctx.orgId, id);
    return {
      head,
      owners: await tx.owner.findMany({ where: { orgId: ctx.orgId }, orderBy: { ownerId: 'asc' }, select: { id: true, ownerId: true, name: true } }),
      units: await tx.unit.findMany({ where: { orgId: ctx.orgId }, orderBy: { unitId: 'asc' }, select: { id: true, unitId: true } }),
      proxies: await tx.proxy.findMany({ where: { meetingId: head.id }, orderBy: { proxyId: 'asc' }, include: { grantorUnit: { select: { unitId: true } }, grantorOwner: { select: { ownerId: true } }, holderOwner: { select: { ownerId: true } }, revocation: { select: { revokedAt: true } } } }),
    };
  });
  const fields = contestFields(v.head.definition);
  const revokedAt = (p: (typeof v.proxies)[number]) => p.revocation?.revokedAt ?? p.revokedAt;
  const revocable = v.proxies.filter((p) => !revokedAt(p));
  const back = `/o/${ctx.slug}/meetings/${v.head.id}`;
  return (
    <main>
      <h1>Desk: {v.head.meetingId}</h1>
      <ScopeNote />
      <p><Link href={back}>Back to the meeting</Link></p>
      {v.head.closedAt ? (
        <p>This meeting closed at {v.head.closedAt}; nothing more can be cast.</p>
      ) : (
        <>
          <p>You cast for the owner in front of you. The engine judges the ballot as if they had cast it; your account is recorded in the sealed link (unreadable after close), not in the audit log (D-39). Hand them the receipt and the nonce: they are shown once.</p>
          <section aria-labelledby="direct-h">
            <h2 id="direct-h">Direct ballot</h2>
            <CastForm action={deskCastAction.bind(null, ctx.slug)} contests={fields} limit={RECEIPT_LIMIT}>
              <input type="hidden" name="meetingId" value={v.head.id} />
              <label>Owner <select name="ownerId" required>{v.owners.map((o) => <option key={o.id} value={o.id}>{o.ownerId} {o.name}</option>)}</select></label>
              <label>Unit <select name="unitId" required>{v.units.map((u) => <option key={u.id} value={u.id}>{u.unitId}</option>)}</select></label>
            </CastForm>
          </section>
          {v.proxies.length > 0 && (
            <section aria-labelledby="proxy-h">
              <h2 id="proxy-h">Proxy ballot (cast for the holder)</h2>
              <CastForm action={deskProxyCastAction.bind(null, ctx.slug)} contests={fields} limit={RECEIPT_LIMIT}>
                <input type="hidden" name="meetingId" value={v.head.id} />
                <label>Proxy <select name="proxyId" required>{v.proxies.map((p) => <option key={p.id} value={p.id}>{p.proxyId}: {p.grantorUnit.unitId} held by {p.holderOwner.ownerId}{revokedAt(p) ? ` (revoked ${revokedAt(p)})` : ''}</option>)}</select></label>
              </CastForm>
            </section>
          )}
          {revocable.length > 0 && (
            <section aria-labelledby="revoke-h">
              <h2 id="revoke-h">Revoke a proxy for its grantor</h2>
              <p>For a grantor who revokes in person or on paper. The revocation is recorded at the meeting&apos;s clock with your account and the reason; a ballot cast with the proxy afterwards is rejected PROXY_REVOKED, and one already cast keeps its label (D-55).</p>
              <ActionForm action={deskRevokeProxyAction.bind(null, ctx.slug)}>
                <input type="hidden" name="meetingId" value={v.head.id} />
                <label>Proxy to revoke <select name="proxyId" required>{revocable.map((p) => <option key={p.id} value={p.id}>{p.proxyId}: {p.grantorUnit.unitId} granted by {p.grantorOwner.ownerId}, held by {p.holderOwner.ownerId}</option>)}</select></label>
                <label>Reason <input name="reason" required maxLength={500} placeholder="e.g. grantor presented a signed revocation" /></label>
                <button type="submit">Revoke proxy</button>
              </ActionForm>
            </section>
          )}
        </>
      )}
    </main>
  );
}
