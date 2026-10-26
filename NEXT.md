# NEXT

## ▶ Next session: Shane reviews the Phase 1 PR and the open items; Phase 2 only after that

Branch `kickoff`, PR #1 (`kickoff` → `main`, https://github.com/shanelabountyai/quorum/pull/1), **never merged by the agent**. Phase 1 exit criteria are met except what only Shane can do (review and merge). `docs/phase-2-tasks.md` is a draft at the gate; nothing of Phase 2 is built (no Prisma models, migrations or UI).

**To decide before Phase 2:** O-10 (publish `bps_as_of` per ballot so the WEIGHTED totals are recountable from the list — D-28), the Phase 2 question in `docs/phase-1-plan.md` §Contradictions item 8 (E-9 at cast time has to re-label an earlier `Ballot` row, in tension with D-19's "a ballot is never edited"), and the stale pre-D-26 numbers in the PRD / overlap / D-15 (item 3 there). The `~/.claude/CLAUDE.md` port-table row (quorum → 7200) is still Shane's to add; `saas-foundation/CLONES.md` already has the row.

**2026-10-26 (first build session, unattended, cloud):** Phase 1 tasks 1.1–1.13 done, 1.14 done (see CI below). Built: `src/tally/` (17 files: codes, errors, time, canonical, commit, rules, csv, load, types, asof, ballots, quorum, thresholds, seats, tally, published, index), `scripts/tally-{lint,eval,verify,recount,fixtures}.ts`, `tests/tally/` (7 files, 181 tests), `docs/EVAL.md`, `docs/phase-1-plan.md`, decisions D-27..D-30 and O-10, CI gate (`tally:lint`, `tally:eval`, `fixtures:check`, vitest, all under `TZ=America/Chicago`), billing removed by manifest (D-27 c), `tools/__pycache__` untracked. Decided: D-27 (session 0 record: reuse scan skipped; port 7200 proposed, row is Shane's; billing removed, share links unwired; donors — Gavel read, Bookable read, Adjuster/LoanBook/Bracketry unreadable so `canonical.ts` written fresh), D-28 (recount's stated limit), D-29 (shuffle seed 20261025), D-30 (`seats.ts` orders nothing). Left open: O-10; the Phase 2 E-9/D-19 tension; the stale numbers in three docs.

**Gate output (local, 2026-10-26):**
- `npm run tally:eval` → 113 ballots, 87 counted, 26 rejected; every row of the four expected files matches; output byte-identical to `fixtures/samples/reference_output.txt`; meeting commitment `a703d58b3c148c601c9eed219095cb0e4d3894c1d1b86f774d8ac077d6c5037a`.
- `npm run test:engine` → 181 passed (7 files), identical under `TZ=America/Chicago` and `TZ=Pacific/Kiritimati`.
- `npm run tally:lint` → OK (17 files); a planted `Math.random()` + id sort in `seats.ts` fails with three named lines (reverted).
- `npm run fixtures:check` → OK seed=20261025 (14 files ok, goldens OK, `fixtures/` clean).
- `npm run tally:recount` → 29 match, 0 differ, 6 not recomputable (WEIGHTED totals, D-28). `npm run tally:verify` → all 113 receipts in the root; a flipped digit exits 1.
- `npm run foundation:drift` → clean against v1.3.0 (modules removed: billing). `npm run lint` → 0 errors (2 warnings: the template's unused `orgId` in `org-hooks.ts` after the billing removal, same as Gavel; `baseURL` in an e2e spec).

**Could not run locally (D-6, CI decides):** `npm ci` fails at `postinstall: prisma generate` — `Error: Failed to fetch sha256 checksum at https://binaries.prisma.sh/all_commits/0edf323efd1d98336f3f0a68684b56f689b900d3/debian-openssl-3.0.x/schema-engine.gz.sha256 - 403 Forbidden` (the sandbox proxy refuses `binaries.prisma.sh`; the engine file itself gets the same 403 with the checksum check off). `npm ci --ignore-scripts` installs. Consequences: `npm run typecheck` fails only on the template's `@/generated/prisma/*` imports (0 errors under `src/tally`, `scripts/tally-*`, `tests/tally` by filtered `tsc`); `npm test` (database half), `db:setup`, `test:e2e`, `foundation:check-modules` not run here. `gh auth status` says the token is invalid, but `gh api` reads work.

**CI:** see the run links at the bottom of this file (kept current after each push).

---

**2026-10-25 (kickoff kit):** Kit written in the cloud workspace: PRD v1.0, decisions D-1..D-26 + O-2..O-9 (O-1 decided by the owner the same day: D-26, an owner's direct cast supersedes a counted proxy ballot), domain brief with the rule codes (B-1..B-3, P-1..P-8, E-1..E-9, S-1..S-5, Q-1..Q-4, T-1..T-11, C-1..C-7), golden cases GT-01..GT-21 and GQ-01..GQ-11, the defect and trap catalog, kickoff measurements, portfolio overlap, Phase 1 tasks (1.1–1.14), CLAUDE.md, KICKOFF.md, `.claude/settings.json` (Fable pin). Tools in `tools/` (Python 3, stdlib, run with `-I`): `tallylib.py` (spec made executable), `build_fixtures.py` (seed 20261025; asserts every trap and the answer key against the oracle before writing), `reference_tally.py` (eval table; `--write-expected`, `--shuffle`), `golden_answers.py` (prints OK), `verify_fixtures.py` (prints OK). Fixtures were generated twice in separate directories with identical sha256 values on all 15 files (brief §12); the full set is in `fixtures/` and samples plus `MANIFEST.json`, `meeting.json` and `reference_output.txt` are under `fixtures/samples/`.

Kickoff measurements (reference tally on the frozen fixtures, after the D-26 regeneration): 113 ballots received, 87 counted (51 direct + 36 by proxy), 26 rejected over 15 codes; quorum 87/120 units MET at 5000 bps, 7232/10000 bps MET, direct-only 51/120 NOT MET; E1 (weighted) elects C-02, C-04, C-05 while units would elect C-01, C-02, C-04; E2 (units) TIE_UNRESOLVED between C-13 and C-14 at 40 with one seat open; R1 PASSED; R2 FAILED (two-thirds of all shares: 4414 bps) though two-thirds of votes cast passes; R3 FAILED (40 yes of 120 units) though a majority of votes cast passes; R4 FAILED (33×2 ≤ 87 represented) though yes > no. Meeting commitment `a703d58b3c148c601c9eed219095cb0e4d3894c1d1b86f774d8ac077d6c5037a`; 5 shuffles, same commitment. These are the oracle's answers to the generator's own defects (D-24), not a product claim.

## CI runs

| When | Commit | Run | Result |
|---|---|---|---|
| 2026-10-26 | 924ad85 (kit, before this session) | https://github.com/shanelabountyai/quorum/actions/runs/40258284168 | green |
