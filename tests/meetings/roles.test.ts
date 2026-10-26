// D-42 (owner decision 2026-10-26): the runtime login. A connection that logs in AS quorum_web — its own pg client,
// not SET ROLE from a superuser — cannot read BallotSecret after close, cannot write a ballot except through the
// functions, and cannot get around a trigger: it cannot disable one, cannot switch replication mode, cannot become
// another role, and cannot grant itself the sealed table back. On a template table where it may UPDATE, the
// template's own append-only trigger still refuses it.
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { db } from '@/core/db';
import { closeMeeting } from '@/meetings/close';
import { cloneTables, describeWebRole, ensureWebRole, WEB_ROLE } from '../../scripts/quorum-roles';
import { ensureOrg } from '../../scripts/quorum-load';
import { emptyDatabase, REPLAY_CLOSED_AT, replayFixture } from '../../scripts/tally-eval-db';

const password = randomBytes(18).toString('base64url');
let web: pg.Client;

/** The SQLSTATE a statement fails with as quorum_web, or 'ok'. */
const as = async (sql: string): Promise<string> => {
  try {
    await web.query(sql);
    return 'ok';
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
};

describe('D-42 quorum_web, the runtime login', () => {
  let ballotId = '';
  beforeAll(async () => {
    await emptyDatabase();
    const applied = await ensureWebRole(db, password);
    expect(applied.some((s) => s.includes('PASSWORD') && !s.includes(password))).toBe(true); // the password is never printed
    const orgId = await ensureOrg('roles');
    const replay = await replayFixture(orgId);
    await closeMeeting(replay.meetingRowId, REPLAY_CLOSED_AT);
    ballotId = (await db.ballot.findFirstOrThrow()).id;
    const url = new URL(process.env.DATABASE_URL!);
    url.username = WEB_ROLE;
    url.password = password;
    url.search = '';
    web = new pg.Client({ connectionString: url.toString() });
    await web.connect();
  }, 120_000);
  afterAll(async () => {
    await web?.end();
  });

  it('is a LOGIN role, member of quorum_app only, not a superuser, owns nothing, cannot create roles or bypass RLS', async () => {
    expect(await describeWebRole(db)).toEqual({ super: false, login: true, inherit: true, createrole: false, createdb: false, bypassrls: false, memberOf: ['quorum_app'], ownsRelations: 0 });
    const { rows } = await web.query('SELECT current_user AS u, session_user AS s');
    expect(rows[0]).toEqual({ u: WEB_ROLE, s: WEB_ROLE });
  });

  it('after close, SELECT on BallotSecret is 42501; Ballot and the published facts are readable', async () => {
    expect(await as('SELECT * FROM "BallotSecret"')).toBe('42501');
    expect(await as('SELECT count(*) FROM "BallotSecret"')).toBe('42501');
    expect((await web.query('SELECT count(*)::int AS n FROM "Ballot"')).rows[0].n).toBe(113);
  });

  it('cannot write a ballot, a label or a result except through the functions (42501), nor change one', async () => {
    expect(await as(`UPDATE "Ballot" SET "choicesCanonical" = '{}' WHERE id = '${ballotId}'`)).toBe('42501');
    expect(await as(`DELETE FROM "Ballot" WHERE id = '${ballotId}'`)).toBe('42501');
    expect(await as(`INSERT INTO "BallotStatusEvent" ("ballotId", seq, status, at) VALUES ('${ballotId}', 9, 'COUNTED', '2026-11-14T19:31:00')`)).toBe('42501');
    expect(await as(`UPDATE "Meeting" SET commitment = '${'f'.repeat(64)}'`)).toBe('42501');
  });

  it('cannot get around a trigger: no DISABLE TRIGGER, no replica mode, no SET ROLE to the owner, no re-grant of the sealed table', async () => {
    expect(await as('ALTER TABLE "Ballot" DISABLE TRIGGER "Ballot_append_only"')).toBe('42501');
    expect(await as('ALTER TABLE "Ballot" DISABLE TRIGGER ALL')).toBe('42501');
    expect(await as('SET session_replication_role = replica')).toBe('42501');
    expect(await as('SET ROLE postgres')).toBe('42501');
    expect(await as(`GRANT SELECT ON "BallotSecret" TO ${WEB_ROLE}`)).toBe('42501');
    expect(await as('SELECT * FROM "BallotSecret"')).toBe('42501'); // still sealed after the attempts
  });

  it('on a template table it may UPDATE, the template\'s own append-only trigger still refuses it (P0001)', async () => {
    await db.auditEvent.create({ data: { action: 'roles.test', actorUserId: null } });
    expect(await as(`UPDATE "AuditEvent" SET action = 'x'`)).toBe('P0001');
    expect(await as(`DELETE FROM "AuditEvent"`)).toBe('P0001');
    expect(await as('SELECT count(*) FROM "User"')).toBe('ok'); // the foundation's tables work on this login
  });

  it('holds no privilege of its own on a clone table: everything there comes through quorum_app', async () => {
    const direct = await db.$queryRawUnsafe<{ t: string }[]>(`SELECT DISTINCT table_name AS t FROM information_schema.role_table_grants WHERE grantee = $1`, WEB_ROLE);
    const clone = new Set(cloneTables());
    expect(direct.map((r) => r.t).filter((t) => clone.has(t))).toEqual([]);
  });
});
