// db:roles (D-42, owner decision 2026-10-26): the runtime login role. `quorum_app` (NOLOGIN, created by the first
// Quorum migration) holds the privileges; `quorum_web` is the role the runtime DATABASE_URL logs in as — a LOGIN
// role that inherits from quorum_app and from nothing else, owns nothing, is not a superuser, cannot create roles or
// databases and cannot bypass row security. Because the foundation's own code (sessions, users, orgs, invites,
// outbox, audit) runs on the same connection, quorum_web also gets SELECT/INSERT/UPDATE/DELETE on the TEMPLATE's
// tables — every table in the schema that prisma/schema/quorum.prisma does not declare — and on their sequences.
// On the Quorum tables it has exactly what quorum_app has, nothing more. Triggers still fire for it, and it cannot
// disable one (not an owner, not a superuser).
//
// `scripts/db-setup.ts` is template-owned, so this is a separate clone-owned script. Idempotent: re-run it after any
// migration that adds a template table. Run it as the migration owner (DIRECT_URL / the laptop's postgres).
//   QUORUM_WEB_PASSWORD=… npm run db:roles
// Prints every statement it applied. Neon setup: docs/deploy-roles.md.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { Prisma } from '@/generated/prisma/client';

export const WEB_ROLE = 'quorum_web';
export const APP_ROLE = 'quorum_app';

type Exec = Pick<Prisma.TransactionClient, '$executeRawUnsafe' | '$queryRawUnsafe'>;

/** The clone's tables: every model in prisma/schema/quorum.prisma. Read from the schema, so a new model needs no list edit. */
export function cloneTables(schemaPath = 'prisma/schema/quorum.prisma'): string[] {
  return [...readFileSync(schemaPath, 'utf8').matchAll(/^model (\w+) \{/gm)].map((m) => m[1]!).sort();
}

const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;

/**
 * Create or update quorum_web and apply its grants. Returns the statements executed, in order. `password` is
 * quoted by Postgres itself (quote_literal), never interpolated raw.
 */
export async function ensureWebRole(db: Exec, password: string): Promise<string[]> {
  if (password.length < 16) throw new Error(`${WEB_ROLE} needs a password of at least 16 characters`);
  const done: string[] = [];
  const run = async (sql: string, shown = sql) => {
    await db.$executeRawUnsafe(sql);
    done.push(shown);
  };
  const q = (await db.$queryRawUnsafe<{ q: string }[]>('SELECT quote_literal($1) AS q', password))[0]!.q;
  const exists = (await db.$queryRawUnsafe<{ n: bigint }[]>('SELECT count(*) AS n FROM pg_roles WHERE rolname = $1', WEB_ROLE))[0]!.n > 0n;
  const attrs = 'LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS';
  if (exists) await run(`ALTER ROLE ${WEB_ROLE} ${attrs} PASSWORD ${q}`, `ALTER ROLE ${WEB_ROLE} ${attrs} PASSWORD '…'`);
  else await run(`CREATE ROLE ${WEB_ROLE} ${attrs} PASSWORD ${q}`, `CREATE ROLE ${WEB_ROLE} ${attrs} PASSWORD '…'`);

  // a member of quorum_app and of nothing else
  const others = await db.$queryRawUnsafe<{ r: string }[]>(
    `SELECT g.rolname AS r FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid JOIN pg_roles u ON u.oid = m.member WHERE u.rolname = $1 AND g.rolname <> $2`,
    WEB_ROLE,
    APP_ROLE,
  );
  for (const o of others) await run(`REVOKE ${ident(o.r)} FROM ${WEB_ROLE}`);
  await run(`GRANT ${APP_ROLE} TO ${WEB_ROLE}`);

  const d = (await db.$queryRawUnsafe<{ d: string }[]>('SELECT current_database() AS d'))[0]!.d;
  await run(`GRANT CONNECT ON DATABASE ${ident(d)} TO ${WEB_ROLE}`);
  await run(`GRANT USAGE ON SCHEMA public TO ${WEB_ROLE}`);

  const clone = new Set(cloneTables());
  const tables = (await db.$queryRawUnsafe<{ t: string }[]>(`SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY 1`)).map((r) => r.t);
  const template = tables.filter((t) => !clone.has(t));
  // anything granted directly on a clone table by an earlier run is withdrawn: quorum_app's grants are the only door
  for (const t of tables.filter((t) => clone.has(t))) await run(`REVOKE ALL ON ${ident(t)} FROM ${WEB_ROLE}`);
  if (template.length) await run(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${template.map(ident).join(', ')} TO ${WEB_ROLE}`);
  const seqs = (await db.$queryRawUnsafe<{ s: string; t: string | null }[]>(
    `SELECT s.relname AS s, t.relname AS t FROM pg_class s JOIN pg_namespace n ON n.oid = s.relnamespace
       LEFT JOIN pg_depend dep ON dep.objid = s.oid AND dep.deptype = 'a' LEFT JOIN pg_class t ON t.oid = dep.refobjid
     WHERE s.relkind = 'S' AND n.nspname = 'public' ORDER BY 1`,
  )).filter((r) => r.t === null || !clone.has(r.t));
  if (seqs.length) await run(`GRANT USAGE, SELECT ON SEQUENCE ${seqs.map((r) => ident(r.s)).join(', ')} TO ${WEB_ROLE}`);
  return done;
}

/** The role's facts as the catalog has them — what the test and the CLI print. */
export async function describeWebRole(db: Exec) {
  const [r] = await db.$queryRawUnsafe<{ super: boolean; login: boolean; inherit: boolean; createrole: boolean; createdb: boolean; bypassrls: boolean }[]>(
    'SELECT rolsuper AS super, rolcanlogin AS login, rolinherit AS inherit, rolcreaterole AS createrole, rolcreatedb AS createdb, rolbypassrls AS bypassrls FROM pg_roles WHERE rolname = $1',
    WEB_ROLE,
  );
  const memberOf = (await db.$queryRawUnsafe<{ r: string }[]>(
    'SELECT g.rolname AS r FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid JOIN pg_roles u ON u.oid = m.member WHERE u.rolname = $1 ORDER BY 1',
    WEB_ROLE,
  )).map((x) => x.r);
  const owns = (await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM pg_class c JOIN pg_roles o ON o.oid = c.relowner WHERE o.rolname = $1`, WEB_ROLE))[0]!.n;
  return { ...r, memberOf, ownsRelations: Number(owns) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { db } = await import('@/core/db');
  const password = process.env.QUORUM_WEB_PASSWORD;
  if (!password) {
    console.error('db:roles: set QUORUM_WEB_PASSWORD (the runtime DATABASE_URL will log in as quorum_web with it)');
    process.exit(2);
  }
  const done = await ensureWebRole(db, password);
  for (const s of done) console.log(s);
  console.log(JSON.stringify(await describeWebRole(db)));
  console.log(`db:roles: ${WEB_ROLE} ready; point the runtime DATABASE_URL at it and keep DIRECT_URL on the owner for migrations (D-42).`);
  await db.$disconnect();
}
