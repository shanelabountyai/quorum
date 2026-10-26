// tally:eval:db (task 2.9; D-23 over the tables). The same 113 fixture ballots through the cast path in file
// order, then closeMeeting, then the recount from Ballot rows alone, printed as the §11 table and diffed against
// the same four expected files as tally:eval — plus the published export against published_ballots.csv byte for
// byte. Runs on the TEST database and empties it first (dotenv -e .env.test); CI runs it after `migrate deploy`.
//   --fixtures DIR   another fixture directory (default fixtures/)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { db } from '@/core/db';
import { castBallotWithNonce, type CastResult } from '@/meetings/cast';
import { castOrder } from '@/tally/ballots';
import { closeMeeting, recountMeeting, type RecountVerdict } from '@/meetings/close';
import { publishedList } from '@/meetings/published';
import type { Timestamp } from '@/tally/time';
import { firstDiff, report } from './tally-eval';
import { ensureOrg, loadAll } from './quorum-load';
import { FIXTURES_DIR, loadFixtures } from './tally-fixtures';

/** A fixed salt so the unit hashes of a replay are reproducible run to run; the product mints a random one. */
export const REPLAY_SALT = '5ea1ed11ab1e5a1700000000a703d58b';
/** The operator closes after the window; any instant on the meeting axis after close_at is honest here. */
export const REPLAY_CLOSED_AT = '2026-11-14T19:30:00' as Timestamp;

/**
 * Test-database reset: every table emptied, and the seal lifted — D-33's REVOKE is table-wide and outlives a
 * TRUNCATE, so a database in which any meeting ever closed is one where the app role cannot read BallotSecret.
 * Re-granting is the migration owner's act on a disposable database; the product never does it (O-11).
 */
export async function emptyDatabase() {
  const tables = (await db.$queryRaw<{ t: string }[]>`SELECT tablename AS t FROM pg_tables WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'`).map((r) => r.t);
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t}"`).join(', ')} CASCADE`);
  await db.$executeRawUnsafe('GRANT SELECT ON "BallotSecret" TO quorum_app');
}

export type Replay = { meetingRowId: string; casts: CastResult[] };

/**
 * Load the roster and meeting into `orgId` and cast every fixture ballot with its fixture nonce, in (cast_at,
 * ballot_id) order — the order a live meeting produces, since castAt is the instant of the cast (D-36). The
 * fixture file is in id order, which is not an arrival order. `beforeCasts` runs between the load and the first cast.
 */
export async function replayFixture(orgId: string, dir = FIXTURES_DIR, beforeCasts?: (meetingRowId: string) => Promise<void>): Promise<Replay> {
  const { meetingRowId } = await loadAll(orgId, dir, REPLAY_SALT);
  if (beforeCasts) await beforeCasts(meetingRowId); // e.g. a test declaring a special assessment before voting starts (D-58)
  const f = loadFixtures(dir);
  const casts: CastResult[] = [];
  for (const b of [...f.ballots].sort(castOrder)) {
    casts.push(await castBallotWithNonce({ meetingRowId, ballotId: b.ballot_id, unitId: b.unit_id, castBy: b.cast_by, viaProxyId: b.via_proxy_id, castAt: b.cast_at, choices: b.choices }, b.nonce));
  }
  return { meetingRowId, casts };
}

export type DbEval = { replay: Replay; closed: boolean; recount: RecountVerdict; publishedCsv: string; diff: string | null; publishedDiff: string | null };

export async function evalDatabase(dir = FIXTURES_DIR): Promise<DbEval> {
  await emptyDatabase();
  const orgId = await ensureOrg('larkspur-eval');
  const replay = await replayFixture(orgId, dir);
  const close = await closeMeeting(replay.meetingRowId, REPLAY_CLOSED_AT);
  const recount = await recountMeeting(replay.meetingRowId);
  const { csv } = await publishedList(replay.meetingRowId);
  const want = readFileSync(join(dir, 'published_ballots.csv'), 'utf8');
  let publishedDiff: string | null = null;
  if (csv !== want) {
    const a = csv.split('\n');
    const b = want.split('\n');
    const i = a.findIndex((line, k) => line !== b[k]);
    publishedDiff = `published_ballots.csv: line ${i + 1}: got ${JSON.stringify(a[i] ?? '')}, expected ${JSON.stringify(b[i] ?? '')}`;
  }
  return { replay, closed: close.closed, recount, publishedCsv: csv, diff: firstDiff(recount.tally, dir, { stored: true }), publishedDiff };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = arg('--fixtures') ?? FIXTURES_DIR;
  const r = await evalDatabase(dir);
  console.log(report(r.recount.tally));
  console.log('');
  console.log(`stored result: merkle_root ${r.recount.stored.merkleRoot}; meeting commitment ${r.recount.stored.commitment}; recount ${r.recount.matches ? 'EQUALS the stored result' : 'DIFFERS: ' + r.recount.differences.join('; ')}`);
  const problems = [r.diff, r.publishedDiff, r.recount.matches ? null : 'recount differs from the stored result'].filter((x): x is string => x !== null);
  if (problems.length) {
    console.error(`\ntally:eval:db: DIFFERS from the oracle — ${problems[0]}`);
    await db.$disconnect();
    process.exit(1);
  }
  const t = r.recount.tally;
  console.log(`\ntally:eval:db: ${r.replay.casts.length} ballots cast through quorum_cast_ballot, ${t.ballots_counted} counted, ${t.ballots_rejected} rejected; closed and sealed; the recount from Ballot rows equals the stored commitments and every row of expected_ballots.csv (unit id excepted: not stored, D-20), expected_totals.csv, expected_results.csv and expected_quorum.csv; the published export equals published_ballots.csv byte for byte (D-24 applies)`);
  await db.$disconnect();
}
