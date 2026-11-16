// D-58: quorum's filterListedOrgs hides archived associations from the template's /onboarding (v1.4.0 hook).
import { beforeEach, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import Onboarding from '@/app/onboarding/page';
import { db } from '@/core/db';
import { archiveOrg } from '@/meetings/archive';
import { resetAuthTables, signInAs } from '../helpers/auth';

beforeEach(resetAuthTables);

it('/onboarding lists the live association and not the archived one', async () => {
  const mk = (slug: string) => db.org.create({ data: { slug, name: slug } });
  const live = await mk('larkspur');
  const gone = await mk('old-mill');
  const ada = await db.user.create({ data: { email: 'ada@example.test' } });
  await db.membership.createMany({ data: [live, gone].map((o) => ({ orgId: o.id, userId: ada.id, role: 'owner' as const })) });
  await archiveOrg(gone.id, ada.id, 'merged into Larkspur');
  await signInAs(ada.id, { mfa: true });

  const page = renderToStaticMarkup(await Onboarding());
  expect(page).toContain('href="/o/larkspur"');
  expect(page).not.toContain('old-mill');
});
