# 04 · Screens: what each one must do, show first, and feel

Format per screen: **Intent** (the one sentence the critic quotes), **First paint at 390 × 844**
(what must be inside the fold), **Order** (content, top to bottom), **States**, **Interactions**
(details in `05`), **Copy** (details in `06`). Desktop at 1280 uses the same order in a 640-720 px
reading column; data screens widen to 1100 px; Home uses two columns from 1024 px (brief left,
the day's actions right). Six states per screen are screenshotted in the five critic projects
before a screen is called done (`07`). Testids and data attributes already used by `apps/web/e2e`
are a contract: never renamed; copy assertions move to data attributes (`data-answered`,
`data-tier`, `data-default`) in the same PR that changes the copy.

## Shared components (so "same look" can be diffed)

Top bar (wordmark, company switcher, the stop control; at 390 the section nav is a row of
`meta` words under the bar, no icons, no hamburger). The control (flat, 2 px radius, ink outline;
primary = ink fill, paper text). The row (a hairline below, `small` text, numbers tabular and
right-aligned). The card (see below). The receipt row. The state word (a `meta` word, no dot:
"Thinking", "Waiting for you", "Executing", "Done", "Idle"; "Waiting for you" is the only one in
600 weight). The closure line. The sheet. The focus ring. Number format: `$1,240`, `$0.41`,
`09:12`, `Thu 18:00`, `17 Oct`.

## Landing `/`

**Intent:** "My staff already did the work; I only decide." Convert a technical builder in 60 s.

**First paint:** H1 (≤ 12 words, contains a North noun), the gate sentence, one CTA ("Start a
company"), and the top edge of the product itself: a real morning brief from the founder's own
demo company with one pending card under it, rendered with the app's components in the user's
colour scheme. No terminal strip, ticker, cursor, dark hero by default, or illustration. The
hero is the product, because the product is text and the text is the proof.

**Order:** 1 hero as above. The demo card is the one CSS-3D device: it tips flat as it enters,
and it is answerable: tapping an option plays the receipt interaction and the row reads "Demo
company · nothing is sent · see the real ledger", linking to the founder company's public page.
It never shows a ledger row, a metric delta or a count that was not measured. 2 "What happens in
30 days" as five rows (day 1, 7, 15, 21, 30), each a claim ≤ 12 words with one real screenshot.
3 The gate: one short paragraph and a four-row table (runs automatically / tells you after /
needs your decision / only you can do this). 4 Proof block: a real ledger excerpt with costs;
"your website's code lives in your own GitHub account"; "money moves only from your own
accounts"; "practice mode by default: nothing real is sent or spent until you switch a
connection to live"; "export everything". 5 "What North does not do" (≥ 5 items). 6 Pricing:
three plans as sentences, no table. 7 Closing line "Be the CEO of your life. Let the staff be
software." and the CTA again. Footer: legal, export, the stop control shown with its promise.

**States:** static; reduced motion shows the demo card already answered. **Interactions:**
`<a>` to `/login` with a cross-document view transition. **Copy:** `06` §3.

## Login `/login`

**Intent:** Don't make me think. **First paint:** "Sign in", Google button, email field,
"Continue with email", the legal line. **States:** sent (the inbox line replaces the form),
error (what failed, what to do), returning user (email remembered via `autocomplete`).
**Copy:** "No password. A sign-in link goes to your email."

## New company `/new` and Onboarding `/c/[slug]/onboarding`

**Intent:** Hand the company over in under ten minutes and feel understood.

**First paint (`/new`):** "What are you building?" and the thesis box with a two-line example
inside it; name, target customer and why-now folded under "More" until the thesis has 40
characters. **The wizard (ONB-1/2/3, five steps, the count shown and never changing):**
questions (≤ 5, each with one line on why it is asked) → goal (a default proposed from the
thesis, editable) → budget (categories with a hard cap; the cap is required and may be $0;
"nothing is spent until a card says so") → connect tools (GitHub, Vercel, Gmail, ad account;
each "Connect" or "Skip": a card asks when a task needs one) → summary (reads back thesis, goal,
cap and connections in ≤ 120 words; one button "Approve and start"). A team step with
per-department personas is a proposal from `docs/research/startup-playbook-and-journey.md`,
not in SPEC; if it ships, it grants no standing rule: rules exist only after three identical
answers and an explicit accept (DEC-3), and its only dial is "Review drafts" (default) or
"Advance drafts without review", which touches artifacts, never actions.

**States:** saving (the button says "Saving…" in place), error inline under the field, resume
(returning lands on the current step with earlier answers kept). **Interactions:** steps slide
`--dur-slow` on first visit, cut when navigating back. After approve, Home reads "Agents are
starting. First results within 24 hours; the brief arrives at 07:00." **Copy:** plain words; the
summary is the designed peak and must read better than the user wrote it.

## Home `/c/[slug]` (the morning)

**Intent:** What needs me today, in five minutes, then done.

**First paint:** top bar (company switcher, the stop control); "Thursday 17 October" and the
brief's headline sentence as the page's largest text ("2 sign-ups yesterday. $14 spent. 1 card
waiting."), each number linking to its source; the first pending card in full with its options
inside the fold; or, with no cards, the closure line "Nothing else needs you today" set calmly
in body size. Nothing else above the fold.

**Order:** 1 header as above. 2 **Today's actions**: one list keyed by card id, in creation
order: pending cards (up to the quota, 1-5) and the receipt rows they become, plus the
"tells you after" actions since the brief (what · to whom · cost), each linking to its action
row. 3 The brief, collapsed to its headline plus "Read the brief · 60 s"; expanded, sections in
the fixed order with hairlines between them; empty sections omitted, never printed as
"Nothing." 4 Goal: metric name, current versus target, a thin bar, due date; "no measurement
yet" when empty. 5 This week: summary paragraph and task rows. 6 Team line: one row per active
role ("Research: reading 12 competitors, step 3 of 7"), linking to Team. 7 Artifacts strip.
8 Website line when a preview or live URL exists. 9 "Chief of Staff": one entry at the end that
opens the scoped chat sheet for "new goal", "research this", "change goal or budget"; it never
contains approve or spend buttons.

**States:** before onboarding (one invitation "Five short steps; the agents start when you
approve"), stopped (the banner under the bar; cards disabled with the reason), paused by
billing, offline ("Offline · brief from 07:00"), loading (cold load only: the header paints
first, the rest streams), long (rows virtualised). The install prompt appears here on the second
visit for users who never see `/companies`. **Interactions:** the receipt (`05`); brief reveal
on first open of the day; live refresh updates rows in place without motion. Keyboard: 1/2/3
select the focused card's option, Enter commits (money: the relabel-then-Enter rule in `05`).

## Decision card (inline and `/c/[slug]/decisions/[id]`)

**Intent:** Answer in under ten seconds with confidence, knowing what happens if I don't.

**Layout, top to bottom:** a `meta` line (tier in plain words with the code as a small word
beside, cost, due); the question as `title` inline and `display` on the detail page (≤ 15
words, verb first); "Why", two lines with "Show reasoning" for the rest; facts as a small
two-column table (never a mono paragraph, never a raw URL: the domain as a link); options as
outcome-labelled controls, the recommended one the only ink-filled control, labelled
"Recommended", ≥ 44 px, inside the fold; directly under them the default line "If you don't
answer by Thu 18:00, nothing is sent"; evidence links last. The detail page adds the full
signal, artifact or campaign and an "At a glance" table only for what the card did not show.

**States:** waiting, chosen (check + "Chosen"), sending with Undo (5 s, one-tap cards only),
withdrawn, sent or executed (action link; later the ledger entry when a metric moved), failed
(what failed, nothing happened, what next), stopped (options disabled, reason), deferred (quota
spent; "comes back tomorrow"). **Interactions:** `05` signature; "Make a rule" after the third
identical answer, after the answer, with a cap, on money cards too. **Copy:** `06` §4.

## Team `/c/[slug]/team`

**Intent:** My staff is working, and I can see what, how far and at what cost.

**First paint:** role rows, not a grid of boxes: name, plain role label, state word, current
task, step n of m, last evidence link, a per-role Stop. Cost per task is not shown here (it is
included in the plan; model cost lives in Settings › Usage). **Order:** roles with activity
first; idle roles compact. Then the 24-hour stream as rows with the tier in plain words and the
card or rule that authorised each decision-tier action. Leads upload lives under Sales, folded.
**States:** no roles yet (what will appear and when), stopped (rows frozen, a needle hairline
through the running ones), quiet day ("No actions since 07:00"). **Interactions:** new rows
enter with a `--dur-fast` fade; batches of more than three insert instantly; the ASCII spinner
only beside a named step. No chat bubbles, no per-token streaming, no fake progress.

## Ledger `/c/[slug]/ledger`

**Intent:** Every dollar and every result, as a receipt I could show an accountant.

**Layout:** a data column up to 1100 px: month summary (spend versus metric per channel; then
one line of counts: "41 decisions answered · 38 tasks done, all with evidence · 12 actions sent
in your name · 3 standing rules") then rows in one fixed order: action · metric before → after ·
cost · evidence. Tabular figures, money right-aligned, a rule under each row, nothing else. At
390 a row stacks to two lines: action and evidence on the first, before → after and cost on
the second. Channel report as a second tab. Export CSV as the one secondary action. Ledger rows
are measured metric change only (OUT-1); answered cards and sends live in Today's actions and
the Team stream, never here, and nothing here has an Undo. **States:** empty ("No ledger
entries yet. The first appears when an action changes a metric."), one row, hundreds (virtualised,
sticky header), offline (last snapshot).

## Artifacts `/c/[slug]/artifacts` and `/artifacts/[id]`

**Intent:** Everything the staff made, readable in a minute, with its evidence and version.

**List:** rows grouped by kind, each with title, version, date, cost, critic score when one
exists; no identical tiles. **Detail:** the document in the reading column; a strip (right on
desktop, top on mobile): version, cost, evidence, download, "Comment" (opens the scoped sheet);
"Show work" expands logs, prompts, diffs. Design artifacts render as what they are (a brand
board, a directions compare with a 390/1280 toggle, a critique report). **States:** rendering,
version history, comments pending, failed render (show the source).

## Settings `/settings` (+ billing, connections, export, usage)

**Intent:** The constitution: what North may do, when, and what it costs.

**Order:** plan and credits (sentences: "Solo plan. 1 company. 120 agent tasks a month; 84 left
until 1 Nov."); usage (BIL-2: model and sandbox cost this month against the plan price);
decisions and brief (quota 1-5, time zone, brief hour); notifications; connections (each a row:
service, scope in words, connected by whom, practice or live, disconnect); export; standing
rules (each as the sentence it enforces, with its cap and a one-tap delete); goal and budget per
company; "What North does not do". Billing: three plans as sentences, the current one marked, no
table; trial line; credit pack. **States:** saved (the section's heading gets "Saved" for 3 s),
error inline, past due ("Payment failed. Agents keep running for 3 days. Update your card."),
ended (what still works, retention date).

## Companies `/companies` (portfolio, the start URL)

**Intent:** One morning for all my companies. **First paint:** the merged digest (companies
with pending cards first) and one row per company with its pending count and goal line; pending
cards are answerable inline here, with the same receipt. The install prompt sits here, once.
**Interactions:** the switcher in the top bar on every company screen.

## The stop control (every company screen)

**Intent:** I can withdraw my trust in one tap, and see that I did.

Same position on every screen, top right of the bar, first in tab order, an ink-outlined control
labelled "Stop all agents". One tap or one Enter stops; no hold, no dialog (stopping is the safe
direction; an accidental stop costs one tap on Resume). Within 100 ms the page holds its breath
(`05`), the bar reads "Stopped 14:02 · Resume" in `--needle`, an action row lands within 5 s.
Resume is one tap. Billing pauses show the reason and the one way out; retention shows
"Archived"; the control stays the same element in every state (its content changes, not its
type). It is never red while idle; the stopped state is.

## Public page `/p/[slug]`

Same typography, only what the owner chose, every string rendered as text, no link into the
app. One intent: "this company exists and is making progress"; nothing to sell.
