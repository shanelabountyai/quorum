// Tasks 3.5–3.7 from pages: the board posts a month's dues (sums to the budget, ROUNDING shown), reads a unit's
// statement as of a day, opens a violation, schedules the hearing, assesses the fine and finds it on the statement;
// an illegal step cannot be offered; the archive page; axe in light and dark on every page (A-096).
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import { expectAccessible } from './axe';
import { boardFor } from './quorum-helpers';

test.use({ bypassCSP: true });
test.describe.configure({ mode: 'serial', timeout: 240_000 });

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const SLUG = `ledger-e2e-${Date.now()}`;
const board = boardFor(SLUG);
const fx = (name: string) => readFileSync(`fixtures/${name}`, 'utf8');
test.beforeAll(() => board.setup(db));
test.afterAll(() => db.end());

async function importRoster(page: Page) {
  await page.goto(`/o/${SLUG}/roster`);
  for (const [name, file] of [['units', 'units.csv'], ['unit_shares', 'unit_shares.csv'], ['owners', 'owners.csv'], ['ownerships', 'ownerships.csv'], ['assessments', 'assessments.csv']] as const) {
    await page.locator(`textarea[name="${name}"]`).fill(fx(file));
  }
  await page.getByRole('button', { name: 'Import roster' }).click();
  await expect(page.getByRole('status')).toContainText('Imported: Unit 120');
}

test('dues run, statement, violation workflow with the fine on the statement, archive page', async ({ page }) => {
  await board.signIn(db, page);
  await importRoster(page);

  await page.goto(`/o/${SLUG}/ledger?asOf=2026-11-14`);
  await expect(page.getByText('Delinquent as of 2026-11-14: A-110, A-204, A-508, B-108, B-509.')).toBeVisible();
  await page.getByLabel('Month', { exact: true }).fill('2026-12');
  await page.getByLabel('Monthly budget ($)').fill('35,001.00');
  await page.getByRole('button', { name: 'Post dues' }).click();
  await expect(page.getByRole('status')).toContainText('2026-12: 120 charges totalling $35000.24; ROUNDING $0.76; budget $35001.00');
  await page.getByLabel('Month', { exact: true }).fill('2026-12');
  await page.getByLabel('Monthly budget ($)').fill('35000');
  await page.getByRole('button', { name: 'Post dues' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('already posted');
  await page.reload();
  await expectAccessible(page, 'ledger', 'Dues runs');

  await page.goto(`/o/${SLUG}/violations`);
  await expectAccessible(page, 'violations (empty)', 'Open a violation');
  await page.getByLabel('Unit').selectOption({ label: 'B-203' });
  await page.getByLabel('What').fill('Unapproved balcony screen');
  await page.getByLabel('Notice date').fill('2026-12-03');
  await page.getByRole('button', { name: 'Open and queue the notice' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('V-2026-001');
  await expect(page.getByLabel('To').locator('option')).toHaveText(['HEARING_SCHEDULED', 'DISMISSED']); // only the machine's edges are offered
  await page.getByLabel('To').selectOption('HEARING_SCHEDULED');
  await page.getByLabel('Day', { exact: true }).fill('2026-12-04');
  await page.getByLabel('Hearing date (for HEARING_SCHEDULED)').fill('2026-12-10');
  await page.getByRole('button', { name: 'Record step' }).click();
  await expect(page.getByRole('status')).toContainText('Now HEARING_SCHEDULED');
  await page.reload();
  await page.getByLabel('To').selectOption('FINE_ASSESSED');
  await page.getByLabel('Day', { exact: true }).fill('2026-12-10');
  await page.getByLabel('Fine ($, for FINE_ASSESSED)').fill('150.00');
  await page.getByLabel('Reason').fill('screen not removed');
  await page.getByRole('button', { name: 'Record step' }).click();
  await expect(page.getByRole('status')).toContainText("the fine of $150.00 is on the unit's ledger");
  await page.reload();
  await expect(page.getByText('FINE_ASSESSED is final: nothing follows it.')).toBeVisible();
  await expectAccessible(page, 'violation record', 'Trail');

  await page.getByRole('link', { name: 'B-203' }).click();
  await page.getByLabel('As of').fill('2026-12-10');
  await page.getByRole('button', { name: 'Show' }).click();
  await expect(page.getByRole('cell', { name: 'F-V-2026-001' })).toBeVisible();
  const bal = (await page.getByTestId('balance').textContent())!;
  const charge = (await db.query(`SELECT e."amountCents" FROM "LedgerEntry" e JOIN "Unit" u ON u.id = e."unitId" JOIN "Org" o ON o.id = u."orgId" WHERE o.slug = $1 AND u."unitId" = 'B-203' AND e."entryId" = 'D-2026-12'`, [SLUG])).rows[0].amountCents as number;
  expect(bal).toBe(`$${String(Math.trunc((charge + 15000) / 100))}.${String((charge + 15000) % 100).padStart(2, '0')}`);
  await expectAccessible(page, 'unit statement', 'Post a payment');

  const queued = Number((await db.query(`SELECT count(*) AS n FROM "Outbox" x JOIN "Org" o ON o.id = x."orgId" WHERE o.slug = $1 AND x."sentAt" IS NULL`, [SLUG])).rows[0].n);
  expect(queued).toBe(2 * 3); // B-203's two owners: notice, hearing, fine — queued, none sent

  await page.goto(`/o/${SLUG}/settings/archive`);
  await expectAccessible(page, 'archive', 'Archive this association');
  await page.goto(`/o/${SLUG}/settings/danger`);
  await page.getByLabel(/Type .* to confirm/).fill(SLUG);
  await page.getByRole('button', { name: 'Delete org' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('cannot be deleted. Archive it instead.');
});
