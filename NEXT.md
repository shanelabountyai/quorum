# NEXT

## ▶ Quorum is closed (2026-10-27). Nothing outstanding for the agent.

All four closure items exist: `docs/DEMO.md`, brief https://claude.ai/artifact/WeXdqKB6ix8t1e4jhoo7bF (public, links labintelligence.co), LinkedIn #129 and #130 in the Ledger https://claude.ai/artifact/Ai5xKScgT2sWtqXRQ1ZA8i (Quorum filter chip added), cost review ($0 by absence). Spare angles if more posts are wanted: D-47 (76 cents, overlaps #108), D-40 (ID space exhausted in its own test).

Brief now carries two results screenshots (2026-10-27, from the 113-ballot meeting via `dev:test`; capture script was throwaway). PR #1 merged 2026-10-27 on Shane's say-so. Still open for Shane: `docs/CLOSEOUT.md` § By hand.

**2026-10-26 (fourth session, on the Mac, Shane present) — closeout part 1.**
- Port **6200**, not 7200 (D-54): `package.json`, `playwright.config.ts`, `ci.yml`, README, CLAUDE.md; row added to the port table in `~/.claude/CLAUDE.md` (next free now 6300).
- Reuse scan re-run (D-55): no other project has ballots/Merkle/quorum; Adjuster's canonical JSON would have broken the oracle on non-ASCII (`JSON.stringify` vs `ensure_ascii`), so writing it fresh was right.
- Stale pre-D-26 counts fixed (PRD "fifteen", overlap 26/15 and 87/120, 51/120, D-15).
- `docs/DEMO.md`: three acts. Every command was run once on a fresh `quorum` database. The browser acts were driven headless against :6200 with a throwaway Playwright walk, since deleted: roster 120/124/138/141/2627, 49 proxies, desk + homeowner receipts, DUPLICATE_UNIT, close → recount equals, receipt IN THE ROOT, dues ROUNDING $0.76, V-2026-001 fine on B-203 ($468.50), 6 notices queued / 0 sent, delete refused. Act 1: `tally:eval` 0 diffs, `fixtures:check` OK, `tally:lint` OK, `tally:verify` in/not-in, `tally:recount` 45/0/1 and the tampered file exits 1 naming R1, `tally:eval:db` equals, `BallotSecret` permission denied, `Ballot` DELETE refused (D-19).
- Found: a member opening an owner-only page gets HTTP 500 (template `requireOrg` throws; upstream). The violation form needs a reload between steps. npm 11 skips `postinstall` (`npx prisma generate` by hand). All three are in DEMO.md.
- Not run this session: `npm test`, e2e, CI (code changes were the port only; CI runs on push).
- Left uncommitted on purpose: `next dev` appended a "nextjs-agent-rules" block to CLAUDE.md. Commit or discard it as you prefer.

---

**2026-10-26 (third build session, unattended, cloud) — owner decisions applied, then Phase 3 tasks 3.1–3.9.**
- Decisions recorded as owner decisions **D-37..D-43** (O-10, O-11 closed): D-37 `bps_as_of` on the published list; D-38 keep the table-wide REVOKE; D-39 `OwnerLink` written by a trigger on `Invite` acceptance (email match) + the desk path with the operator in `BallotSecret.enteredById`; D-40 random public ballot ids `B-<12 hex>` (fixtures mint from the seed, the write layer from `crypto`; the same-instant id guard is per unit); D-41 `CREDIT` in E-4 + GQ-12; D-42 `quorum_web` LOGIN role (`npm run db:roles`, `docs/deploy-roles.md`); D-43 archive, never delete (`OrgArchive`, `beforeOrgDelete` refuses, trigger second door).
- **Fixtures regenerated** (D-37 + D-40, one regeneration, seed 20261025, twice → identical): totals/quorum/results unchanged; new hashes in brief §12 (ballots `f0a121ac…`, published `8439d208…`, MANIFEST `59e5d43d…`); root `5214cb0f…35f5d`, meeting commitment `3e6f583c…37e9`. Re-proved before Phase 3: `tally:eval` 0 diffs, `tally:eval:db` 0 diffs (export byte-equal), `tally:recount` 45 match / 0 differ / 1 n/a, GQ-12 green in both languages.
- Phase 3 built: meetings/vote/desk/results/published.csv, roster, ledger (dues run with ROUNDING, statements, payments, credits, reversals), violations (machine as data), archive, `/associations`, notices queued never sent (cron no longer drains, D-44). Session defaults **D-44..D-53**.
- **Contradiction found:** the Phase 3 draft's "$35,001 posts a 1-cent ROUNDING line" is 76 cents by hand; 1 cent is $35,000.01 (D-47). A first D-40 guard (meeting-wide re-draw) exhausted its id space in its own test and was replaced one commit later (per-unit guard, interval draw).

**Gate output (local, 2026-10-26):** `npm test` 458 passed (52 files); `npm run test:e2e` 15 passed of 15 listed, axe 0 violations on 17 page states × light/dark; `lint` 0 problems; `typecheck` clean; `foundation:drift` clean (modules removed: billing); `tally:eval`, `tally:eval:db`, `fixtures:check`, `tally:lint` OK. CI green on the Phase 3 code head 35d3ab9 (run 40355829930); table below.

**Sandbox this session:** everything ran locally — `PRISMA_SCHEMA_ENGINE_BINARY=/bin/true npx prisma generate`, migrations applied with `psql -f`, and **Playwright with the preinstalled Chromium at `/opt/pw-browsers`** (so e2e and axe ran before every push). Still CI-only: `prisma migrate deploy` / `migrate diff`. axe-core is used from the lockfile (transitive), no dependency added.

**By hand (Shane):** see `docs/CLOSEOUT.md` §By hand.

---

**2026-10-26 (second build session, unattended, cloud) — Phase 2 done, tasks 2.0–2.11.** Built: `prisma/schema/quorum.prisma` (11 models) + `prisma/migrations/20261026000000_quorum_init/migration.sql` (hand-written: D-8 CHECKs, 6 append-only triggers, the `Meeting` guard, the seal trigger that `REVOKE`s `SELECT` on `BallotSecret` and stamps `sealedAt`, the `quorum_app` role and grants, `quorum_lock_meeting` / `quorum_cast_ballot` / `quorum_close_meeting` as `SECURITY DEFINER`, the billing tables dropped); `src/meetings/` (9 files: `db` — `asApp()` with `SET LOCAL ROLE quorum_app`; `errors` — typed refusals mapped from `meta.driverAdapterError.cause`; `load`, `roster`, `labels`, `cast`, `close` (close + recount), `published`, `eligibility`); `src/tally/tally.ts` gained `resultsFromStored` + `tallyFromResults` (pure; `tally()` now ends in it); `scripts/quorum-load.ts`, `scripts/tally-eval-db.ts`; `tests/meetings/` (6 files, 40 tests) + `tests/tally/stored.test.ts` (5); CI: `prisma migrate diff --from-migrations --to-schema --exit-code` (posts a non-empty diff on the PR), `tally:eval:db`. Decided: D-31..D-36, O-11 (`docs/decisions.md`). Departures from the draft are written into `docs/phase-2-tasks.md` beside the item.

**Gate output (local, Postgres 16, 2026-10-26; CI, Postgres 17, links below):**
- `npm run tally:eval:db` → 113 ballots through `quorum_cast_ballot`, 87 counted, 26 rejected; closed and sealed; recount from `Ballot` rows equals the stored commitments; 0 differences against `expected_ballots.csv` (unit id excepted — not stored, D-20), `expected_totals.csv`, `expected_results.csv`, `expected_quorum.csv`; published export equals `published_ballots.csv` byte for byte. Root `cbf6767e…65d49`, meeting commitment `a703d58b…037a` — the Phase 1 values.
- `npm test` → **380 passed, 44 files** (186 engine, 40 meetings, 154 template). `npm run test:engine` → 186. `npm run tally:eval` → 113/87/26, 0 differences. `tally:lint` OK (17 files). `fixtures:check` OK. `foundation:drift` clean (modules removed: billing). `lint` 0 errors (the template's 1 warning). `typecheck` clean — **fully, this time** (see "what the sandbox could run").
- Tamper proofs: `42501` on `BallotSecret` after close as `quorum_app`; `P0001 "<table> is append-only (D-19)"` on six tables from the client and raw SQL; a flipped `choicesCanonical` with the trigger disabled moves exactly the R1 and meeting commitments and the recount names both.

**What the sandbox COULD run this time (changes the Phase 1 record):** `PRISMA_SCHEMA_ENGINE_BINARY=/bin/true npx prisma generate` generates the client without the blocked engine download, so `npm run typecheck` and the whole DB-backed `npm test` ran locally against the sandbox's Postgres 16 (`/usr/lib/postgresql/16`, database `quorum_test`, migrations applied with `psql -v ON_ERROR_STOP=1 -f` in order — the stand-in for `prisma migrate deploy`). `prisma validate` and `prisma format` work the same way. **Still cannot run locally:** `prisma migrate deploy`, `migrate dev --create-only` and `migrate diff` (they need the native schema engine; `binaries.prisma.sh` is 403), so the migration SQL is hand-written and CI's `migrate diff` step is the proof it matches the schema (green on 2b06d27). `test:e2e` not run locally (Playwright browsers not downloaded); CI runs it. CI job logs are on a blob host the proxy refuses, so the `migrate diff` step posts its output as a PR comment on failure (one such comment on PR #1, from the `--shadow-database-url` mistake); check-run annotations are readable via the API.

**Red runs this session and what fixed them:** 40320715574 (7db5ebb) — `migrate diff` step: `--shadow-database-url` is not a Prisma 7 flag → `SHADOW_DATABASE_URL` env read by `prisma.config.ts` (2b06d27). 40321120165 (eef403d) — same, that push only added the PR-comment channel. Found locally before any push: a file-order replay labelled B-020 wrong → D-36; `sealedAt` could be re-stamped after sealing → the guard requires `OLD.sealedAt IS NULL`; a malformed `castAt` hit the order check before validation → validated first; the `quorum_app` column-level `UPDATE (title)` grant lives in `role_column_grants`, not `role_table_grants`; the seal outlives `TRUNCATE`, so the test reset re-grants (D-33's stated limit, O-11).

**By hand (Shane):** review PR #1; decide O-11 and item 3.0 of `docs/phase-3-tasks.md`; delete the throwaway branch `ci-proof-1-14` on origin; `git push origin v1.3.0` from the Mac so the tag shim in `ci.yml` can go; the port-table row (quorum → 7200) in `~/.claude/CLAUDE.md`; re-run `reuse-scan.py`; fix the stale pre-D-26 numbers (PRD, `docs/portfolio-overlap.md`, D-15); the deployment role for `quorum_app` (D-33) when a database beyond the laptop exists; build-log card #21. Optional: delete the one `migrate diff` PR comment.

---

**2026-10-26 (first build session, unattended, cloud):** Phase 1 tasks 1.1–1.14 done. Built: `src/tally/` (17 files), `scripts/tally-{lint,eval,verify,recount,fixtures}.ts`, `tests/tally/` (7 files, 181 tests), `docs/EVAL.md`, `docs/phase-1-plan.md`, decisions D-27..D-30 and O-10, CI gate, billing removed by manifest (D-27 c). Gate then: `tally:eval` 113/87/26, 0 differences; `test:engine` 181; `tally:lint` OK; `fixtures:check` OK; `tally:recount` 29 match / 0 differ / 6 not recomputable (D-28); `foundation:drift` clean. Could not run then (now partly can, see above): `npm ci` postinstall (`prisma generate`, 403 on `binaries.prisma.sh`), the DB half of `npm test`, `db:setup`, `test:e2e`, `foundation:check-modules`.

**2026-10-25 (kickoff kit):** PRD v1.0, decisions D-1..D-26 + O-2..O-9, domain brief, golden cases GT-01..GT-21 and GQ-01..GQ-11, Phase 1 tasks, CLAUDE.md, KICKOFF.md, `tools/` oracles, frozen fixtures (seed 20261025; hashes in brief §12). Kickoff measurements: 113 received, 87 counted (51 direct + 36 proxy), 26 rejected over 15 codes; quorum 87/120 MET, direct-only 51/120 NOT MET; E1 weighted elects C-02, C-04, C-05 (units would elect C-01, C-02, C-04); E2 TIE_UNRESOLVED C-13/C-14; R1 PASSED; R2, R3, R4 FAILED under their bases. Meeting commitment `a703d58b…037a`. These are the oracle's answers to the generator's own defects (D-24).

## CI runs

| When | Commit | Run | Result |
|---|---|---|---|
| 2026-10-26 | 924ad85 (kit) | https://github.com/shanelabountyai/quorum/actions/runs/40258284168 | green |
| 2026-10-26 | e9714fe (Phase 1 engine) | https://github.com/shanelabountyai/quorum/actions/runs/40260974830 | **red** — `foundation:drift`: no `v1.3.0` tag on a shallow checkout; fixed in 1755c14/7a3520a |
| 2026-10-26 | 7a3520a | https://github.com/shanelabountyai/quorum/actions/runs/40261257481 | **green** |
| 2026-10-26 | 2a9de88 (Phase 1 head) | https://github.com/shanelabountyai/quorum/actions/runs/40262028224 | **green** |
| 2026-10-26 | d42a1c8 on `ci-proof-1-14` (one edited total) | https://github.com/shanelabountyai/quorum/actions/runs/40261860620 | **red** on `tally:eval`, as task 1.14 requires |
| 2026-10-26 | 7db5ebb (2.1 schema + migration) | https://github.com/shanelabountyai/quorum/actions/runs/40320715574 | **red** — `migrate diff`: `--shadow-database-url` is not a Prisma 7 flag (everything before it green, `migrate deploy` included) |
| 2026-10-26 | eef403d (PR-comment channel) | https://github.com/shanelabountyai/quorum/actions/runs/40321120165 | **red** — same step; its output reached PR #1 as a comment |
| 2026-10-26 | 2b06d27 (`SHADOW_DATABASE_URL`) | https://github.com/shanelabountyai/quorum/actions/runs/40321741300 | **green** — `migrate diff` empty: the hand-written migration equals the schema; schema/enum/append-only/role tests green on Postgres 17 |
| 2026-10-26 | 9dae511 (2.3–2.9: load, cast, close, recount, tamper, eval:db, eligibility — the Phase 2 code head) | https://github.com/shanelabountyai/quorum/actions/runs/40322626626 | **green** — `tally:eval:db` 113/87/26, 0 differences; 380 tests; e2e; `migrate diff` empty. The docs commit after it is skipped by `paths-ignore` |
| 2026-10-26 | 94c9e22 (decisions pass: D-37/D-40/D-41, regenerated fixtures) | https://github.com/shanelabountyai/quorum/actions/runs/40345975273 | **green** |
| 2026-10-26 | 0e17929 (D-39/D-42/D-43 schema, roles) | https://github.com/shanelabountyai/quorum/actions/runs/40348272725 | **green** — `migrate diff` empty |
| 2026-10-26 | 98e85f6 (Phase 3 3.1–3.7) | https://github.com/shanelabountyai/quorum/actions/runs/40353005303 | **red** — `playwright test`: the template's `onboarding.spec.ts` expected the template's empty org home, which 3.1 replaced; fixed in 35d3ab9 |

| 2026-10-26 | 35d3ab9 (3.8 e2e + axe, onboarding fix — the Phase 3 code head) | https://github.com/shanelabountyai/quorum/actions/runs/40355829930 | **green** — lint, typecheck, drift, tally:eval, fixtures:check, migrate deploy + diff, tally:eval:db, vitest, 15 e2e with axe; modules-removed green |
| 2026-10-26 | 888d79f (port 6200, D-54; DEMO.md) | https://github.com/shanelabountyai/quorum/actions/runs/40373887534 | **green** — e2e on 6200 |
