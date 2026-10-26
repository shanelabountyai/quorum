import Link from 'next/link';
import { requireOrg } from '@/core/authz/guards';
import { ActionForm } from '@/core/ui/action-form';
import { CastForm } from '@/components/cast-form';
import { contestFields } from '@/components/contest-fields';
import { RECEIPT_LIMIT, ScopeNote } from '@/components/honesty';
import { meetingInOrg } from '@/meetings/admin';
import { asApp } from '@/meetings/db';
import { linkedOwner } from '@/meetings/owners';
import { proxiesGrantedBy } from '@/meetings/revoke';
import { readRoster } from '@/meetings/roster';
import { ownersOfUnit } from '@/tally/asof';
import { castByProxyAction, castOwnAction, revokeOwnProxyAction } from './actions';

export const metadata = { title: 'Vote' };

// Task 3.2: a linked member's ballot — for each unit they own as of the record date, and for each proxy they hold.
export default async function Vote({ params }: { params: Promise<{ org: string; id: string }> }) {
  const ctx = await requireOrg((await params).org);
  const { id } = await params;
  const v = await asApp(async (tx) => {
    const head = await meetingInOrg(tx, ctx.orgId, id);
    const me = await linkedOwner(tx, ctx.orgId, ctx.userId);
    if (!me) return { head, me, units: [], proxies: [], granted: [] };
    const roster = await readRoster(tx, ctx.orgId);
    const mine = roster.units.map((u) => u.unit_id).filter((u) => ownersOfUnit(roster.ownerships, u, head.definition.rules.record_date).has(me.ownerId));
    const units = await tx.unit.findMany({ where: { orgId: ctx.orgId, unitId: { in: mine } }, orderBy: { unitId: 'asc' }, select: { id: true, unitId: true } });
    const proxies = await tx.proxy.findMany({ where: { meetingId: head.id, holderOwnerId: me.ownerRowId }, orderBy: { proxyId: 'asc' }, include: { grantorUnit: { select: { unitId: true } }, revocation: { select: { revokedAt: true } } } });
    return { head, me, units, proxies, granted: await proxiesGrantedBy(tx, ctx.orgId, ctx.userId, head.id) };
  });
  const fields = contestFields(v.head.definition);
  const back = `/o/${ctx.slug}/meetings/${v.head.id}`;
  return (
    <main>
      <h1>Vote: {v.head.meetingId}</h1>
      <ScopeNote />
      <p><Link href={back}>Back to the meeting</Link></p>
      {v.head.closedAt ? (
        <p>This meeting closed at {v.head.closedAt}. See the <Link href={`${back}/results`}>results</Link> and look up your receipt there.</p>
      ) : !v.me ? (
        <p>Your account is not linked to an owner on the roster, so you cannot cast here. A link is made when you accept an invite sent to the email the association has on file for you; otherwise vote at the desk (D-39).</p>
      ) : (
        <>
          <p>You are voting as roster owner <strong>{v.me.ownerId}</strong> ({v.me.name}). One ballot per unit (O-7); the engine judges every ballot by the meeting&apos;s rules and tells you its code.</p>
          {v.units.map((u) => (
            <section key={u.id} aria-label={`Ballot for unit ${u.unitId}`}>
              <h2>Unit {u.unitId}</h2>
              <CastForm action={castOwnAction.bind(null, ctx.slug)} contests={fields} limit={RECEIPT_LIMIT}>
                <input type="hidden" name="meetingId" value={v.head.id} />
                <input type="hidden" name="unitId" value={u.id} />
              </CastForm>
            </section>
          ))}
          {v.units.length === 0 && <p>You own no unit as of the record date {v.head.definition.rules.record_date}.</p>}
          {v.proxies.map((p) => (
            <section key={p.id} aria-label={`Proxy ballot ${p.proxyId}`}>
              <h2>As proxy {p.proxyId} for unit {p.grantorUnit.unitId}</h2>
              {(p.revocation?.revokedAt ?? p.revokedAt) && <p>The grantor revoked this proxy at {p.revocation?.revokedAt ?? p.revokedAt}; a ballot cast with it now is rejected PROXY_REVOKED.</p>}
              <CastForm action={castByProxyAction.bind(null, ctx.slug)} contests={fields} limit={RECEIPT_LIMIT}>
                <input type="hidden" name="meetingId" value={v.head.id} />
                <input type="hidden" name="proxyId" value={p.id} />
              </CastForm>
            </section>
          ))}
          {v.granted.length > 0 && (
            <section aria-labelledby="granted-h">
              <h2 id="granted-h">Proxies you granted</h2>
              <p>You may revoke a proxy you granted until the meeting closes. A ballot your holder casts with it afterwards is rejected PROXY_REVOKED; one they already cast keeps its label, and your own ballot for the unit supersedes it (D-26).</p>
              <ul>
                {v.granted.map((g) => (
                  <li key={g.id}>
                    {g.proxyId}: unit {g.grantorUnit}, held by {g.holderOwner} {g.holderName}, received {g.receivedAt}.{' '}
                    {g.revokedAt ? (
                      <>Revoked at {g.revokedAt}.</>
                    ) : (
                      <ActionForm action={revokeOwnProxyAction.bind(null, ctx.slug)}>
                        <input type="hidden" name="meetingId" value={v.head.id} />
                        <input type="hidden" name="proxyId" value={g.id} />
                        <button type="submit">Revoke proxy {g.proxyId}</button>
                      </ActionForm>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </main>
  );
}
