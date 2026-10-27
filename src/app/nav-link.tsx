'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** A nav link that marks itself `aria-current="page"` on its own route and below it (`end`: on its own route only, for a home link). */
export function NavLink({ href, end, children }: { href: string; end?: boolean; children: React.ReactNode }) {
  const path = usePathname();
  return (
    <Link href={href} aria-current={path === href || (!end && path.startsWith(`${href}/`)) ? 'page' : undefined}>
      {children}
    </Link>
  );
}
