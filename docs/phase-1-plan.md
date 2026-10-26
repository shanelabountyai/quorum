# Phase 1 plan — written by the unattended build session, 2026-10-25/26

What order the Phase 1 tasks were done in, which donor was read for each port, every contradiction found in the docs, every default taken, and what the sandbox could not run. Every default is reversible; the authoritative record is `docs/decisions.md` D-27..D-30 and O-10.

## Order

TDD order from CLAUDE.md, each step a commit with its failing test written against a committed fixture first:

| Step | Task | Module | Tests | Status |
|---|---|---|---|---|
| 1 | 1.1 scaffold | `package.json`, README banner, CI, eslint, `scripts/tally-lint.ts`, billing removal | `foundation:drift`, `lint` | done |
| 2 | 1.2 fixtures | already on the branch; verified | `fixtures:check` | done (OK on a clean checkout; hashes equal brief §12 and `fixtures/samples/MANIFEST.json`; `reference_tally.py` output equals `reference_output.txt`) |
| 3 | 1.3 port | `src/tally/canonical.ts` (fresh), `time.ts` (Bookable), `codes.ts`, `errors.ts`, `commit.ts` | GT-01..GT-05, GT-20, Python-escaping cross-check | done |
| 4 | 1.4 rules + loaders | `rules.ts` (zod, closed enums, `proxy_max_depth` literal 1), `csv.ts` (own RFC 4180 reader), `load.ts`, `types.ts`, `scripts/tally-fixtures.ts` | schema refusals name the field; `meeting.json` loads; counts 120/124/141/2627/49/113 | done |
| 5 | 1.5 as-of | `asof.ts` | GQ-01..GQ-05; A-301 = 60, B-610 = 151, A-407 → O-138, delinquent set | done |
| 6 | 1.6 ballots | `ballots.ts` | GQ-08..GQ-11, GT-14, every row of `expected_ballots.csv`, INPUT_INVALID | done |
| 7 | 1.7 commitments | `commit.ts` (with step 3) | every receipt in `expected_ballots.csv`; root = `expected_quorum.csv` | done |
| 8 | 1.8 tally | `quorum.ts`, `thresholds.ts`, `seats.ts`, `tally.ts` | GT-06..GT-13, GT-15..GT-21, GQ-06, GQ-07; the three expected files row for row | done |
| 9 | 1.9 `tally:eval` | `scripts/tally-eval.ts` | output identical to `reference_output.txt`; a moved cast_at on B-001 exits 1 naming `B-001.status` | done |
| 10 | 1.10 shuffle | `tests/tally/shuffle.test.ts` | 20 shuffles, seed 20261025 (D-29) | done |
| 11 | 1.11 verify + recount | `published.ts`, `scripts/tally-verify.ts`, `scripts/tally-recount.ts` | every receipt verifies, a flipped digit does not; recount matches on 29 values, 6 not recomputable (D-28) | done |
| 12 | 1.12 `tally:lint` | with step 1; planted `Math.random()` fails it | done |
| 13 | 1.13 `docs/EVAL.md` | the §11 table as printed by TypeScript | done |
| 14 | 1.14 CI gate | `ci.yml` runs `foundation:drift`, `tally:lint`, `tally:eval`, `fixtures:check`, vitest under `TZ=America/Chicago` | done — red run 40261860620 (throwaway branch `ci-proof-1-14`, one total edited, fails on `tally:eval`), green run 40261257481 on `kickoff`; links in NEXT.md |

## Donors read for the ports (task 1.3)

| Capability | Donor named in `docs/portfolio-overlap.md` | What was readable | What was done |
|---|---|---|---|
| Canonical JSON + SHA-256 | Adjuster `src/rules/canonical.ts` | **Not readable** (private; GitHub API 403; not attachable from this session) | Written fresh to Python's `json.dumps(sort_keys, separators=(",",":"), ensure_ascii)` byte for byte; GT-01/GT-02 plus an escaping test cross-checked against `python3 -c 'json.dumps(...)'` (D-27 d) |
| Pure engine layout + forbidden-import lint | Bracketry `src/lib/league/`, Gavel `tools/` + `rules/` | Gavel readable (public, cloned read-only to `/home/claude/shanelabountyai/gavel`); Bracketry not | `scripts/tally-lint.ts` after Gavel `scripts/rules-lint.ts`; engine layout after Gavel `src/auction/engine/` (one directory, no I/O, index barrel) |
| Integer cents, one money module | LoanBook `src/ledger/money.ts` (also in Gavel as `src/auction/engine/money.ts`) | Gavel's copy readable | **Not ported in Phase 1**: nothing in the tally divides, rounds or carries money. Port Gavel's `money.ts` (LoanBook lineage) when the dues ledger arrives in Phase 3 (D-21 remainder line) |
| Calendar-string dates, no `new Date(string)` | Bookable CLAUDE.md date rules | Local clone `/home/claude/bookable-appointment-service` readable | `eslint-rules/no-axis-crossing.mjs` selectors copied into `eslint.config.mjs` for `src/tally`, `scripts/tally-*`, `tests/tally`; branded `Timestamp`/`CalendarDay` after `packages/core/time/types.ts`, regex-validated (no Temporal: ask-before-add) |
| Frozen fixtures + Python oracle workflow | Housefile, Gavel | Housefile local clone has no `tools/`; Gavel's `fixtures:check` script line read | `fixtures:check` is Gavel's line with `python3 -I` |
| Module removal | Gavel D-28 | readable | Followed: billing removed by manifest, share links unwired (D-27 c) |

## Contradictions and things that cannot be built as written (not resolved here unless marked)

1. **C-6 / P0-5 / task 1.11 say the recount needs the published list alone; the published list has no share per ballot, so the WEIGHTED totals (and `bps_represented`) cannot be recomputed from it.** The frozen `published_ballots.csv` columns are `receipt, ballot_id, status, code, choices_canonical`. Commitments bind both halves, so a recount that claims to recompute the commitments from the list alone is not possible as written. **Default taken (D-28):** the recount recomputes everything the list supports, takes the WEIGHTED totals from the published totals, recomputes the commitments over them, and prints `n/a` for the six WEIGHTED totals. **Open for Shane (O-10):** publish `bps_as_of` per row (changes C-6, regenerates fixtures, widens the side channel the PRD risk list names).
2. **The rules JSON carries `total_share_bps` but not `total_units`**, and `MAJORITY_OF_ALL_UNITS`, both quorum inequalities and the published-list recount need the unit count. The engine takes it from the roster (`units.csv`); the recount takes it from the published quorum report. A `total_units` field in `rules` would make the recount independent of that file; it is a schema and fixture change, so not taken.
3. **Stale pre-D-26 numbers in three places:** PRD Goal 1 and the Build Notes say "fourteen reject codes" (there are 15 with `PROXY_SUPERSEDED_BY_OWNER`); `docs/portfolio-overlap.md` "New" rows 2 and 5 say "24 rejects over 14 codes" and "85/120 MET, 49/120 direct NOT MET" (now 26 over 15, 87/120, 51/120); `docs/decisions.md` D-15's Why says "49 direct of 120, 85 with proxies". Docs only; the brief §11 and the fixtures agree with each other and with the engine. Left for Shane to edit (PRD and overlap are his documents).
4. **`docs/phase-1-tasks.md` 1.1 says `tally:eval` prints `0 ballots` and exits 0 until 1.9**; the script keeps that branch (an empty `--ballots` file prints `0 ballots`), but on the real fixtures it has printed the full table since the same session. Not a conflict in effect.
5. **CI triggers only on `pull_request` and pushes to `main`**, so the task 1.14 red/green proof "on a throwaway branch" needs that branch to carry a workflow that triggers on push to itself, or a PR. Done by pushing a throwaway branch whose `ci.yml` adds its own name to `on.push.branches` (the only change besides the one edited total); see NEXT.md for the run links.
6. **`npm test` as defined runs the template's database-backed tests too** (`dotenv -e .env.test -- vitest run`); in the sandbox there is no `.env.test` and no Prisma engine, so the engine tests are run with `npm run test:engine` (added in 1.1: `vitest run tests/tally`). CI runs the whole suite.
7. **KICKOFF.md step 1 says to stop if 7200 appears in `saas-foundation/CLONES.md`.** It does appear — as Quorum's own row (added by Shane in a714ee9 after the port move), not a clash. Read as "no clash" and continued.
8. **The brief's §8 "Sealed link" paragraph says rules B-1..E-8 run at cast time**; E-9 (D-26) also has to run at cast time in Phase 2, since it re-labels an earlier row — which means the cast path must be allowed to UPDATE one `Ballot` row's status/code, in tension with D-19 "a ballot is never edited" unless the superseded label is written as a new append-only event or the trigger permits exactly that transition. Flagged for `docs/phase-2-tasks.md`; nothing to build in Phase 1.

## Defaults taken (all recorded in `docs/decisions.md`)

- D-27 (a) reuse scan skipped; (b) port 7200 proposed, row is Shane's; (c) billing removed by manifest, share links unwired, notifications kept; (d) donor outcome above.
- D-28 recount shape and its stated limit; O-10 opened.
- D-29 shuffle seed 20261025, mulberry32, 20 shuffles, premise asserted.
- D-30 `seats.ts` orders nothing; `tally:lint` refuses every ordering call there.
- `tally:lint` extras beyond the task text: `Math.floor/ceil`, `Date.parse`, random-bytes names, `setTimeout/setInterval`, `/ 10000`, and `.toSorted(`. Bans are strictly wider, never narrower.
- `test:engine` script added so the sandbox can run the no-database half of `npm test`.
- `fixtures:check` uses `python3 -I` as CLAUDE.md asks; Gavel's line used plain `python3`.
- The MEETING row's "received / counted / rejected" live in `expected_results.csv`'s `counted / voted / blank` columns (the oracle's layout); `tally:eval` and `tally:recount` read them that way and say so in a comment.

## What the sandbox could not run (D-6: CI decides)

- `npm ci` → `postinstall: prisma generate` → `Error: Failed to fetch sha256 checksum at https://binaries.prisma.sh/all_commits/0edf323efd1d98336f3f0a68684b56f689b900d3/debian-openssl-3.0.x/schema-engine.gz.sha256 - 403 Forbidden` (the proxy refuses `binaries.prisma.sh`; `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1` then fails on the engine file itself, same 403). `npm ci --ignore-scripts` installed the tree.
- Therefore `npm run typecheck` fails on the template's `@/generated/prisma/*` imports only (15 errors, none under `src/tally`, `scripts/tally-*`, `tests/tally`; checked with a filtered `tsc --noEmit`); `npm test` (database half), `npm run db:setup`, `npm run test:e2e`, `foundation:check-modules` (needs `prisma validate`/`next build`) were not run locally.
- Ran locally and green: `foundation:drift`, `lint`, `tally:lint`, `tally:eval`, `fixtures:check`, `test:engine` (181 tests), `tally:verify`, `tally:recount`.
- `gh auth status` reports the token invalid but `gh api` reads work; PR #1 (`kickoff` → `main`) is open, so every push to `kickoff` runs CI.
- The proxy refuses `git push` of a tag and of a branch deletion (HTTP 403 / "remote end hung up"), so origin has no `v1.3.0` tag (CI tags the release commit by its message before `foundation:drift`; see the comment in `ci.yml`) and the throwaway branch `ci-proof-1-14` is still on origin for Shane to delete. Run logs are on a blob host the proxy also refuses; failures were diagnosed from the step list and the local reproduction.
- `actions/checkout@v4`'s shallow clone broke `foundation:drift` on the first push (run 40260974830: no `v1.3.0` to diff against); fixed with `fetch-depth: 0` + the tag shim.
