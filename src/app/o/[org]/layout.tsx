import Link from 'next/link';
import { can } from '@/core/authz/permissions';
import { requireOrg } from '@/core/authz/guards';
import { db } from '@/core/db';

// Navigation only. Layouts do not re-run on every navigation, so each page calls requireOrg itself.
export default async function OrgLayout({ children, params }: { children: React.ReactNode; params: Promise<{ org: string }> }) {
  const ctx = await requireOrg((await params).org);
  const org = await db.org.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { name: true } });
  const base = `/o/${ctx.slug}`;
  return (
    <>
      <nav aria-label="Association">
        <strong>{org.name}</strong> · <Link href={base}>Home</Link> · <Link href={`${base}/meetings`}>Meetings</Link> · <Link href={`${base}/roster`}>Roster</Link> · <Link href={`${base}/ledger`}>Ledger</Link> · <Link href={`${base}/violations`}>Violations</Link> · <Link href={`${base}/settings/members`}>Members</Link>
        {can(ctx.role, 'org.delete') && <> · <Link href={`${base}/settings/archive`}>Archive</Link> · <Link href={`${base}/settings/danger`}>Delete org</Link></>}
        {' · '}<Link href="/associations">Your associations</Link> · <Link href="/account/security">Account</Link>
      </nav>
      {children}
    </>
  );
}
