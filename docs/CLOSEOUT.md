# Quorum — closeout (DRAFT, written at the Phase 3 gate, 2026-10-26)

The PRD names three phases and no Phase 4, so this closes the build. Branch `kickoff`, PR #1 against `main`, **not merged** (D-6). Everything below is measured on synthetic fixtures by the same author who wrote the spec (D-24): an upper bound on agreement with the spec, not a claim about any real association.

## What shipped

| Phase | What | Proof |
|---|---|---|
| 1 | `src/tally/`: the pure tally engine — 15 reject codes in precedence, selections, quorum in both modes and direct-only, six resolution bases, plurality with ties left unbroken, receipts, Merkle root, commitments | GT-01..GT-21, GQ-01..GQ-12; `tally:eval` 113 / 87 / 26, 0 differences against the Python oracle; 20 shuffles, one commitment; `tally:lint` |
| 2 | Tables, triggers, the sealed link: the cast path through one `SECURITY DEFINER` function, append-only history, close-and-seal (`REVOKE SELECT` on `BallotSecret`), the recount from `Ballot` rows | `tally:eval:db` 0 differences; published export byte-equal; tamper tests on SQLSTATE; `migrate diff` empty in CI |
| Decisions pass | D-37 `bps_as_of` published (full recount from the list), D-38 table-wide REVOKE kept, D-39 OwnerLink + desk, D-40 random ballot ids, D-41 `CREDIT`, D-42 `quorum_web` login, D-43 archive-not-delete | fixtures regenerated, totals unchanged; `tally:recount` 45 / 0 / 1; `roles.test.ts` logs in as `quorum_web`; delete-org refused with the D-43 message |
| 3 | Screens (meetings, vote, desk, results, roster, ledger, violations, archive), dues ledger with the ROUNDING line, violation state machine, outbox notices never sent | 458 vitest tests; INV-01..04/22 harness over 20 new actions; 15/15 e2e; axe 0 violations, light and dark |

Root `5214cb0fbe352a425743c6fd6774e3d4a13c63876a4f75157d8de8ea2ac35f5d`, meeting commitment `3e6f583ccb0a793735a01944e1a9deaf3289f431e0060e2dfaa11c79bb9337e9` (fixture seed 20261025). Full numbers: `docs/EVAL.md`.

## What it does not do (out of scope, stated)

Coercion resistance and receipt-freeness (a voter who shows receipt and nonce proves their vote, D-2); real bylaws (O-9); certified election compliance; sending anything (D-44); payment collection, liens; cumulative voting (O-4), write-ins, nominations; proxy caps (O-2), delinquency grace (O-3); runoff contests from a tie (O-5 — the board runs one by hand); a proxy revoked after loading (`ProxyRevocation`, seam, D-49); a PASSED special assessment posting per unit (seam, D-47); an org-level time-zone setting (D-51). The share in basis points on the published list partially identifies rare units (D-37). The seal hides the voter link from the application, not from whoever holds the owner role or the logs (D-39, D-42).

## By hand (Shane)

1. Review PR #1; decide whether to merge.
2. `git push origin v1.3.0` from the Mac so the tag shim in `ci.yml` can go; delete the throwaway branch `ci-proof-1-14`.
3. Add the port-table row (quorum → 7200) in `~/.claude/CLAUDE.md`; re-run `reuse-scan.py` (D-27 a).
4. When a database beyond the laptop exists: `npm run db:roles` and point the runtime `DATABASE_URL` at `quorum_web` (`docs/deploy-roles.md`); nothing is deployed.
5. Fix the stale pre-D-26 numbers in `docs/portfolio-overlap.md` and D-15 (49 direct / 85 with proxies → 51 / 87).
6. Build-log card #21. Optional: delete the one `migrate diff` PR comment from Phase 2.
7. Reverse any of D-44..D-53 (session defaults) if they are not what you want.
