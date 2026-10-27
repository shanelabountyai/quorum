import Link from 'next/link';
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
      <h1>Your associations</h1>
      <p>Signed in as {s.email} · <Link href="/onboarding">Create or join an org</Link> · <Link href="/account/security">Account</Link></p>
      {live.length ? (
        <ul>
          {live.map((m) => (
            <li key={m.org.slug}><Link href={`/o/${m.org.slug}`}>{m.org.name}</Link> ({m.role})</li>
          ))}
        </ul>
      ) : (
        <p>You are not in an active association.</p>
      )}
      {archived.size > 0 && <p>{archived.size} archived association{archived.size === 1 ? ' is' : 's are'} hidden.</p>}
    </main>
  );
}
