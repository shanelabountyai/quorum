// Phase 3 exit criteria, from pages (task 3.8): a board member imports the roster, creates the meeting and loads
// its proxies; a homeowner whose invite matched the roster's email is linked (D-39), casts and keeps the receipt;
// the desk casts for another owner; the board closes; results and the published list; the homeowner checks the
// receipt; the homeowner cannot open the desk or another unit's dues. axe in light and dark on every page (A-096).
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import { expectAccessible } from './axe';
import { boardFor, signInByLink } from './quorum-helpers';

test.use({ bypassCSP: true }); // axe is injected; the app's CSP (INV-15) rightly refuses that
test.describe.configure({ mode: 'serial', timeout: 240_000 }); // axe over a 120-unit roster takes a while

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const fx = (name: string) => readFileSync(`fixtures/${name}`, 'utf8');
const SLUG = `larkspur-e2e-${Date.now()}`;
const meetingJson = (() => {
  const m = JSON.parse(fx('meeting.json'));
  // the fixture's rules with a window that holds "now", so pages cast inside it; the record date is unchanged
  return JSON.stringify({ ...m, meeting_id: 'AM-E2E', rules: { ...m.rules, open_at: '2026-01-01T00:00:00', close_at: '2099-12-31T23:59:59' } }, null, 2);
})();
const ownerEmail = fx('owners.csv').split('\n')[1]!.split(',')[2]!; // O-001's synthetic example.com address
let meetingUrl = '';
let receipt = '';
let nonce = '';

const board = boardFor(SLUG);
test.beforeAll(() => board.setup(db));
test.afterAll(() => db.end());
const asBoard = (page: Page) => board.signIn(db, page);
const magicLink = (page: Page, email: string) => signInByLink(db, page, email);

test('the board imports the roster from the page, write-once', async ({ page }) => {
  await asBoard(page);
  await page.goto(`/o/${SLUG}/roster`);
  await expectAccessible(page, 'roster (empty)', 'Import the roster');
  const fill = async () => {
    for (const [name, file] of [['units', 'units.csv'], ['unit_shares', 'unit_shares.csv'], ['owners', 'owners.csv'], ['ownerships', 'ownerships.csv'], ['assessments', 'assessments.csv']] as const) {
      await page.locator(`textarea[name="${name}"]`).fill(fx(file));
    }
  };
  await fill();
  await page.getByRole('button', { name: 'Import roster' }).click();
  await expect(page.getByRole('status')).toContainText('Imported: Unit 120, UnitShare 124, Owner 138, Ownership 141, LedgerEntry 2627');
  await fill(); // React resets a form after its action runs
  await page.getByRole('button', { name: 'Import roster' }).click();
  await expect(page.getByRole('status')).toContainText('0 inserted, every column matches', { timeout: 30_000 });
  await page.goto(`/o/${SLUG}/roster?asOf=2026-11-14`);
  await expect(page.getByText('shares as of 2026-11-14 sum to')).toContainText('10000');
  await expectAccessible(page, 'roster (loaded)', 'Owners (138)');
});

test('the board creates the meeting and records its proxies', async ({ page }) => {
  await asBoard(page);
  await page.goto(`/o/${SLUG}/meetings`);
  await expectAccessible(page, 'meetings (empty)', 'Create a meeting');
  await page.getByLabel('meeting.json').fill(meetingJson);
  await page.getByRole('button', { name: 'Create meeting' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('AM-E2E');
  meetingUrl = new URL(page.url()).pathname;
  await page.locator('textarea[name="proxies"]').fill(fx('proxies.csv'));
  await page.getByRole('button', { name: 'Import proxies' }).click();
  await expect(page.getByRole('status')).toContainText('49 proxies recorded');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Proxies (49)' })).toBeVisible();
  await expect(page.getByText('Delinquent (balance above zero, E-4/E-5): A-110, A-204, A-508, B-108, B-509')).toBeVisible();
  await expectAccessible(page, 'meeting (open)', 'Quorum now');
});

test('the desk casts for an owner; the receipt is shown once with its limit', async ({ page }) => {
  await asBoard(page);
  await page.goto(`${meetingUrl}/desk`);
  await expectAccessible(page, 'desk', 'Direct ballot');
  const direct = page.getByRole('region', { name: 'Direct ballot' });
  await direct.getByLabel('Owner').selectOption({ label: (await direct.getByLabel('Owner').locator('option', { hasText: 'O-002 ' }).textContent())! });
  await direct.getByLabel('Unit').selectOption({ label: 'A-102' });
  await direct.getByRole('radio', { name: 'NO' }).first().check();
  await direct.getByRole('button', { name: 'Cast ballot' }).click();
  await expect(direct.getByRole('heading', { name: 'Ballot counted' })).toBeVisible();
  await expect(direct.getByTestId('receipt')).toHaveText(/^[0-9a-f]{64}$/);
  await expect(direct.getByText('does not hide how you voted')).toBeVisible();
  await expectAccessible(page, 'desk (receipt shown)', 'Ballot counted');

  // D-55: one paper proxy from O-001 (the homeowner below revokes it from their own page) and a desk revocation
  await page.goto(meetingUrl);
  const pick = async (label: string, text: string) => page.getByLabel(label, { exact: true }).selectOption({ label: (await page.getByLabel(label, { exact: true }).locator('option', { hasText: text }).first().textContent())! });
  await pick('Unit', 'A-101');
  await pick('Grantor', 'O-001 ');
  await pick('Holder', 'O-002 ');
  await page.getByRole('button', { name: 'Record proxy' }).click();
  await expect(page.getByRole('status')).toContainText('Proxy P-050 recorded at');
  await page.goto(`${meetingUrl}/desk`);
  const revoke = page.getByRole('region', { name: 'Revoke a proxy for its grantor' });
  await revoke.getByLabel('Proxy to revoke').selectOption({ label: (await revoke.getByLabel('Proxy to revoke').locator('option', { hasText: 'P-001:' }).textContent())! });
  await revoke.getByLabel('Reason').fill('O-024 presented a signed revocation at the desk');
  await revoke.getByRole('button', { name: 'Revoke proxy' }).click();
  await expect(revoke.getByRole('status')).toContainText('Proxy P-001 revoked at');
  const row = (await db.query(`SELECT r.channel, r.reason FROM "ProxyRevocation" r JOIN "Proxy" p ON p.id = r."proxyId" JOIN "Meeting" m ON m.id = p."meetingId" JOIN "Org" o ON o.id = m."orgId" WHERE o.slug = $1 AND p."proxyId" = 'P-001'`, [SLUG])).rows;
  expect(row).toEqual([{ channel: 'DESK', reason: 'O-024 presented a signed revocation at the desk' }]);
  await expectAccessible(page, 'desk (proxy revoked)', 'Proxy P-001 revoked at');
});

test('a homeowner whose invite matched the roster is linked, casts, and a second ballot for the unit is DUPLICATE_UNIT', async ({ page }) => {
  // the board's invite to O-001's address on file (written as a row: the capture transport is the only mailbox here)
  const token = randomBytes(32).toString('base64url');
  await db.query(
    `INSERT INTO "Invite" (id, "orgId", email, role, "tokenHash", "invitedById", "expiresAt") SELECT gen_random_uuid(), o.id, $2, 'member', $3, u.id, now() + interval '1 day' FROM "Org" o, "User" u WHERE o.slug = $1 AND u.email = $4`,
    [SLUG, ownerEmail, createHash('sha256').update(token).digest('hex'), board.email],
  );
  await magicLink(page, ownerEmail);
  await page.goto(`/onboarding/invite/${token}`);
  await page.getByRole('button', { name: 'Accept invite' }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${SLUG}$`));
  await expect(page.getByText('linked to roster owner')).toContainText('O-001');
  await expectAccessible(page, 'home (linked member)', 'Association home');

  await page.goto(`${meetingUrl}/vote`);
  await expectAccessible(page, 'vote', 'You are voting as roster owner');
  // D-55: the grantor revokes the proxy they granted, from their own page
  const granted = page.getByRole('region', { name: 'Proxies you granted' });
  await granted.getByRole('button', { name: 'Revoke proxy P-050' }).click();
  await expect(granted.getByRole('status')).toContainText('Proxy P-050 revoked at');
  await expectAccessible(page, 'vote (proxy revoked)', 'Proxy P-050 revoked at');
  await page.reload();
  await expect(page.getByRole('region', { name: 'Proxies you granted' })).toContainText(/P-050: unit A-101, held by O-002 .*Revoked at \d{4}-/);
  const ballot = page.getByRole('region').filter({ has: page.getByRole('heading', { name: /^Unit / }) }).first();
  await ballot.getByRole('checkbox', { name: /C-01/ }).check();
  await ballot.getByRole('checkbox', { name: /C-05/ }).check();
  await ballot.getByRole('radio', { name: 'YES' }).first().check();
  await ballot.getByRole('button', { name: 'Cast ballot' }).click();
  await expect(ballot.getByRole('heading', { name: 'Ballot counted' })).toBeVisible();
  receipt = (await ballot.getByTestId('receipt').textContent())!;
  nonce = (await ballot.getByTestId('nonce').textContent())!;
  expect(receipt).toMatch(/^[0-9a-f]{64}$/);
  expect(nonce).toMatch(/^[0-9a-f]{32}$/);
  await expectAccessible(page, 'vote (receipt shown)', 'Ballot counted');

  await page.reload();
  const again = page.getByRole('region').filter({ has: page.getByRole('heading', { name: /^Unit / }) }).first();
  await again.getByRole('button', { name: 'Cast ballot' }).click();
  await expect(again.getByRole('heading', { name: 'Ballot received and rejected: DUPLICATE_UNIT' })).toBeVisible();

  // a homeowner cannot open the desk (404, D-54 — not the 500 D-45 stated), another unit's statement, or the delinquent list
  expect((await page.goto(`${meetingUrl}/desk`))!.status()).toBe(404);
  const other = (await db.query(`SELECT u.id FROM "Unit" u JOIN "Org" o ON o.id = u."orgId" WHERE o.slug = $1 AND u."unitId" = 'B-610'`, [SLUG])).rows[0].id;
  expect((await page.goto(`/o/${SLUG}/ledger/${other}`))!.status()).toBe(404);
  await page.goto(meetingUrl);
  await expect(page.getByText('Only the board and the manager see the delinquent list')).toHaveCount(0); // linked: their own units instead
  await expect(page.getByText(/^A-1\d\d: balance/).first()).toBeVisible();
  await expect(page.getByText('A-110, A-204, A-508, B-108, B-509')).toHaveCount(0);
});

test('the board closes; results, commitments and the published list; the homeowner checks the receipt with the nonce', async ({ page, browser }) => {
  await asBoard(page); // a fresh sign-in: closing asks for one (INV-26)
  await page.goto(meetingUrl);
  await page.getByRole('button', { name: 'Close and seal the meeting' }).click();
  await expect(page.getByRole('status')).toContainText('Closed at');
  await page.goto(`${meetingUrl}/results`);
  await expect(page.getByText('Recount from the stored ballots')).toContainText('equals the stored result');
  await expect(page.getByText(/^Received 3, counted 2, rejected 1/)).toBeVisible();
  await expectAccessible(page, 'results', 'Published list');
  const csv = await (await page.request.get(`${meetingUrl}/published.csv`)).text();
  expect(csv.split('\n')[0]).toBe('receipt,ballot_id,status,code,bps_as_of,choices_canonical');
  expect(csv).toContain(receipt);

  const member = await browser.newContext({ bypassCSP: true });
  const p2 = await member.newPage();
  await magicLink(p2, ownerEmail);
  await p2.goto(`${meetingUrl}/results`);
  await p2.getByLabel('Receipt').fill(receipt);
  await p2.getByLabel('Nonce (optional)').fill(nonce);
  await p2.getByRole('button', { name: 'Check' }).click();
  await expect(p2.getByRole('status')).toContainText('IN THE ROOT');
  await expect(p2.getByRole('status')).toContainText('recomputes from the published ballot id and choices');
  await expectAccessible(p2, 'results (receipt checked)', 'IN THE ROOT');
  await member.close();
});
