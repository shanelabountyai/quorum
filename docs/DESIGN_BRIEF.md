# Quorum: design brief

Decided 2026-10-27 (D-56). **The tokens, components and rules are now in `docs/DESIGN_SYSTEM.md` (D-57); this file stays the "why".** Applied in `src/app/quorum.css`, `src/components/pill.tsx`, the org nav and the pages listed under *Where it is applied*. Written after the build, so it describes what was applied, not a mock-up that was never made.

## The product in one paragraph

Quorum runs the governance of a 120-unit condominium association: elections with weighted votes and proxies, resolution thresholds, a secret ballot with a verifiable tally, a dues ledger and a violation workflow. Everything is synthetic and nothing is sent. Two kinds of person use it: a **board member or manager** (owner/admin role) who sets up a meeting, closes it and reads the results, and a **homeowner** (member) who votes, checks a receipt and sees their own balance.

## The design has one job: make the claim and its limit legible together

A result page is only trustworthy if the reader can see **what was decided, under which rule, and what the number does not prove**. So:

- **An outcome is always a word first and a colour second.** `PASSED`, `FAILED`, `TIE_UNRESOLVED`, `MET`, `NOT MET`, `delinquent` render as a pill with a glyph (✓ ✕ ◆) and the word. Colour is never the only signal.
- **A tie is not a failure.** `TIE_UNRESOLVED` gets its own amber family, not red: the machine stopped on purpose and a person decides.
- **The scope note and the receipt limit are the most visible text on the page,** not the smallest. They sit in a bordered, tinted block with the accent edge (CLAUDE.md non-negotiable 10 and the D-2 sentence stay verbatim; the design only changes how they look).
- **Numbers are tabular, hashes are monospace and wrap.** Integers only (basis points, cents): no decimals that were not in the data.
- **Dates and times are shown as the fixed-width strings the system stores** (`2026-11-14T19:30:00`). No relative time, no timezone conversion (non-negotiable 7).

## Who sees what first

| Person | Lands on | Needs first |
|---|---|---|
| Board / manager | `/o/[org]` home, then meetings | Which meeting is open, whether quorum is met, the Close action, then the results |
| Homeowner | `/o/[org]` home | Which meeting is open, a Vote link, then their receipt |
| Anyone checking a result | results page, `published.csv` | The recount line ("equals the stored result"), the root, the receipt check |

## Tokens

Same palette as the *Quorum in Brief* exec brief, so the product and the write-up read as one thing: minute-book paper, warm ink, one oxblood accent. Defined once on `:root`, redefined for `prefers-color-scheme: dark`, nothing else in the file hard-codes a colour.

| Token | Light | Use |
|---|---|---|
| `--bg` / `--sf` | paper `oklch(0.972 0.006 80)` / surface `oklch(0.995 0.003 80)` | page / cards |
| `--ink` / `--mu` | `oklch(0.25 0.02 30)` / `oklch(0.45 0.02 30)` | text / secondary (AA on both surfaces) |
| `--ln` | `oklch(0.84 0.014 70)` | rules and borders |
| `--ac` | oxblood `oklch(0.44 0.13 25)` | links, primary button, current nav item, focus ring |
| status families | `good` green · `risk` red · `hold` amber (ties, needs a person) · `info` slate (open/neutral) · `done` grey (closed, archived) | pills, alerts. Each has `-bg`, `-fg`, `-dot` |

Type: system stacks only, so the demo works offline and nothing is downloaded. Headings `ui-serif, Georgia, "Times New Roman", serif`; body `system-ui`; hashes `ui-monospace`. Scale 15/17/22/30 on a 4px grid. Radius 8px controls, 12px cards. One shadow.

## Components (all driven by semantic HTML first)

The design holds with **zero classes**: element styles for `main`, headings, `section`, `form`, `label`, `input`, `button`, `table`, `details`, `code`. Classes exist for a few things only:

1. **Org navigation** (`.org-nav`): wordmark, then Home · Meetings · Roster · Ledger · Violations · Members, with `aria-current="page"` underlined in the accent. At 360px it wraps; every link is 44px tall.
2. **Scope note** (`.scope`): the banner, as above.
3. **Pill** (`<Pill k="good|risk|hold|info|done">`): glyph + word, used for results, quorum, standing, meeting and violation status.
4. **Cards**: each `main > section` is a card; `h2` outside a section stays plain.
5. **Tables**: tabular figures, sticky nothing, scroll sideways inside their own box on a phone, never the page. Numeric columns right-aligned (`.num`).
6. **Receipt block**: the receipt, nonce and `IN THE ROOT` / `NOT IN THE PUBLISHED LIST` outcome after a check; monospace, wrapping, with the outcome as a pill.
7. **Alerts**: `[role=alert]` red with ▲, `[role=status]` green with ●, never colour alone.
8. **Archived banner** (`.archived`): dashed border, `done` family.

## States designed on purpose

- Meeting: open · closed and sealed · archived org.
- Result per contest: PASSED / FAILED / ELECTED / TIE_UNRESOLVED; quorum MET / NOT MET (three readings shown); recount equals / DIFFERS.
- Ledger standing: good standing / delinquent.
- Empty states: no meetings, no roster, no ballots, no violations: one sentence, a link to the next step.
- Errors from actions: `ActionForm` renders them inline; the design styles them. The 500 for a member on an owner-only page is upstream (CLOSEOUT item 7) and is not designed around.

## Hard constraints

- **One stylesheet, no UI library, no new dependency** (the ask-before-add list covers charting; there are no charts).
- **Template-owned pages cannot be edited** (`src/core/**`, login, onboarding, account security, org settings). They must look right through global element styles alone.
- **Light and dark**, both measured by axe: 17 page states × 2 schemes, 0 violations is the gate (`npm run test:e2e`).
- **Mobile first**: 360px wide, no horizontal page scroll. 44px touch targets, visible 3px focus ring.
- **No images, no icon font, no web font.** Glyphs are Unicode.
- **No colour-coding that is not also text.**

## Out of scope

Branding beyond the wordmark, illustration, animation, a marketing home page, charts, a print stylesheet for minutes, per-association theming, and redesigning the template's own pages.

## Where it is applied

`src/app/quorum.css` (tokens and element styles), `src/components/pill.tsx` (new), `src/components/honesty.tsx` (class hooks only, text unchanged), `src/app/o/[org]/layout.tsx` (org nav with current-page marking, via `src/app/nav-link.tsx`, ported from boxloop), results, ledger, meetings, violations and the home pages (pills, empty states). Gate: `lint`, `typecheck`, `foundation:drift`, `test:e2e` with axe in both schemes, and a screenshot pass at 360px and 1280px in both themes.
