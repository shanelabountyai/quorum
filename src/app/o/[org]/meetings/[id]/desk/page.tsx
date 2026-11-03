import { MeetingTabs, PageHeader, Section } from '@/components/ui';
import { requireOrg } from '@/core/authz/guards';
import { CastForm } from '@/components/cast-form';
import { contestFields } from '@/components/contest-fields';
import { RECEIPT_LIMIT, ScopeNote } from '@/components/honesty';
import { meetingInOrg } from '@/meetings/admin';
import { asApp } from '@/meetings/db';
import { deskCastAction, deskProxyCastAction } from './actions';

export const metadata = { title: 'Desk' };

// Task 3.2, the desk (D-39 b): board and manager cast for an owner chosen from the roster, or for a proxy holder.
export default async function Desk({ params }: { params: Promise<{ org: string; id: string }> }) {
  const ctx = await requireOrg((await params).org, 'org.update');
  const { id } = await params;
  const v = await asApp(async (tx) => {
    const head = await meetingInOrg(tx, ctx.orgId, id);
    return {
      head,
      owners: await tx.owner.findMany({ where: { orgId: ctx.orgId }, orderBy: { ownerId: 'asc' }, select: { id: true, ownerId: true, name: true } }),
      units: await tx.unit.findMany({ where: { orgId: ctx.orgId }, orderBy: { unitId: 'asc' }, select: { id: true, unitId: true } }),
      proxies: await tx.proxy.findMany({ where: { meetingId: head.id }, orderBy: { proxyId: 'asc' }, include: { grantorUnit: { select: { unitId: true } }, holderOwner: { select: { ownerId: true } } } }),
    };
  });
  const fields = contestFields(v.head.definition);
  const back = `/o/${ctx.slug}/meetings/${v.head.id}`;
  return (
    <main>
      <PageHeader eyebrow="Meeting" title={`Desk: ${v.head.meetingId}`} lead="Cast for the owner in front of you, from a paper ballot." />
      <MeetingTabs base={back} board />
      <ScopeNote />
      {v.head.closedAt ? (
        <p>This meeting closed at {v.head.closedAt}; nothing more can be cast.</p>
      ) : (
        <>
          <p>You cast for the owner in front of you. The engine judges the ballot as if they had cast it; your account is recorded in the sealed link (unreadable after close), not in the audit log (D-39). Hand them the receipt and the nonce: they are shown once.</p>
          <Section id="direct-h" title="Direct ballot">
            <CastForm action={deskCastAction.bind(null, ctx.slug)} contests={fields} limit={RECEIPT_LIMIT}>
              <input type="hidden" name="meetingId" value={v.head.id} />
              <label>Owner <select name="ownerId" required>{v.owners.map((o) => <option key={o.id} value={o.id}>{o.ownerId} {o.name}</option>)}</select></label>
              <label>Unit <select name="unitId" required>{v.units.map((u) => <option key={u.id} value={u.id}>{u.unitId}</option>)}</select></label>
            </CastForm>
          </Section>
          {v.proxies.length > 0 && (
            <Section id="proxy-h" title="Proxy ballot (cast for the holder)">
              <CastForm action={deskProxyCastAction.bind(null, ctx.slug)} contests={fields} limit={RECEIPT_LIMIT}>
                <input type="hidden" name="meetingId" value={v.head.id} />
                <label>Proxy <select name="proxyId" required>{v.proxies.map((p) => <option key={p.id} value={p.id}>{p.proxyId}: {p.grantorUnit.unitId} held by {p.holderOwner.ownerId}</option>)}</select></label>
              </CastForm>
            </Section>
          )}
        </>
      )}
    </main>
  );
}
