# Quorum — closeout (DRAFT, written at the Phase 3 gate, 2026-10-26)

The PRD names three phases and no Phase 4, so this closes the build. Branch `kickoff`, PR #1 against `main`, **not merged** (D-6). Everything below is measured on synthetic fixtures by the same author who wrote the spec (D-24): an upper bound on agreement with the spec, not a claim about any real association.

## What shipped

| Phase | What | Proof |
|---|---|---|
| 1 | `src/tally/`: the pure tally engine — 15 reject codes in precedence, selections, quorum in both modes and direct-only, six resolution bases, plurality with ties left unbroken, receipts, Merkle root, commitments | GT-01..GT-21, GQ-01..GQ-12; `tally:eval` 113 / 87 / 26, 0 differences against the Python oracle; 20 shuffles, one commitment; `tally:lint` |
| 2 | Tables, triggers, the sealed link: the cast path through one `SECURITY DEFINER` function, append-only history, close-and-seal (`REVOKE SELECT` on `BallotSecret`), the recount from `Ballot` rows | `tally:eval:db` 0 differences; published export byte-equal; tamper tests on SQLSTATE; `migrate diff` empty in CI |
| Decisions pass | D-37 `bps_as_of` published (full recount from the list), D-38 table-wide REVOKE kept, D-39 OwnerLink + desk, D-40 random ballot ids, D-41 `CREDIT`, D-42 `quorum_web` login, D-43 archive-not-delete | fixtures regenerated, totals unchanged; `tally:recount` 45 / 0 / 1; `roles.test.ts` logs in as `quorum_web`; delete-org refused with the D-43 message |
| 3 | Screens (meetings, vote, desk, results, roster, ledger, violations, archive), dues ledger with the ROUNDING line, violation state machine, outbox notices never sent | 458 vitest tests; INV-01..04/22 harness over 20 new actions; 15/15 e2e; axe 0 violations, light and dark |
| Follow-ups (PR #2) | D-56 desk page 404 for a non-board member; D-57 proxy revocation (grantor's screen and the desk's, append-only `ProxyRevocation`); D-58 special-assessment declaration and posting as one dues run | 488 vitest tests (+30); harness over 4 more actions; 15/15 e2e; axe 0 violations on 20 page states × light/dark; `tally:eval` and `tally:eval:db` still 0 differences; CI green on 7f98606 |

Root `5214cb0fbe352a425743c6fd6774e3d4a13c63876a4f75157d8de8ea2ac35f5d`, meeting commitment `3e6f583ccb0a793735a01944e1a9deaf3289f431e0060e2dfaa11c79bb9337e9` (fixture seed 20261025). Full numbers: `docs/EVAL.md`.

## What it does not do (out of scope, stated)

Coercion resistance and receipt-freeness (a voter who shows receipt and nonce proves their vote, D-2); real bylaws (O-9); certified election compliance; sending anything (D-44); payment collection, liens; cumulative voting (O-4), write-ins, nominations; proxy caps (O-2), delinquency grace (O-3); runoff contests from a tie (O-5 — the board runs one by hand); an org-level time-zone setting (D-51). A special assessment is declared before the first ballot and cannot be declared later (D-58); a revocation does not unlabel a ballot already cast with the proxy (P-5, D-57). The share in basis points on the published list partially identifies rare units (D-37). The seal hides the voter link from the application, not from whoever holds the owner role or the logs (D-39, D-42).

## By hand (Shane)

Done on the Mac, 2026-10-26: port moved to 6200 and the port-table row added (D-54); `reuse-scan.py` re-run (D-55, closes D-27 a); stale pre-D-26 counts fixed in the PRD, `docs/portfolio-overlap.md` and D-15; `docs/DEMO.md` written, with every command run once against a fresh database.

1. Review PR #2 (`followups` → `kickoff`, D-56..D-58) and PR #1; decide whether to merge.
2. `git push origin v1.3.0` (fetch the tag from the `template` remote first; it is not in this clone) so the tag shim in `ci.yml` can go; delete the throwaway branch `ci-proof-1-14` on origin.
3. Add the quorum row (6200) to `saas-foundation/CLONES.md`: the local checkout has none (D-54).
4. When a database beyond the laptop exists: `npm run db:roles` and point the runtime `DATABASE_URL` at `quorum_web` (`docs/deploy-roles.md`); nothing is deployed.
5. Build-log card #21. Optional: delete the one `migrate diff` PR comment from Phase 2.
6. Reverse any of D-44..D-53 (session defaults) if they are not what you want; and two follow-up defaults (D-57, D-58): a non-grantor revoking a proxy of the meeting gets a refusal naming who may (not a 404), and an assessment is declared before the first ballot.
7. Upstream to saas-foundation: `requireOrg` throws, so a member on an owner-only page gets HTTP 500, not 403 (found in the demo walk; `src/core/**` is template-owned). The desk page is fixed clone-side by D-56 (404); `settings/danger` and `settings/archive` still 500 for an admin/member, by the template's guard.

## Still to do for closure (house definition of done)

- [x] `docs/DEMO.md`
- [ ] Exec brief, *Quorum in Brief* (`exec-brief` skill)
- [ ] LinkedIn drafts in the Ledger (mine D-47's 76-cents-not-1, the D-40 id-space test, D-26)
- [ ] Cost review: expected near zero (not deployed, no cron, no LLM), but record it with `keep / off` lines
