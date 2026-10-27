import Link from 'next/link';
import { EmptyState, LinkButton, PageHeader, Pill } from '@/components/ui';
import { requireUser } from '@/core/auth/session';
import { db } from '@/core/db';

export const metadata = { title: 'Your associations' };

// D-43: the clone's org list, with archived associations hidden. (The template's /onboarding, where a sign-in lands,
// is template-owned and still lists every org; stated in docs/decisions.md.)
export default async function Associations() {
  const s = await requireUser();
  const memberships = await db.membership.findMany({ where: { userId: s.userId }, select: { role: true, org: { select: { id: true, slug: true, name: true } } }, orderBy: { createdAt: 'asc' } });
  const archived = new Set((await db.orgArchive.findMany({ where: { orgId: { in: memberships.map((m) => m.org.id) } }, select: { orgId: true } })).map((a) => a.orgId));
  const live = memberships.filter((m) => !archived.has(m.org.id));
  return (
    <main>
      <PageHeader
        title="Your associations"
        lead={<>Signed in as {s.email}</>}
        actions={<><LinkButton href="/onboarding" variant="secondary">Create or join an org</LinkButton><LinkButton href="/account/security" variant="ghost">Account</LinkButton></>}
      />
      {live.length ? (
        <ul className="stack" style={{ listStyle: 'none', padding: 0 }}>
          {live.map((m) => (
            <li key={m.org.slug} className="card cluster" style={{ justifyContent: 'space-between' }}>
              <Link href={`/o/${m.org.slug}`}><strong>{m.org.name}</strong></Link>
              <Pill k="info">{m.role}</Pill>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState action={<LinkButton href="/onboarding">Create or join an org</LinkButton>}>You are not in an active association.</EmptyState>
      )}
      {archived.size > 0 && <p>{archived.size} archived association{archived.size === 1 ? ' is' : 's are'} hidden.</p>}
    </main>
  );
}
