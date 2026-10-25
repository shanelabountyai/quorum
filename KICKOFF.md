# Kickoff — Quorum (Build Log #21, HOA / Co-op Governance)

Cloud-session variant. Paste the block below into a Claude Code cloud session on Fable (`/model claude-fable-5-1`) with the `shanelabountyai/saas-foundation` and the new, empty, **public** `shanelabountyai/quorum` repos attached. The kit lives in this directory; nothing has been cloned, installed or committed yet. There is no `~/Projects` and no `reuse-scan.py` in the cloud.

```
Quorum — HOA / co-op governance with a verifiable tally (Build Log #21, main track).
The kickoff kit is in the quorum-kickoff directory attached to this session. Nothing exists
yet besides the kit and an empty public repo shanelabountyai/quorum.

Read, in order, from the kit: CLAUDE.md, prd-quorum.md, docs/decisions.md (authoritative),
docs/domain-brief.md, docs/portfolio-overlap.md, docs/phase-1-tasks.md.

Steps, in order:
1. Port check. Port 6200 is proposed (D-4). You cannot read ~/.claude/CLAUDE.md from here;
   check saas-foundation/CLONES.md for a clash (6100 is gavel). If 6200 appears there, stop
   and tell me. Otherwise continue and record "6200 proposed; port-table row is Shane's"
   in docs/decisions.md D-4 and in NEXT.md.
2. Clone the template with shared history (NOT the GitHub template button):
     git clone <saas-foundation url> quorum && cd quorum
     git remote rename origin template
     git checkout -B main v1.3.0
     npm ci
     npm run new-project -- quorum 6200
   Do not run new-project twice. Copy the kit in: CLAUDE.md, KICKOFF.md, NEXT.md,
   prd-quorum.md, docs/*.md, tools/*.py, fixtures/samples/, .claude/settings.json (merge the
   model pin; keep anything the template put there). Add the scope-honesty banner from the
   PRD to README.md verbatim.
3. Put ?connection_limit=10&pool_timeout=20 on the local DATABASE_URLs in the env examples
   and db-setup output. Confirm vercel.json has the house ignoreCommand. Confirm the CI
   workflow sets TZ=America/Chicago. Remove or unwire billing and share links per D-5
   (use foundation:check-modules' path list if there is no switch) and record what you did.
4. npm run foundation:drift must pass before any Quorum code exists. Try npm run db:setup and
   npm test; if Prisma engines or Playwright browsers cannot be downloaded in this sandbox,
   record exactly which command failed and why in NEXT.md and continue — CI decides (D-6).
5. Oracle check, all with python3 -I:
     tools/golden_answers.py                         -> ends with OK
     tools/build_fixtures.py --seed 20261025         -> writes fixtures/
     tools/reference_tally.py --write-expected --shuffle 5
     tools/verify_fixtures.py                        -> ends with OK
   Compare every sha256 with docs/domain-brief.md §12 and fixtures/samples/MANIFEST.json,
   and the printed table with fixtures/samples/reference_output.txt. Report any mismatch;
   do not fix either side.
6. Reuse scan: skipped (not reachable from the cloud). Record that in docs/decisions.md
   with the sentence from CLAUDE.md §Session 0.
7. Read every doc. List anything that contradicts itself or can't be built as written, and
   anything in docs/portfolio-overlap.md whose donor path you could not find when you read
   the donor repos you have access to. Don't resolve these yourself.
8. Commit on branch `kickoff`, naming files explicitly (never git add -A), in three commits:
   (a) the new-project rewrite (package.json, playwright.config.ts, CI workflow, README.md,
       vercel.json) plus the D-5 module removal;
   (b) the kickoff docs and tools (CLAUDE.md, KICKOFF.md, NEXT.md, prd-quorum.md, docs/*.md,
       tools/*.py, fixtures/samples/, .claude/settings.json);
   (c) the generated fixtures (fixtures/*.csv, fixtures/meeting.json, fixtures/MANIFEST.json)
       — show me the hash table first.
   Push `kickoff` to origin (shanelabountyai/quorum) and open a PR against main. Do not
   merge. Then open a separate PR on saas-foundation adding the CLONES.md row:
   quorum | shanelabountyai/quorum (public) | v1.3.0 | 2026-10-25; HOA / co-op governance,
   verifiable tally (hashed receipts, Merkle commitment, sealed voter link), port 6200;
   synthetic only; not deployed; tools/ (Python stdlib oracles), fixtures/ are clone-owned.
   Show me both PR links.
9. Plan first: write the Phase 1 plan as the order you will do tasks 1.1 to 1.14 in, which
   donor you will read for each port in 1.3, and which commands you expect to be CI-only.
   Stop and show me the plan, the step 5 output, the contradictions list and the step 4
   record before writing any product code.

Stop there. Do not create Prisma models, migrations, UI or engine code before I have
reviewed the plan. Update NEXT.md before you stop.

Rules from the first commit: the engine under src/tally/ imports no database, clock,
randomness, network or model client and is order-independent; one unit, one ballot, first
valid cast wins; ties are never broken by the machine; thresholds are data; fixtures are
never generated or read by product code; shares are basis points and money is integer
cents; timestamps are strings; never edit an expected value to pass a test; never edit
template-owned paths (src/core/**, tests/invariants/**, core migrations); no new
dependencies without asking; never "secure" or "accurate" without the number and the D-2
limits; branch + PR, never merge.
```

## Still to do by hand

- Create the empty public repo `shanelabountyai/quorum` before the session and attach both repos. Before the first push the session runs `git ls-files | grep -iE "\.env|secret|credential|\.pem$|\.key$"` (only `.env.example` may appear) and confirms `.gitignore` covers `.env` and `.env*.local`; check it did.
- `~/.claude/CLAUDE.md`: add the port-table row (quorum → 6200) on the Mac; the cloud session cannot.
- Review and merge the two PRs (quorum `kickoff`; saas-foundation CLONES row).
- Build-log card #21: name **Quorum**, PRD and repo links, status `in progress`, chips per `docs/portfolio-overlap.md` "Suggested card chips".
- Neon and Vercel only if this is ever deployed (not planned; synthetic data).
- Decide O-1..O-9 when they come up; defaults are in force.
- Re-run `reuse-scan.py` against `docs/phase-1-tasks.md` the next time the repo is open on the Mac and record the result.
