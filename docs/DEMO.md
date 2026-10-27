# Quorum — demo script

About 20 minutes. **Act 1** (terminal, 6 min) proves the tally on the 113-ballot fixture. **Act 2** (browser, 10 min) runs a live meeting from roster to sealed results. **Act 3** (browser, 4 min) covers dues, a violation and the archive rule. Every command below was run once on 2026-10-26 against a fresh database (Postgres 17.11, Node 26.3.1), and each "expect" line is the output from that run.

Everything is synthetic: a 120-unit condominium invented by `tools/build_fixtures.py --seed 20261025`. No real people and no real bylaws. Nothing here is a legal or election-certification claim.

## Before the audience arrives (once, ~5 min)

```bash
cd ~/Projects/quorum
npm ci && npx prisma generate     # npm 11 skips install scripts, so generate the client by hand
dropdb --force --if-exists quorum # only when re-running: start from an empty database
npm run db:setup                  # creates quorum + quorum_test, writes .env.local/.env.test if missing, migrates both
npm run seed:demo                 # template demo accounts; we use owner@acme.demo.test as the board
psql -d quorum -c "UPDATE \"User\" SET \"isDemo\" = false WHERE email = 'owner@acme.demo.test'; UPDATE \"Org\" SET name = 'Larkspur Commons (synthetic)' WHERE slug = 'acme';"
npm run dev                       # http://localhost:6200, in its own terminal
```

The `UPDATE` matters: closing a meeting asks for a fresh sign-in, and shared demo accounts are refused that step on purpose (the template's INV-26). So the board signs in as a real account.

Paste these two helpers into the presenting terminal. Mail is captured in the `CapturedMessage` table, not sent, so this is how you "check your email":

```bash
link() { psql -d quorum -Atc "SELECT substring(body from 'https?://[^ ]+/$2/[A-Za-z0-9_-]+') FROM \"CapturedMessage\" WHERE \"to\" = '$1' AND body LIKE '%/$2/%' ORDER BY \"createdAt\" DESC LIMIT 1"; }
totp() { node -e "const {TOTP,Secret}=require('otpauth');console.log(new TOTP({secret:Secret.fromBase32('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP')}).generate())"; }
```

| Who | Email | How they sign in |
|---|---|---|
| Board (owner role) | `owner@acme.demo.test` | `/login`, then `link owner@acme.demo.test login`, then the code from `totp`. The secret is `DEMO_TOTP_SECRET` in `scripts/seed-demo.ts`, and `seed:demo` prints it. |
| Homeowner O-001 | `gustavo.ingebrigtsen@example.com` (row 1 of `fixtures/owners.csv`) | `/login`, then `link gustavo.ingebrigtsen@example.com login`. No TOTP. |

`DEMO_MODE=1` is already in `.env.local` (line 5), so `/demo` also works for the other seeded accounts. It is not used here.

## Act 1 — the engine, in the terminal

**1. The full tally.** `npm run tally:eval`

Expect `ballots received 113 / counted 87 / rejected 26`, then the 15 reject codes with counts, `quorum ... units 87/120 MET ... direct only 51/120 NOT MET`, and five contests. It ends with `every row of expected_*.csv ... matches`.

Say: *"113 ballots, every one gets exactly one code from a closed list, and a rejected ballot is still counted in the published list. Quorum is met only because of proxies: 51 units voted directly and 36 more came by proxy. The board election (E1) is weighted by unit share, and it elects a different board than one-unit-one-vote would. The engine prints both. E2 is a tie for the last seat, and the machine leaves it open: `TIE_UNRESOLVED C-13, C-14`. No coin flip, no alphabetical order."*

**2. A voter checks their receipt.**

```bash
npm run tally:verify -- --receipt 019dc5278a69a43228a7a02d91d1faf9c3d9a50524a8145e04bf3a24181a8abf
```

Expect `IN THE ROOT — ballot B-8ff77e82e874, REJECTED PROXY_CHAIN`, then the D-2 sentence: it *does not hide how you voted from anyone you show this receipt and your nonce to*. Try a made-up receipt, `npm run tally:verify -- --receipt ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff`, and expect `NOT IN THE PUBLISHED LIST` with exit 1.

Say: *"Even a rejected ballot gets a receipt. This voter's proxy came through a chain, which isn't allowed, and they can see that."*

**3. Anyone can recount from the public list alone.**

```bash
npm run tally:recount -- --published fixtures/published_ballots.csv --meeting fixtures/meeting.json
```

Expect `45 recomputed values match the published ones, 0 differ, 1 not recomputable`. The one is the direct/proxy split, because the published list carries no proxy flag.

**4. Tamper with one vote.**

```bash
awk 'BEGIN{d=0} /,COUNTED,/ && !d && /""R1"":""YES""/ {sub(/""R1"":""YES""/,"\"\"R1\"\":\"\"NO\"\"");d=1} {print}' fixtures/published_ballots.csv > /tmp/tampered.csv
npm run tally:recount -- --published /tmp/tampered.csv --meeting fixtures/meeting.json
```

Expect exit 1, with `BAD R1 UNITS totals: ... NO 21, YES 55 | published ... NO 20, YES 56` and the weighted line below it.

Say: *"One YES flipped to NO in a file of 113 rows, and the recount names the contest and the totals that moved."*

**5. The database won't let the app read who voted (optional, ~1 min).**

```bash
npm run tally:eval:db     # the same 113 ballots through the real cast path into quorum_test, closed and sealed
psql -d quorum_test -c 'SET ROLE quorum_app; SELECT count(*) FROM "BallotSecret";'
psql -d quorum_test -c 'DELETE FROM "Ballot" WHERE "ballotId" = (SELECT "ballotId" FROM "Ballot" LIMIT 1);'
```

Expect `recount EQUALS the stored result` and 0 differences, then `ERROR: permission denied for table BallotSecret`, then `ERROR: Ballot is append-only (D-19)`. The DELETE is refused even for the superuser, because it is a trigger and not a permission.

## Act 2 — a live meeting, in the browser

Use two browser windows: a normal one for the board and a private one for the homeowner.

**6. Board signs in.** Open `localhost:6200/login`, enter `owner@acme.demo.test`, and click *Email me a link*. Run `link owner@acme.demo.test login`, open the link, click *Continue*, enter the code from `totp`, and click *Verify*. You land on `/onboarding`.

**7. Roster.** Go to `/o/acme/roster`. Fill each of the five textareas from its fixture: `pbcopy < fixtures/units.csv`, paste, then the same for `unit_shares.csv`, `owners.csv`, `ownerships.csv` and `assessments.csv`. Click *Import roster*. Expect `Imported: Unit 120, UnitShare 124, Owner 138, Ownership 141, LedgerEntry 2627.` Click *Import roster* again with the same files and expect `0 inserted, every column matches`, because the import is write-once.

**8. Meeting and proxies.** The fixture's voting window is 2026-11-01 to 11-14. To cast today, copy it with a window that is open now:

```bash
python3 -c "import json;m=json.load(open('fixtures/meeting.json'));m['meeting_id']='AM-DEMO';m['rules']['open_at']='2026-01-01T00:00:00';m['rules']['close_at']='2099-12-31T23:59:59';print(json.dumps(m,indent=2))" | pbcopy
```

On `/o/acme/meetings`, paste it into *meeting.json* and click *Create meeting*. Then `pbcopy < fixtures/proxies.csv`, paste it into the proxies box and click *Import proxies*. Expect `49 proxies recorded.` After a reload, the page shows *Delinquent (balance above zero, E-4/E-5): A-110, A-204, A-508, B-108, B-509*.

Say: *"The rules are data, in that JSON: thresholds, quorum basis, seats, voting mode. Changing the rules means changing data, not code."*

**9. The desk (paper ballot entered by staff).** Open *Desk*. Under *Direct ballot*, choose Owner O-002 and Unit A-102, mark R1 *NO*, and click *Cast ballot*. Expect *Ballot counted*, a 64-hex receipt, and the line *does not hide how you voted*.

**10. Invite the homeowner.** Go to `/o/acme/settings/members`, enter `gustavo.ingebrigtsen@example.com` and click *Send invite*.

**11. The homeowner votes** (private window). Sign in with `link gustavo.ingebrigtsen@example.com login`, then open `link gustavo.ingebrigtsen@example.com onboarding/invite` and click *Accept invite*. The home page says *linked to roster owner O-001*, because the invite matched the roster's email. Open the meeting's *Vote* page, tick C-01 and C-05, choose R1 *YES*, and click *Cast ballot*. **Copy the receipt and the nonce.** Reload the page and cast again: expect *Ballot received and rejected: DUPLICATE_UNIT*.

Say: *"One unit, one ballot. The second try isn't silently dropped. It gets its own receipt and its own code, and it will appear in the published list."*

**12. Board closes.** In the board window, on the meeting page, click *Close and seal the meeting*. Expect `Closed at ... and sealed. Meeting commitment ...`. If it asks you to sign in again, repeat step 6 (fresh sign-in, INV-26). Open *Results*: expect *Recount from the stored ballots: equals the stored result*, *Received 3, counted 2, rejected 1 (DUPLICATE_UNIT 1)*, and quorum NOT MET (2 of 120). Click the *published.csv* link to show the list everyone can download.

**13. The homeowner checks the receipt.** In the private window, open *Results* and paste the receipt and nonce, then click *Check*. Expect *IN THE ROOT ...: ballot B-..., COUNTED, choices {"E1":["C-01","C-05"],"R1":"YES"}*.

## Act 3 — the association's books

**14. Dues.** On `/o/acme/ledger?asOf=2026-11-14`, expect *Delinquent as of 2026-11-14: A-110, A-204, A-508, B-108, B-509.* Post Month `2026-12` with budget `35,001.00`. Expect `120 charges totalling $35000.24; ROUNDING $0.76; budget $35001.00.`

Say: *"Charges are split by share in whole cents, and the leftover 76 cents is posted as its own visible line instead of disappearing into someone's bill. The kickoff spec said 1 cent; working it by hand gave 76 (D-47)."*

**15. A violation.** On `/o/acme/violations`, choose Unit B-203, enter *What* `Unapproved balcony screen` and Notice date `2026-12-03`, and click *Open and queue the notice*. Expect `V-2026-001`. Record step *To* HEARING_SCHEDULED (Day `2026-12-04`, Hearing date `2026-12-10`), then **reload the page**, then *To* FINE_ASSESSED (Day `2026-12-10`, Fine `150.00`, Reason `screen not removed`). Expect *the fine of $150.00 is on the unit's ledger; 2 notice(s) queued, none sent.* Click *B-203*, set As of to `2026-12-10` and click *Show*: the `F-V-2026-001` line is there, and the balance is $468.50.

Say: *"The *To* list only offers the transitions the state machine allows from here. The machine is data too."*

**16. Nothing is sent, and nothing is deleted.**

```bash
psql -d quorum -c 'SELECT template, count(*) AS queued, count("sentAt") AS sent FROM "Outbox" GROUP BY 1'
```

Expect `notice | 6 | 0`. Then on `/o/acme/settings/danger`, type `acme` and click *Delete org*. Expect *This association has voting or ledger history, which is append-only and cannot be deleted. Archive it instead.*

## What to concede before you're asked

- **The receipt proves inclusion, not secrecy from coercion.** Anyone you show your receipt and nonce to can see how you voted (D-2). That makes it not receipt-free and not coercion-resistant. Every screen with a receipt says so.
- **The seal hides the voter link from the application, not from the database owner.** Whoever holds the owner role or the logs can still join ballot to unit (D-39, D-42).
- **The share on the published list partially identifies rare units** (D-37).
- **"0 differences" means agreement with a spec written by the same author**, measured on 113 synthetic ballots, 26 rejects and 16 deliberate traps (D-24). It is not an audit and not certification.
- **The live meeting in Act 2 has 3 ballots**, so its quorum fails. The 113-ballot story is Act 1.
- **Not built:** sending anything, collecting payments, runoffs after a tie (the board runs one by hand), proxy caps, write-ins, cumulative voting, real bylaws. See `docs/CLOSEOUT.md`.
- **A homeowner who opens a board page gets the error page with HTTP 500, not 403.** That comes from the template's `requireOrg`, which throws, and `src/core/**` is template-owned, so it is an upstream fix.
- **The violation form needs a reload between steps** before the next allowed transitions show (step 15).

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Prisma client missing on `npm run dev` or `db:setup` | npm 11 skipped `postinstall` | `npx prisma generate` |
| `link` prints an empty line | no mail captured yet, or the wrong kind | click *Email me a link* or *Send invite* first; the kind is `login` or `onboarding/invite` |
| MFA code refused | code rolled over (30 s), or the same 30 s step was used twice | run `totp` again and wait for a new code |
| Close asks for sign-in, or says demo accounts can't do it | session older than the fresh window, or the `UPDATE` in setup was skipped | sign in again (step 6); run the `UPDATE` |
| Casting says `EARLY` | meeting created from `fixtures/meeting.json` unedited | use the `python3 ... | pbcopy` copy from step 8 |
| *Create meeting* refuses `AM-DEMO` | already created in an earlier run | start over: `dropdb --force quorum && npm run db:setup && npm run seed:demo` + the `UPDATE` |
| *To* select missing FINE_ASSESSED | page not reloaded after the previous step | reload |
| Port 6200 busy | another dev server | `lsof -ti :6200 \| xargs kill` |
| `tally:eval:db` fails on connections | another project's test sweep is holding Postgres | `psql -c "SELECT datname, count(*) FROM pg_stat_activity GROUP BY datname"`; retry after it finishes |
