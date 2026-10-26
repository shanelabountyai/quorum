// The application role (D-33). Every Quorum read and write runs inside a transaction that first assumes
// `quorum_app`, so a superuser DATABASE_URL (CI, the dev laptop) exercises exactly the privileges the deployed
// application would have: SELECT on the Quorum tables, INSERT on the roster, EXECUTE on the three SECURITY
// DEFINER functions, and nothing on Ballot, BallotSecret, BallotStatusEvent or ContestResult beyond SELECT.
// SET LOCAL ends with the transaction, so the connection goes back to the pool as the login role.
import { db } from '@/core/db';
import type { Prisma } from '@/generated/prisma/client';
import { mapDbError } from './errors';

export type Tx = Prisma.TransactionClient;

export const APP_ROLE = 'quorum_app';

/** Run `fn` as the application role in one transaction; a database refusal comes back as a typed error. */
export async function asApp<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL ROLE ${APP_ROLE}`);
      return fn(tx);
    });
  } catch (e) {
    throw mapDbError(e);
  }
}

/** Run `fn` as the login role (the migration owner on a dev or CI database): the roster loader and the tests' tamper half. */
export async function asOwner<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await db.$transaction(fn);
  } catch (e) {
    throw mapDbError(e);
  }
}
