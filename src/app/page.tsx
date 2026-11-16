// public: the landing page
import { PageHeader, LinkButton } from '@/components/ui';
import { ScopeNote } from '@/components/honesty';
import Link from 'next/link';
import { demoEnabled } from '@/core/auth/demo';

export const dynamic = 'force-dynamic'; // reads DEMO_MODE per request, never baked in at build

export default function Home() {
  return (
    <main>
      <PageHeader
        eyebrow="HOA governance"
        title="Quorum"
        lead="Elections, proxies, dues and violations for a condominium association, with a tally anyone can recount."
        actions={<><LinkButton href="/login">Sign in</LinkButton>{demoEnabled() && <LinkButton href="/demo" variant="secondary">Demo accounts</LinkButton>}</>}
      />
      <ScopeNote />
      <footer>
        <Link href="/legal/privacy">Privacy</Link> · <Link href="/legal/terms">Terms</Link>
      </footer>
    </main>
  );
}
