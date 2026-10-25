# CLAUDE.md — Quorum

Learning project: HOA / co-op governance for a 120-unit synthetic condominium association. Elections with ballots, quorum, weighted votes by unit share, proxies without chains, resolution thresholds as data, ties left unbroken, and a secret ballot with a verifiable tally (hashed receipts, Merkle commitment, sealed voter link). Plus a small dues ledger and a violation workflow. **Synthetic data only. No real people, no real bylaws, no legal or election-certification claims. The receipt scheme proves inclusion and totals; it is not coercion-resistant or receipt-free, and every screen that shows a receipt says so.** Keep the scope-honesty banner verbatim in README.md.

Read first: `prd-quorum.md` (what), `docs/decisions.md` (authoritative; outranks the PRD), `docs/domain-brief.md` (vocabulary, rule codes B/P/E/S/Q/T/C, golden cases GT/GQ, measurements, fixture hashes), `docs/portfolio-overlap.md` (what to port, what not to build). Current work: `docs/phase-1-tasks.md`. Session state: `NEXT.md`.

## Non-negotiables
1. **The engine is pure and order-independent.** `src/tally/` imports no database, clock, randomness, network or model client (`tally:lint`). Ballots are evaluated in `(cast_at, ballot_id)` order whatever order they arrive in; same ballots, same totals, same commitment.
2. **One unit, one ballot.** A unit is represented by exactly one `COUNTED` ballot. First valid cast wins; later valid casts are `REJECT:DUPLICATE_UNIT`. Co-owners share the ballot. Proxies never chain.
3. **Every ballot gets one code from a closed set with a stated precedence** (brief §4), and a rejected ballot still gets a receipt and is still published with its code.
4. **Ties are never broken by the machine.** A boundary tie is `TIE_UNRESOLVED` with the tied ids; the seat stays open. No lexical, random or id-order tiebreak anywhere under `src/`.
5. **Thresholds, modes and quorum rules are data** (rules JSON, closed vocabulary). Adding a basis needs a `docs/decisions.md` entry and a golden case. The eval always prints the result under every basis and both modes.
6. **The application cannot read the voter link after close.** `BallotSecret` is the only join from ballot to unit and caster; a trigger revokes the app role's `SELECT` at close; a tamper test proves it. The recount runs from `Ballot` rows alone.
7. **Integers only.** Shares are basis points summing to exactly 10000 as of every date; money is integer cents; timestamps are fixed-width strings on one named axis (no `new Date(string)`, no `@db.Date`, no timezone arithmetic).
8. **Fixtures are frozen.** `fixtures/` is generated once by `tools/build_fixtures.py --seed 20261025` and `tools/reference_tally.py --write-expected`; `tools/verify_fixtures.py` must print OK in CI. Product code never reads `answer_key_ballots.csv` or `expected_*.csv`; only `tally:eval` does.
9. **Never edit an expected value to pass a test.** GT/GQ values and `expected_*.csv` come from the oracle in `tools/`. If TypeScript disagrees, stop and show the owner both derivations.
10. **Say what the numbers mean.** The fixture proves agreement with the spec on 109 ballots, 24 rejects, 14 traps, by the same author. Never "secure", "verified" or "accurate" without the number and the D-2 limits. Nothing is sent: notices stop in the outbox.

## Working rules
- **TDD order:** canonical JSON + SHA-256 (GT-01..GT-05) → rules schema → as-of lookups (GQ-01..GQ-05) → ballot rules (GQ-08..GQ-10, GT-14) → receipts and Merkle root → quorum, thresholds, seats (GT-06..GT-13, GQ-06, GQ-07) → full tally (GT-15..GT-20) → `tally:eval` against `expected_*.csv` → shuffle test → `tally:verify` / `tally:recount` → (Phase 2) schema, triggers, cast path, sealed link, tamper tests → (Phase 3) UI, ledger, violations. Write the failing test against a committed fixture first.
- **Fixtures:** tests read `fixtures/`; code never generates them. To change a fixture, change `docs/decisions.md` first, regenerate with `tools/build_fixtures.py` and `tools/reference_tally.py --write-expected`, confirm `verify_fixtures.py` and `golden_answers.py` print OK, update the hashes in `docs/domain-brief.md` §12, review the diff.
- `tools/*.py` are test oracles, not product code. Don't port `tallylib.py` line for line; the TypeScript engine is written from `docs/domain-brief.md` §4–§8 and must agree with it on every ballot.
- **Port before you write.** Donors are listed in `docs/portfolio-overlap.md`. Read the donor, port it, record the lineage in `docs/decisions.md`.
- Phase gate: don't start the next phase until the current phase's exit criteria pass. Phases: 1 engine + eval (no writes) → 2 schema, sealed link, proofs → 3 UI, dues, violations. Write the next phase's task list at the gate and stop for review.
- Small commits, one concern each, naming specific files (never `git add -A`). Branch + PR; **never merge.** Note seams for non-goals but don't build them.
- **Ask before adding dependencies.** Ask-before-add list: any CSV parser, any Merkle/hash library (Node `crypto` is enough), any date library, any state-machine library, any charting library. Own the small things.
- **Cloud session:** the sandbox may not download Prisma engines or Playwright browsers. Record what could not run in `NEXT.md`; **CI decides**, not the local run.
- **Model is pinned to Claude Fable 5.1 (`claude-fable-5-1`)** in `.claude/settings.json` (D-3).
- End each session by updating `NEXT.md`: what was built, decided, left open, and the gate output.

## Session 0 — reuse check
The house reuse scan (`~/Projects/reuse-scan.py`) is not reachable from the cloud session. Record in `docs/decisions.md`: "Reuse scan skipped (cloud session); overlap taken from `docs/portfolio-overlap.md`; donors read before each port in task 1.3." Re-run it when the repo is next opened on the Mac.

## Stack
TypeScript on a clone of saas-foundation v1.3.0: Next.js 16, Prisma 7, PostgreSQL 17, vitest, Playwright. **Port 6200** (proposed; confirm against the port table in `~/.claude/CLAUDE.md`; the row itself is Shane's to add — D-4). Foundation modules: keep orgs, roles, invites, audit, notifications/outbox; remove or leave unwired billing and share links (D-5). Immutability and the close-time revoke via triggers as hand-written SQL in clone migrations. Python only in `tools/` (stdlib only, run with `python3 -I`). Template-owned paths (`src/core/**`, `tests/invariants/**`, core migrations, security routes) are never edited here; `npm run foundation:drift` enforces it. Local `DATABASE_URL`s carry `?connection_limit=10&pool_timeout=20`. `vercel.json` carries the house `ignoreCommand` even though no deploy is planned. CI runs with `TZ=America/Chicago`.

## Commands (create in Phase 1, task 1.1)
- `npm test` — vitest against the local `quorum_test` database (engine tests need no database)
- `npm run tally:eval` — runs the engine over `fixtures/`; prints the brief §11 table; exits non-zero if anything differs from `fixtures/expected_*.csv`. Prints `0 ballots` and exits 0 until task 1.9
- `npm run tally:verify -- --receipt <hex>` — is this receipt a leaf of the root recomputed from `fixtures/published_ballots.csv`?
- `npm run tally:recount -- --published <csv> --meeting <json>` — recomputes totals and commitments from the published list alone
- `npm run fixtures:check` — `python3 -I tools/verify_fixtures.py && python3 -I tools/golden_answers.py && git diff --exit-code fixtures/ && test -z "$(git status --porcelain fixtures/)"`
- `npm run tally:lint` — greps `src/tally/` for `Date.now`, `Math.random`, `new Date(`, `prisma`, `fetch`, `anthropic`, `@/core`; greps for float money and for tiebreak sorts in `seats.ts`; validates the rules JSON schema

## Definition of done (any task)
Tests green (or recorded as CI-only with the reason), `tally:eval` matching the reference exactly, `fixtures:check` OK, `tally:lint` OK, no float money or shares and no forbidden import under `src/tally/`, decisions doc updated if a rule changed, `NEXT.md` updated, numbers (not adjectives) in the commit message when a measurement changed.
