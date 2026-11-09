import Link from 'next/link';
import { can } from '@/core/authz/permissions';
import { requireOrg } from '@/core/authz/guards';
import { db } from '@/core/db';
import { NavLink } from '@/app/nav-link';

// Navigation only. Layouts do not re-run on every navigation, so each page calls requireOrg itself.
export default async function OrgLayout({ children, params }: { children: React.ReactNode; params: Promise<{ org: string }> }) {
  const ctx = await requireOrg((await params).org);
  const org = await db.org.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { name: true } });
  const base = `/o/${ctx.slug}`;
  return (
    <>
      <nav className="org-nav" aria-label="Association">
        <Link className="wordmark" href="/associations">Quorum</Link>
        <strong className="assoc">{org.name}</strong>
        <NavLink href={base} end>Home</NavLink>
        <NavLink href={`${base}/meetings`}>Meetings</NavLink>
        <NavLink href={`${base}/roster`}>Roster</NavLink>
        <NavLink href={`${base}/ledger`}>Ledger</NavLink>
        <NavLink href={`${base}/violations`}>Violations</NavLink>
        <NavLink href={`${base}/settings/members`}>Members</NavLink>
        {can(ctx.role, 'org.delete') && <><NavLink href={`${base}/settings/archive`}>Archive</NavLink><NavLink href={`${base}/settings/danger`}>Export or delete</NavLink></>}
        {can(ctx.role, 'audit.read') && <><NavLink href={`${base}/settings/audit`}>Audit log</NavLink><NavLink href={`${base}/settings/security`}>Security</NavLink></>}
        {ctx.role === 'owner' && <NavLink href={`${base}/settings/sso`}>SSO</NavLink>} {/* sso */}
        {can(ctx.role, 'apikeys.manage') && <NavLink href={`${base}/settings/apikeys`}>API keys</NavLink>} {/* apikeys */}
        <span className="end"><NavLink href={`${base}/design`}>Design</NavLink><Link href="/associations">Your associations</Link><Link href="/account/security">Account</Link></span>
      </nav>
      {children}
    </>
  );
}
