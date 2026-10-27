# Quorum design system

D-57 (2026-10-27). Builds on `docs/DESIGN_BRIEF.md` (the job, the people, the constraints), which stays the "why". This file is the "what": tokens, components, patterns, rules. The live reference is **`/o/<org>/design`**, drawn by the real stylesheet; the stylesheet is **`src/app/quorum.css`**, the components are **`src/components/ui.tsx`** and **`pill.tsx`**.

## Principles

1. **A claim travels with its limit.** A result is shown with the rule it passed under, and a receipt with what it does not prove. The scope note is the most visible text on the page.
2. **An outcome is a word first, then a symbol, then a colour.** Colour is never the only signal.
3. **The machine stopping is not failure.** A tie is its own family (`hold`), not `risk`.
4. **Integers and fixed strings.** Basis points, cents and the stored timestamp strings are shown as they are stored: no decimals the data did not have, no relative time.
5. **Semantic HTML carries the design.** Element styles come first, so a template-owned page with zero classes still looks right. Classes exist for a handful of components only.
6. **One stylesheet, no dependency.** No UI library, no icon font, no web font, no image.

## Tokens

Three layers in one file. Nothing in the component layer uses a raw value.

**Primitives** (`--n-*` neutral, `--a-*` accent, `--t-*` type, `--s-*` space, `--r-*` radius). Neutral is warm paper to ink (hue 30-80); the accent is oxblood, `--a-700` on paper and `--a-300` on dark. The palette is the *Quorum in Brief* exec brief's, so product and write-up read as one thing.

**Semantic** (what a token is for). Dark mode remaps this layer only.

| Token | Role | Light | Dark |
|---|---|---|---|
| `--bg` | page | paper | near-black |
| `--sf` | card, input, nav | white-ish | raised dark |
| `--sf-2` | quiet well: row hover, receipt | `--n-100` | slightly lighter |
| `--ink` / `--mu` | text / secondary text | 14.8:1 / 6.4:1 on `--sf-2` | 15.1:1 / 7.0:1 |
| `--ln` / `--ln-strong` | rules, card borders / form control borders (3:1) | | |
| `--ac` / `--acf` | links, primary action, current item, focus ring / text on it | | |

**Status families**: `good` (passed, met, recount equals, good standing), `risk` (failed, not met, delinquent, a fine), `hold` (a tie: a person decides), `info` (open, a role), `done` (closed, archived). Each is a hue (`--h`) plus mode-specific lightness (`--k-bg-l`, `--k-fg-l`, `--k-dot-l`), exposed as `--k-bg`, `--k-fg`, `--k-dot` on any element with `data-k`. `[role=alert]` is `risk`, `[role=status]` is `good`. Adding a family means a hue and a glyph, and a row in the table at `/design`.

**Type**: system stacks only (works offline, nothing downloaded). Serif for headings, sans for body and controls, mono for hashes. Scale `--t-xs..2xl` = 13 / 15 / 17 / 20 / 24 / 30 / 40 px. Headings have `text-wrap: balance`; figures use `font-variant-numeric: tabular-nums`.

**Space**: a 4px grid, `--s-1..12`. **Radius**: 8 (controls), 12 (cards), pill. **Elevation**: one shadow (`--sh-1`), cards only. **Motion**: one duration (`--dur`, 120 ms) on button hover; `prefers-reduced-motion` removes it.

**Breakpoints**: mobile first. Two: 640px (page padding, title size) and 880px (association name joins the nav row). The container is 64rem.

## Components

| Component | Where | Rule |
|---|---|---|
| `PageHeader` | every page, once | eyebrow (where you are), `<h1>`, status pills, lead, and the page's actions. The only `<h1>`. |
| `Section` | any card with a heading | `<section aria-labelledby>` with an `<h2>`; an optional aside on the right. |
| `Stat` / `Stats` | figures | a label, a figure, what it is judged against. `k` colours the left edge and is always backed by text. |
| `Pill` | status | glyph + word. `resultKind(word)` and `violationKind(state)` choose the family so no page picks colours. |
| `Notice` | block messages | a family, a title with its glyph, one or two sentences. Not for action results (those are `[role]`). |
| `EmptyState` | nothing yet | one sentence and the next step. |
| `LinkButton` | navigation that looks like an action | `secondary` or `ghost`; the primary action is a `<button>`. |
| `MeetingTabs` | meeting pages | Overview, Vote, Desk (board), Results; marks itself current. |
| Org nav | `src/app/o/[org]/layout.tsx` | wordmark, association, six areas, `aria-current`. Wraps at 360px; every target is 44px. |
| Scope note, receipt limit | `src/components/honesty.tsx` | text is verbatim and owned by CLAUDE.md non-negotiable 10 and D-2; the system only styles it. |

Element styles with no class: `main`, `h1-h4`, `section` (as a card), `form`, `label`, `input`, `select`, `textarea`, `button`, `table`, `details`, `code`, `dl`. A table scrolls inside its own box, never the page.

## Patterns

- **A page**: `PageHeader`, then (meeting pages) `MeetingTabs`, then the scope note where numbers appear, then stats, then sections. Board-only sections are absent for members, never disabled.
- **An outcome**: a pill in the sentence that states it ("PASSED under MAJORITY_OF_VOTES_CAST"), and the rule beside it. A tie says who tied and that the board decides.
- **A form**: labels above controls, one primary button, errors from `ActionForm` inline above the fieldset (`▲`), notices below it (`●`).
- **A destructive or permanent step** (close, archive): a `hold` notice first that says it is permanent, then the button.
- **A receipt**: monospace, wrapping, in the sunk well, with the D-2 sentence directly under it.

## Accessibility, measured

- **Contrast**: `python3 -I tools/contrast.py` parses the stylesheet and checks 40 token pairs in both schemes (text 4.5:1, control borders and status edges 3:1). It exits 1 on any pair under its floor. Result at D-57: all 40 pass.
- **axe**: the e2e sweep runs axe in light and dark on every page state, including `/design` (now 18 states x 2 schemes); 0 violations is the gate.
- **Focus** is a 3px `--ac` ring, never removed. **Targets** are 44px. **No horizontal page scroll** at 360 or 1280.
- **No colour-only meaning**: pills, notices and stat edges all carry a glyph or a word.

## What this system is not

Not a brand (one wordmark: a dot and a serif), not a component library for other products, not themeable per association, no charts, no print stylesheet for minutes, no animation. It was designed after the build and tested on 20 pages; it has had no usability test with a real board or homeowner.

## Changing it

1. Change the token or component here and in `quorum.css` together; `/design` shows the result.
2. Run `python3 -I tools/contrast.py` and the e2e sweep (axe).
3. Add a row to `docs/decisions.md` if a rule above changes.
