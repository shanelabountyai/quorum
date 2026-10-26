# Database roles for a deployment (D-33, D-42) — documented, nothing deployed

Quorum's privilege proof rests on two Postgres roles. Locally and in CI the connection is a superuser that *assumes*
`quorum_app` with `SET LOCAL ROLE`; in a deployment the runtime connection must **log in** as a role that can be
nothing else. This page is how to set that up on Neon (or any Postgres 16/17). Nothing in this repository deploys.

| Role | Kind | Created by | Used by |
|---|---|---|---|
| owner (Neon's `neondb_owner`, the laptop's `postgres`) | owns every table, function and trigger | Neon / the cluster | `DIRECT_URL`: `prisma migrate deploy`, `npm run db:roles`, `npm run quorum:load` |
| `quorum_app` | `NOLOGIN`; holds the Quorum privileges (SELECT on the Quorum tables, INSERT on the roster tables and `OrgArchive`, EXECUTE on `quorum_lock_meeting` / `quorum_cast_ballot` / `quorum_close_meeting`) | the first Quorum migration (idempotent) | assumed by `asApp()` on every Quorum read and write |
| `quorum_web` | `LOGIN INHERIT`, member of `quorum_app` only; not a superuser; no `CREATEROLE`, `CREATEDB`, `REPLICATION`, `BYPASSRLS`; owns nothing; DML on the template's tables | `npm run db:roles` (`scripts/quorum-roles.ts`) | the runtime `DATABASE_URL` (pooled) |

## Steps (Neon)

1. Create the project and database; note the owner's **unpooled** connection string (`DIRECT_URL`) and the pooled host.
2. Apply the migrations as the owner: `DIRECT_URL=<owner, unpooled> npx prisma migrate deploy`.
3. Create the runtime login as the owner: `DATABASE_URL=<owner, unpooled> QUORUM_WEB_PASSWORD=<generated, ≥ 16 chars> npm run db:roles`. It prints every statement (the password as `'…'`) and the role's catalog facts; expect `{"super":false,"login":true,…,"memberOf":["quorum_app"],"ownsRelations":0}`.
4. Set the app's environment: `DATABASE_URL=postgresql://quorum_web:<password>@<pooled host>/<db>?sslmode=require` and `DIRECT_URL=<owner, unpooled>` (migrations only).
5. **Re-run step 3 after every migration that adds a template table** — the script grants DML on every table `prisma/schema/quorum.prisma` does not declare, and revokes anything granted directly on a clone table.

Neon specifics: roles created with SQL work on Neon; `neondb_owner` can create a `LOGIN` role and grant membership. Neon's
pooler (PgBouncer, transaction mode) is compatible with `SET LOCAL ROLE`, which ends with the transaction. Do not
give `quorum_web` the `neon_superuser` membership Neon offers in its console — that role can bypass every grant here.

## What this proves, and does not

`tests/meetings/roles.test.ts` logs in **as `quorum_web`** with its own connection and shows: after a close,
`SELECT` on `BallotSecret` is `42501`; no `UPDATE`/`DELETE`/`INSERT` on `Ballot`, `BallotStatusEvent` or `Meeting`;
`ALTER TABLE … DISABLE TRIGGER`, `SET session_replication_role = replica`, `SET ROLE postgres` and a self-`GRANT` on
`BallotSecret` are all `42501`; and on a template table it may update (`AuditEvent`), the template's append-only
trigger still refuses it. It does **not** protect against the owner role: whoever holds `DIRECT_URL` can read the
sealed link, disable a trigger and rewrite a row — the tamper test in `tests/meetings/close.test.ts` shows the
recount catching exactly that, which is the point of publishing the commitment.
