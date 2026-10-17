# 04 · Screens: what each one must do, show first, and feel

Format per screen: **Intent** (the one sentence the critic quotes), **First paint at 390 × 844**
(what must be inside the fold), **Order** (content, top to bottom), **States**, **Interactions**
(details in `05`), **Copy** (details in `06`). Desktop at 1280 uses the same order in a 640-720 px
reading column; data screens widen to 960-1100 px. Six states per screen are screenshotted in
both themes before a screen is called done (`07`).

## Landing `/`

**Intent:** "My staff already did the work; I only decide." Convert a technical builder in 60 s.

**First paint:** H1 (≤ 12 words, contains a North noun), the gate sentence, one CTA ("Start a
company"), and *the product itself*: a real morning brief from a demo company with one pending
card under it, rendered with the app's own components in the app's light theme. No terminal
strip, ticker, cursor, dark hero or illustration. The hero is the product, because the product
is text and the text is the proof.

**Order:** 1 hero as above (the demo card is answerable: tapping an option plays the answer
interaction and shows the ledger row, nothing is sent). 2 "What happens in 30 days" as five rows
(day 1, 7, 15, 21, 30), each a claim ≤ 12 words with one real screenshot. 3 The gate: one short
paragraph and a four-row table (runs / tells you / asks you / only you). 4 Proof block: a real
ledger excerpt with costs; "your code stays in your GitHub"; "money moves only from your own
accounts"; "sandbox by default"; "export everything". 5 "What North does not do" (≥ 5 items).
6 Pricing: three plans as sentences, no table. 7 Closing line "Be the CEO of your life. Let the
staff be software." and the CTA again. Footer: legal, export, the stop button shown as an image
with its one-line promise.

**States:** static; reduced motion shows the demo card already answered. **Interactions:**
cross-document view transition into `/login`; the demo card's answer is the signature
interaction (`05`). Scroll-driven motion only for the five-row story, and only in browsers that
support it. **Copy:** `06` §3.

## Login `/login`

**Intent:** Don't make me think. **First paint:** "Sign in", Google button, email field,
"Continue with email", the legal line. No marketing. **States:** sent (the inbox line replaces
the form), error (what failed, what to do), returning user (email remembered via
`autocomplete`). **Interactions:** button press feedback; the sent state animates in with
`@starting-style` 200 ms. **Copy:** no password mention beyond "No password. We email you a link."

## New company `/new` and Onboarding `/c/[slug]/onboarding`

**Intent:** Hand the company over in under ten minutes and feel understood.

**First paint (`/new`):** "What are we building?" and the thesis box with a two-line example
inside it; name, target customer and why-now folded under "More" until the thesis has 40
characters. **Order of the wizard:** questions (≤ 5, each with its "why we ask") → goal (a
default proposed from the thesis, editable) → budget (categories with a hard cap, cap is
required, "nothing is spent until a card says so") → team (departments on/off, a persona per
department from the catalogue, dial Review drafts by default; a line per department on why it
serves the goal; estimated monthly runs) → summary (reads back thesis, goal, cap and team in
≤ 120 words; one button "Approve and start"). Step count is shown and never changes.

**States:** saving (the button says "Saving…" in place, no spinner elsewhere), error inline
under the field, resume (returning lands on the current step with earlier answers kept).
**Interactions:** the wizard is one route with a shared header; steps slide 320 ms on first
visit, cut when navigating back. After approve: within 60 s Home shows "First report by 09:00"
with the team's state lines. **Copy:** questions in plain words; the summary is the designed
peak and must read better than the user wrote it.

## Home `/c/[slug]` (the morning)

**Intent:** What needs me today, in five minutes, then done.

**First paint:** top bar (company name or switcher, the stop control); "Thursday 17 October" and
the brief's headline sentence as the page's largest text ("2 sign-ups yesterday. $14 spent.
1 card waiting."); the first pending card in full with its options reachable by thumb; the
second card peeking; or, with no cards, the closure line "Nothing else needs you today" set
calmly in body size, not a grey box. Nothing else is above the fold.

**Order:** 1 header as above. 2 Cards (≤ 3) and, under them, the answered strip: a one-line
ledger of today's answers that cards travel into. 3 The brief, collapsed to its headline plus
"Read the brief · 60 s"; expanded, sections in the fixed order with hairlines between them, and
sections with nothing are omitted, never printed as "Nothing." 4 Goal: metric name, current
versus target, a thin bar, due date; "no measurement yet" when empty. 5 This week: summary
paragraph and the task rows. 6 Team line: one row per active role ("Research · Reading 12
competitors · step 3/7 · $0.40"), linking to Team. 7 Artifacts strip. 8 Website line when a
preview or live URL exists.

**States:** before onboarding (one card-like invitation "Four short steps; the research agent
starts when you approve"), stopped (the banner under the bar; cards disabled with the reason),
paused by billing, offline (the cached brief with "Offline · brief from 07:00"), loading (cold
load only: the header paints first, the rest streams), long (many tasks: rows virtualised).
**Interactions:** card answer and travel (`05`); brief reveal on first open of the day; live
refresh updates rows in place without motion. Keyboard: 1/2/3 answer the focused card, instantly.

## Decision card (inline and `/c/[slug]/decisions/[id]`)

**Intent:** Answer in under ten seconds with confidence, knowing what happens if I don't.

**Layout, top to bottom:** a one-line mono header (tier as a plain label with the code as a
badge, cost, due); the question as the largest text on the screen (serif, ≤ 15 words, verb
first); "Why", two lines of rationale with "Show reasoning" for the rest; facts as a small
two-column table (never a mono paragraph, never a raw URL: show the domain as a link); options
as outcome-labelled buttons, the recommended one the only filled control, ≥ 44 px, in the
bottom half of the fold; directly under them the default line "No answer by Thu 18:00 → nothing
is sent"; evidence links last. The detail page adds the full signal, artifact or campaign and the
"At a glance" table only for what the card did not already show.

**States:** waiting, answered (the chosen option stays, others fade; "Answered · Send 5 emails ·
09:12"), queued with undo (5 s), executed (ledger link), failed (what failed, nothing happened,
what next), stopped (options disabled, reason), deferred (quota spent; "comes back tomorrow").
**Interactions:** one tap for non-money K2; hold-to-confirm with the amount in the button for
money and sends; the answer travels to the strip (`05`); "Make a rule" after the third identical
answer. **Copy:** `06` §4 rules 2-5.

## Team `/c/[slug]/team`

**Intent:** My staff is working, and I can see what, how far and at what cost.

**First paint:** role rows (not a 4-up grid of identical boxes): name, plain role label, state
chip (thinking / waiting for you / executing / done / idle), current task, step n/m, $ today,
last evidence link, a per-role Stop. **Order:** roles with activity first; idle roles compact.
Then the 24-hour stream as a table with tier labels in plain words and the card or rule that
authorised each K2 action. Leads upload lives under Sales, folded. **States:** no roles yet
(what will appear and when), stopped (rows frozen, red hairline through the running ones),
quiet day ("No actions since 07:00"). **Interactions:** new rows enter with a 200 ms fade;
batches of more than three insert instantly; the ASCII spinner only beside a named step. No
chat bubbles, no per-token streaming, no fake progress.

## Ledger `/c/[slug]/ledger`

**Intent:** Every dollar and every result, as a receipt I could show an accountant.

**Layout:** a data column up to 1100 px: month summary (spend versus metric per channel, count
of active rules) then rows in one fixed order: action · metric before → after · cost · evidence.
Tabular numerals, right-aligned money, hairlines between rows, nothing else. Channel report as a
second tab. Export CSV as the one secondary action. **States:** empty ("No entries yet. The first
appears when an action changes a metric."), one row, hundreds of rows (virtualised, sticky
header), offline (last snapshot). **Interactions:** K1 rows with an open undo window show "Undo
· 14 min left"; new rows arrive with the odometer on totals.

## Artifacts `/c/[slug]/artifacts` and `/artifacts/[id]`

**Intent:** Everything the staff made, readable in a minute, with its evidence and version.

**List:** rows grouped by kind, each with title, version, date, cost, critic score when one
exists; no identical tiles. **Detail:** the document in the reading column with the memo
typography; a right-hand (desktop) or top (mobile) strip: version, cost, evidence, download,
"Comment" (opens the scoped sheet). Design artifacts render as what they are (a brand board, a
directions compare with a 390/1440 toggle, a critique report). **States:** rendering, version
history, comments pending, failed render (show the source). **Interactions:** list → detail is a
same-document view transition on the title.

## Settings `/settings` (+ billing, connections, export)

**Intent:** The constitution: what North may do, when, and what it costs.

**Order:** plan and credits (plain sentences: "Solo. 1 company. 120 runs a month. 84 left.");
decisions and brief (quota 1-5, time zone, brief hour); notifications; connections (each a row:
service, scope in words, connected by whom, sandbox or live, disconnect); export; standing rules
(each as the sentence it enforces, with its cap and a one-tap delete); "What North does not do".
Billing: three plans as sentences, the current one marked, no table; trial line; credit pack.
**States:** saved (the section's heading gets "Saved" for 3 s, no banner), error inline, past due
(what happens in how many days, one action), ended (what still works, retention date).

## Companies `/companies` (portfolio)

**Intent:** One morning for all my companies. **First paint:** the merged digest (companies with
pending cards first) and one row per company with its pending count and goal line. The install
prompt sits here, once. **Interactions:** switcher in the top bar on every company screen.

## The stop control (every company screen)

**Intent:** I can withdraw my trust in one second, and see that I did.

Same position on every screen, top right of the bar, a calm outlined control labelled "Stop all
agents". Hold 600 ms with a hairline fill; keyboard hold on Enter or Space. On release: within
100 ms the page holds its breath (every animation frozen, running rows struck through), the bar
shows "Stopped 14:02 · Resume" in the accent, a ledger entry lands within 5 s. Resume is one tap.
Billing pauses show the reason and the one way out; retention shows "Archived". The control is
never red while idle; the stopped state is.

## Public page `/p/[slug]`

Same memo typography, only what the owner chose, every string rendered as text, no link into the
app. One intent: "this company exists and is making progress"; nothing to sell.
