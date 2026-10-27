# Quorum — Portfolio Overlap Check

Checked 2026-10-25 against the build-log card list, `saas-foundation/CLONES.md` and the sibling kickoff kits readable from the workspace (housefile in full; gavel, loanbook, adjuster, bracketry, bookable by their CLONES notes and kit conventions). **The donor projects' source trees were not readable from here**; the "Where" column names what to look for and the first session must read each donor before porting (CLAUDE.md working rule "port before you write"). Purpose: keep Quorum from re-teaching what a sibling built, and keep the roster/ledger half from eating the tally.

## Verdict

| Card chip | Already in the portfolio? | What Quorum does instead |
|---|---|---|
| ballots | **No.** Gavel has bids (an auction's "votes"), but nothing in the portfolio casts, rejects with a code, or publishes a ballot | Closed reject vocabulary with precedence; one unit, one ballot; receipt per ballot |
| quorum | **No** | Represented units in both modes, direct-only shown, binding basis from data |
| weighted votes | Partly — LoanBook and Gridline do proportional integer arithmetic | Share bps as of a date summing to 10000; weighted and unweighted always both computed |
| verifiable tally | **No.** Housefile proves undo by hash; LoanBook proves a ledger balances; nothing publishes a commitment a third party can recompute | Merkle root over receipts + committed totals; recount CLI from the anonymized list; sealed voter link with a close-time revoke |

Suggested card chips once it ships: `one unit, one ballot (14 reject codes)` · `quorum: units / weighted / direct-only` · `thresholds as data (6 bases)` · `ties left unbroken` · `receipt + Merkle commitment, recountable` · `sealed voter link`.

## Reuse — port, do not rebuild

| Capability | Donor | Where to read first | Quorum use |
|---|---|---|---|
| Auth, orgs, roles, invites, audit log, outbox, cron, CI, invariants | saas-foundation v1.3.0 | template | As cloned; one org = one association; billing and share links removed or unwired (D-5) |
| Canonical JSON + SHA-256, content-hashed versions | Adjuster | `src/rules/canonical.ts`, its D1/D2/D5 | `canonicalChoices`, commitments (C-1..C-5); rules JSON hashed and recorded |
| Pure engine with a lint for forbidden imports; "never optimal, say what was measured" | Bracketry, Gavel | Bracketry `src/lib/league/` rules in its CLAUDE.md; Gavel `tools/` + `rules/` | `src/tally/` purity rules and `tally:lint` |
| Money as integer cents, one money module, no floats; reversing entries | LoanBook | `src/ledger/money.ts` (its D11), reversal entries | `LedgerEntry` cents; `CREDIT` with `reversesEntryId` (D-21) |
| Dates as calendar strings; no `new Date(string)`, no `@db.Date`; CI under a non-UTC TZ | Bookable | its CLAUDE.md date rules | D-8 timestamps; `TZ=America/Chicago` in CI |
| Append-only tables with UPDATE/DELETE triggers as hand-written SQL | Gridline, Housefile, Gavel | Housefile D-6 migrations | Ballots, proxies, secrets, ledger, violation events (D-19) |
| Row-level security / role-scoped grants in migrations | Gavel (settlement), foundation `authz` | Gavel's clone migrations; foundation `src/core/authz` | The close-time `REVOKE SELECT` on `BallotSecret` (D-20); read Gavel's role SQL first |
| Closed vocabularies as data; no expressions | Adjuster | its D1 reasoning | Rules JSON, six bases, two modes, fifteen codes (D-16, D-26) |
| State machine with an event per transition, illegal transitions refused | BoxLoop (subscription states), Adjuster (claim states) | BoxLoop `src/billing/` state tables | `Violation` / `ViolationEvent` (D-22) |
| Frozen fixtures + stdlib Python oracle + golden answers + manifest | Housefile, Gavel | `tools/`, `fixtures/samples/` | Same workflow (`build_fixtures.py`, `reference_tally.py`, `golden_answers.py`, `verify_fixtures.py`) |
| Outbox notices queued, never sent | callboard / showcall | templates registered into notifications at runtime | Meeting and violation notices (Phase 3) |
| Idempotent close/settlement writing once | Gavel | soft close + settlement | Idempotent meeting close (P0-6) |

## New — each with the fixture that proves it

| # | Lesson | Not in any sibling because | Proven by |
|---|---|---|---|
| 1 | Eligibility as of a record date from ownership intervals, versioned shares and a ledger balance | Siblings have one owner per row and no as-of roster | GQ-01..GQ-05; A-301 = 60, B-610 = 151, A-407, B-307 vs A-508 |
| 2 | Closed reject vocabulary with a stated precedence, every rejected ballot still receipted and published | Gavel refuses bids but does not publish refusals | §4 table; 26 rejects over 15 codes in the fixture; GQ-08 |
| 3 | Proxies without chains; late-proxy-early-ballot | No sibling has delegated action by one person for another's position | P-1..P-8; GQ-09, GQ-10; B-035, B-050, B-039 |
| 4 | One unit, one ballot with co-owners, same-instant casts, and the owner's direct cast superseding a proxy ballot | Nothing in the portfolio has shared ownership of a vote | E-8/E-9; A-205, B-305, B-110, A-402 (superseded), B-409, A-308; GT-21, GQ-11 |
| 5 | Quorum on represented units in two modes, direct-only shown | — | Q-1..Q-4; 87/120 MET, 51/120 direct NOT MET; GQ-06, GQ-07 |
| 6 | Resolution thresholds as six integer inequalities, abstentions per basis, all six always printed | Adjuster evaluates rules on one record; nothing votes | T-1..T-6; R2, R3, R4 traps; GT-10..GT-13, GT-18 |
| 7 | Plurality top-N in two modes with the boundary tie left open | Bracketry breaks standings ties by rule; here the machine refuses | T-7..T-11; E2 TIE_UNRESOLVED; E1 differs; GT-06..GT-09 |
| 8 | Receipt + Merkle commitment + recount from an anonymized list | Housefile's hash proves a state; this proves inclusion and totals to a third party | C-1..C-7; GT-01..GT-05, GT-17, GT-20; `tally:verify`, `tally:recount` |
| 9 | Order-independent tally proven by shuffling | Gavel is order-dependent by design (bid sequence) | `--shuffle 5` in the oracle; 20-shuffle vitest |
| 10 | Sealed voter link the application cannot read after close, with a tamper test | No sibling hides data from its own app role | Phase 2 tamper tests (P0-6) |
| 11 | Honest statement of what the scheme does not provide | — | D-2 non-goals on every receipt screen and in the README |

## Guardrails — lessons Quorum must not take

| Lesson | Owner | Rule here |
|---|---|---|
| N-writer row-lock contention, proxy bidding, soft close | Gavel | Casts are low-volume; no contention test; "proxy" here means a governance proxy, never Gavel's proxy bid |
| Double-entry ledger, accrual, interest | LoanBook | Dues ledger is single-sided append-only rows with a derived balance; no journal |
| Rules engine with authoring UI | Adjuster | Rules JSON is edited as a file; no editor |
| Messy import, entity resolution | Housefile | Roster is loaded from clean fixtures; a roster import is P1 and would port Housefile's mapper |
| Billing from measurements | Gridline (shelved) | Dues are a fixed monthly run; no metering |
| Scheduling, slot search | Bookable | Hearing dates are typed in; no calendar logic |
| Learned models or LLM anywhere in the tally | — | None; the engine is closed arithmetic over closed vocabularies |
| Real cryptographic voting (homomorphic, mix-net) | — | D-2; out of scope, named as such |

## How this was checked

- Read: Housefile's full kit (CLAUDE.md, PRD, decisions, brief, overlap, tasks, tools), `saas-foundation` README/CLONES/`new-project.ts`, the COMMON-BRIEF. The source trees of gavel, loanbook, adjuster, bracketry, bookable, boxloop, callboard and showcall were **not** reachable from the kickoff workspace; the "Where" column is from their CLONES notes and kit conventions and must be confirmed by reading the code before each port (task 1.3).
- `reuse-scan.py` is not reachable from the cloud session; KICKOFF step 6 records it as skipped.
