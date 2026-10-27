// Sign-in helpers shared by the Quorum specs. A real (non-demo) TOTP-enrolled board member, because closing a
// meeting asks for a fresh sign-in, which a shared demo account may not give (INV-26, INV-27). Two test-only
// adjustments, both to the test's own rows: the 60 s resend cooldown and the TOTP replay step are moved aside so one
// spec can sign in several times in a minute.
import { expect, type Page } from '@playwright/test';
import type pg from 'pg';
import { Secret, TOTP } from 'otpauth';
import { sealSecret } from '../src/core/auth/secret-box';

const TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'; // test-only secret for a test-only user

export async function signInByLink(db: pg.Pool, page: Page, email: string) {
  await db.query('DELETE FROM "RateLimit"'); // the server sees every sign-in in a spec as one IP
  await db.query(`UPDATE "LoginToken" SET "createdAt" = "createdAt" - interval '2 minutes' WHERE email = $1`, [email]); // past the 60 s resend cooldown
  const before = Number((await db.query('SELECT count(*) AS n FROM "CapturedMessage" WHERE "to" = $1', [email])).rows[0].n);
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Email me a link' }).click();
  await expect(page.getByRole('status')).toContainText('Check your email');
  await expect.poll(async () => Number((await db.query('SELECT count(*) AS n FROM "CapturedMessage" WHERE "to" = $1', [email])).rows[0].n), { message: `a new link for ${email}` }).toBeGreaterThan(before);
  const { rows } = await db.query('SELECT body FROM "CapturedMessage" WHERE "to" = $1 ORDER BY "createdAt" DESC LIMIT 1', [email]);
  await page.goto(rows[0].body.match(/https?:\/\/\S+\/login\/[\w-]+/)[0]);
  await page.getByRole('button', { name: 'Continue' }).click();
}

/** An org `slug` and its owner-role board member, created by `setup`. */
export function boardFor(slug: string) {
  const email = `board-${slug}@example.test`;
  return {
    email,
    async setup(db: pg.Pool) {
      await db.query('DELETE FROM "RateLimit"');
      const { rows: [org] } = await db.query(`INSERT INTO "Org" (id, slug, name, "updatedAt") VALUES (gen_random_uuid(), $1, 'Larkspur Commons (e2e)', now()) RETURNING id`, [slug]);
      const { rows: [u] } = await db.query(`INSERT INTO "User" (id, email, "totpSecretSealed", "totpEnrolledAt", "updatedAt") VALUES (gen_random_uuid(), $1, $2, now(), now()) RETURNING id`, [email, sealSecret(TOTP_SECRET, 'totp')]);
      await db.query(`INSERT INTO "Membership" ("orgId", "userId", role, "updatedAt") VALUES ($1, $2, 'owner', now())`, [org.id, u.id]);
      return org.id as string;
    },
    async signIn(db: pg.Pool, page: Page) {
      await db.query('UPDATE "User" SET "totpLastStep" = NULL WHERE email = $1', [email]); // two sign-ins may fall in one 30 s step (INV-24)
      await signInByLink(db, page, email);
      await expect(page).toHaveURL(/\/login\/mfa/);
      await page.getByLabel('Code from your authenticator app').fill(new TOTP({ algorithm: 'SHA1', digits: 6, period: 30, secret: Secret.fromBase32(TOTP_SECRET) }).generate());
      await page.getByRole('button', { name: 'Verify' }).click();
      await expect(page).toHaveURL(/\/onboarding$/);
    },
  };
}
