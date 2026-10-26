# EVAL — the tally as measured by TypeScript

Every number below is printed by the command named beside it, on the frozen fixtures (`tools/build_fixtures.py --seed 20261025`, §Fixture hashes). Measured 2026-10-26 on branch `kickoff`.

**What these numbers are (D-24):** the oracle's answers on the generator's own defects, by the same author. The fixture proves that the TypeScript engine agrees with the Python spec (`tools/tallylib.py`) on 113 ballots with 26 injected rejects over 15 codes and 16 named traps, in any ballot order. It does not prove that the spec matches any real association's bylaws (those are O-items), and it says nothing about coercion or vote-buying: the receipt scheme gives individual and tally verifiability and is **not coercion-resistant or receipt-free** — a voter who shows the receipt and the nonce proves how they voted (D-2).

## `npm run tally:eval` — 113 / 87 / 26, 0 differences

```
meeting AM-2026 record_date 2026-11-14
ballots received 113 / counted 87 / rejected 26
rejected by code: DUPLICATE_UNIT 5, EARLY 1, INELIGIBLE_DELINQUENT 5, LATE 3, NOT_OWNER 1, PROXY_CHAIN 1, PROXY_GRANTOR_NOT_OWNER 1, PROXY_HOLDER_MISMATCH 1, PROXY_HOLDER_NOT_MEMBER 1, PROXY_LATE 2, PROXY_REVOKED 1, PROXY_SUPERSEDED_BY_OWNER 1, PROXY_UNIT_MISMATCH 1, PROXY_UNKNOWN 1, UNKNOWN_UNIT 1
unknown contest keys on counted ballots: 1
quorum basis UNITS threshold 5000 bps: units 87/120 MET; weighted 7232/10000 bps MET; direct only 51/120 NOT MET (proxy units 36); binding: MET
merkle_root cbf6767e889c534353cdf2b7ad7b91845c98645b5207d36ab79cd54dc1665d49
```

| Contest | Counted / voted / blank / void | Totals | Result | Commitment |
|---|---|---|---|---|
| E1 Board of Directors (3 seats, WEIGHTED) | 87 / 81 / 3 / INVALID_CHOICE 1, OVERVOTE 1, UNKNOWN_CANDIDATE 1 | WEIGHTED C-02 4613, C-04 4118, C-05 3584, C-01 3579, C-03 3525 · UNITS C-02 57, C-04 53, C-01 45, C-03 40, C-05 39 | **ELECTED C-02, C-04, C-05**; UNITS would elect C-01, C-02, C-04 (differs: True) | `404952858cb10ebf7156b3f50cc50f74949d1355c11dcec6fe64d35efe3570fc` |
| E2 Reserve Study Committee (2 seats, UNITS) | 87 / 82 / 3 / DUPLICATE_CANDIDATE 1, OVERVOTE 1 | UNITS C-12 47, C-13 40, C-14 40, C-11 32 · WEIGHTED C-12 3677, C-14 3396, C-13 3345, C-11 2852 | **TIE_UNRESOLVED**: elected C-12; open seats 1; tied C-13, C-14; WEIGHTED would elect C-12, C-14 (differs: True) | `d1211dfea505510c125f4fbd911912ed897eaeab7e2b5179e631a1a925286077` |
| R1 2027 operating budget (MAJORITY_OF_VOTES_CAST) | 87 / 83 / 4 / none | units YES 56, NO 20, ABSTAIN 11; bps 4726 / 1605 / 901 | **PASSED**; by basis T-1 PASS, T-2 PASS, T-3 FAIL, T-4 PASS, T-5 PASS, T-6 FAIL | `f8d246b2fb08aa0fa29387194111298c4a23f114a5b74c24159d043ce3b74f32` |
| R2 $180,000 roof assessment (TWO_THIRDS_OF_ALL_WEIGHTED_SHARES) | 87 / 80 / 6 / INVALID_CHOICE 1 | YES 53, NO 18, ABSTAIN 15; bps 4414 / 1523 / 1239 | **FAILED** (4414 × 3 = 13242 < 20000); T-1 PASS, T-2 PASS, T-3 FAIL, T-4 PASS, T-5 PASS, T-6 FAIL | `92ef0d6d2e473a6cf148144038c3e024346305b98dea8e245436f2258cf4b80d` |
| R3 bylaws §9.2 lease term (MAJORITY_OF_ALL_UNITS) | 87 / 82 / 5 / none | YES 40, NO 39, ABSTAIN 8; bps 3409 / 3205 / 618 | **FAILED** (40 × 2 = 80 ≤ 120); T-1 PASS, T-2 FAIL, T-3 FAIL, T-4 FAIL, T-5 PASS, T-6 FAIL | `d8ad22f25ea94118c854a0b938e83fb7fdbe20e230885e4aac2dd1079197a43a` |
| R4 two-pet limit (MAJORITY_OF_UNITS_REPRESENTED) | 87 / 81 / 6 / none | YES 33, NO 32, ABSTAIN 22; bps 2652 / 2697 / 1883 | **FAILED** (33 × 2 = 66 ≤ 87); T-1 PASS, T-2 FAIL, T-3 FAIL, T-4 FAIL, T-5 FAIL, T-6 FAIL | `603919525c475a9a8c1fa68c369552bfce99acdb36bc5ce0a496c8860f38d994` |

`meeting_commitment a703d58b3c148c601c9eed219095cb0e4d3894c1d1b86f774d8ac077d6c5037a`

The printed table is byte-identical to `fixtures/samples/reference_output.txt` (Python) between the `meeting` and `meeting_commitment` lines, and the diff against `expected_ballots.csv` (113 rows), `expected_totals.csv` (42), `expected_results.csv` (7) and `expected_quorum.csv` (13) reports 0 differences. The exit code is 1 on the first difference: moving B-001's cast time past close names `expected_ballots.csv: B-001.status`; changing R3's basis in a copy of `meeting.json` flips R3 to PASSED and names `expected_results.csv: R3.mode_or_basis`, with no code change.

## `npm run test:engine` — 181 tests, 7 files, no database

GT-01..GT-21 and GQ-01..GQ-11 pass with the brief's values (`tests/tally/commit.test.ts`, `asof.test.ts`, `ballots.test.ts`, `tally.test.ts`); every row of `expected_ballots.csv` is a test case (`ballots.test.ts`, 113 cases); the three other expected files are compared row for row (`tally.test.ts`). Under `TZ=America/Chicago` and `TZ=UTC` the results are identical (the engine never constructs a Date; `eslint.config.mjs` and `tally:lint` enforce it). CI runs the whole suite under `TZ=America/Chicago`.

## Order independence — 20 shuffles, 1 answer (`tests/tally/shuffle.test.ts`)

Seed **20261025**, generator mulberry32, 20 shuffles of the 113 fixture ballots (D-29); each gives the same 113 statuses and codes, the same receipt set, the same totals, results and commitments, the same root `cbf6767e…65d49` and the same meeting commitment `a703d58b…037a`. The oracle's own `--shuffle 5` agrees.

## `npm run tally:verify` / `npm run tally:recount`

- Every one of the 113 published receipts verifies against the recomputed root; a receipt with one flipped hex digit does not (`tests/tally/published.test.ts`; the CLI exits 1).
- `tally:recount` from `published_ballots.csv` + `meeting.json`: **29 recomputed values match the published ones, 0 differ, 6 not recomputable** — the six WEIGHTED totals, because the published row carries no share (D-28, O-10). Recomputed from the list alone: the root, 113 / 87 / 26 by code, every UNITS total, counted/voted/blank/void per contest, E1 and E2 in UNITS mode (E2's tie included), R1–R4 under the four unit bases. The commitments are recomputed from the root and the published totals and equal the published ones. A changed published total breaks the commitment (tested).

## `npm run tally:lint` — OK, 17 files

No Prisma, `@/core`, `@/app`, `@/modules`, `Date.now`, `new Date(`, `Date.parse`, `Math.random`, random bytes, `process.env`, `fetch`, timers, `anthropic`, `parseFloat`, `toFixed`, `Math.round/floor/ceil`, decimal literal or `/ 100` / `/ 10000` under `src/tally/`; no `.sort(`, `.reverse(`, `.toSorted(` or `localeCompare` in `seats.ts`; `fixtures/meeting.json` passes the closed schema. A planted `Math.random()` plus an id sort in `seats.ts` fails with three named lines (checked 2026-10-26, reverted).

## Fixture hashes (`npm run fixtures:check` — OK seed=20261025)

`verify_fixtures.py` regenerates to a temp dir and compares every sha256 (all 14 files `ok`), `golden_answers.py` ends `OK`, and `git diff --exit-code fixtures/` is clean. The table is `docs/domain-brief.md` §12; `fixtures/MANIFEST.json` is `509e23166a6c343976ae2f8844c78dc1a76265b182ccff0832bf172ee20534d6`.

## Phase 2 — `npm run tally:eval:db` — the same 113 / 87 / 26 over the tables, 0 differences

Measured 2026-10-26 on the Phase 2 schema (`prisma/migrations/20261026000000_quorum_init`), locally against Postgres 16 and in CI against Postgres 17 from scratch. The 113 fixture ballots go through `castBallot` in `(cast_at, ballot_id)` order (D-36) with their fixture nonces — each one evaluated by the unchanged Phase 1 rules against the live roster and the unit's current counted ballot, then written by `quorum_cast_ballot` (the only function that may write a ballot, D-33) — then `closeMeeting`, then `recountMeeting` from `Ballot` rows alone (no `BallotSecret`, no roster: the totals the inequalities need are frozen onto the `Meeting` at close, D-35 h).

- Tables after the replay: 113 `Ballot`, 113 `BallotSecret`, **114** `BallotStatusEvent` (113 labels at cast plus the one E-9 relabel: B-088 seq 2 `REJECTED`/`PROXY_SUPERSEDED_BY_OWNER`, caused by B-029, at B-029's `castAt`; D-31), 6 `ContestResult`.
- Every row of `expected_ballots.csv` matches on status, code, bps and receipt (the unit id is not stored, D-20); every row of `expected_totals.csv`, `expected_results.csv` and `expected_quorum.csv` matches; the stored labels equal `evaluateBallots` over the same set, ballot for ballot.
- Stored at close: root `cbf6767e889c534353cdf2b7ad7b91845c98645b5207d36ab79cd54dc1665d49`, meeting commitment `a703d58b3c148c601c9eed219095cb0e4d3894c1d1b86f774d8ac077d6c5037a`, the six contest commitments of the table above; the recount from `Ballot` rows equals all of them. Closing twice writes nothing and returns the same.
- The published export from the tables (`src/meetings/published.ts`) equals `fixtures/published_ballots.csv` **byte for byte** (113 rows, C-6, no bps column — D-32).
- Tamper tests (`tests/meetings/close.test.ts`, `schema.test.ts`), each asserted on its SQLSTATE or message: after close `SELECT` on `BallotSecret` as `quorum_app` is `42501`; `UPDATE`/`DELETE` on `Ballot`, `BallotStatusEvent`, `BallotSecret`, `Proxy`, `LedgerEntry`, `ContestResult` is `P0001 "<table> is append-only (D-19)"` from the client and from raw SQL; a label appended to a sealed ballot, a changed commitment, title or `sealedAt` on a closed meeting, and an insert into a closed meeting are refused; a direct `INSERT` into `Ballot` as the app role is `42501`. **The commitment binds the rows:** a superuser who disables the trigger and flips one `choicesCanonical` (B-001 R1 YES→NO) leaves the root unchanged and moves the R1 and meeting commitments, and the recount reports exactly those two differences against the stored result.
- Found by this half on its first run: a replay in *file* order labelled B-020 `PROXY_SUPERSEDED_BY_OWNER` instead of `DUPLICATE_UNIT`, because file order is id order and not cast order; the cast path now refuses a cast from the past (D-36) and the replay casts in B-4 order.
- `npm test`: **380 tests, 44 files** (186 engine, 40 in `tests/meetings/`, the template's 154), locally and in CI under `TZ=America/Chicago`. `prisma migrate diff --from-migrations --to-schema --exit-code` in CI: the hand-written migration and `prisma/schema` agree.

The D-24 wording applies unchanged: these are the oracle's answers on the generator's own defects, now reproduced through a cast path, a close and a recount rather than one function call. The deployment caveat is D-33's: the privileges are proved for a role the tests assume with `SET LOCAL ROLE`; a deployment whose runtime connection logs in as a superuser proves nothing.

## Not generated, not measured

Write-in candidates, cumulative voting, proxies with instructions, revocation by a later proxy, a combined ballot for an owner of two units, malformed JSON ballots, time-zone boundary cases, a meeting that fails quorum, a resolution tie (GT-10 only), real bylaws text. The share in basis points can partially identify rare share values (151 bps = 4 penthouse units); stated, not solved.
