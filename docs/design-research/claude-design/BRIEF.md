# North — design brief for Claude Design

Upload this file, `SAMPLE-DATA.md` and the `system/` kit before the first prompt. Everything
Claude Design needs is here; the longer research lives in `docs/design-research/` for the build
session.

## What North is

A one-person-company operating system. The user is the CEO; eight AI agents (chief of staff,
research, strategy, design, engineering, growth, sales, operations) are the staff. Every morning
the user reads a 60-second brief and answers at most a few decision cards (a question, two or
three outcome-labelled options, a recommendation with a reason, a cost, a deadline and a safe
default). Every action that touches the outside world passes a gate: small ones run, some tell
you after, money and your name need your decision, a few only you can do. A ledger records every
action, what it changed and what it cost. One button, "Stop all agents", stops everything within
five seconds. Money moves only from the user's own accounts. The code lives in the user's GitHub.

Audience: technical builders with a full-time job, then solo operators with revenue. Phone at
07:30 for five minutes; laptop in the evening. Positioning: "Three decisions a day. Everything
else gets done." Brand line: "Be the CEO of your life. Let the staff be software."

## The feeling

Command, calm, evidence, speed. A CEO reading a memo from a chief of staff who already did the
work, not a prompt engineer watching a terminal. Premium here is quiet: speed, continuity, one
deliberate novelty per surface, invisible correctness. Nothing waits, nothing shouts, nothing
is decorated.

## The visual direction: "the receipt", set like a memo

- **One type family**, Source Serif 4, optical sizes for display and text, tabular lining
  figures for every number. Mono (IBM Plex Mono) only for code and ids. Nothing uppercase-tracked.
- **Rules, not boxes.** Every data row sits on a hairline; nothing sits in a bordered grey box.
  Radius 0 on surfaces, 2 px on controls, 6 px on the one floating sheet (the only shadow).
- **Eight colours** (in `system/tokens.css`): paper, ink, two text tones, rule, surface, needle
  red, verified green. Needle red appears only when agents are *not running* (stopped, failed).
  Verified green only on verified evidence and "live". Nothing else is coloured. Dark mode is a
  second set of the same roles, never an inversion.
- **Controls feel physical and are never decorated**: outline control; the one primary control
  on a screen is ink-filled; press scales to 0.97; money is confirmed by holding the button
  while a fill grows inside it, the amount in the label.
- **Five type roles**: display 32, title 22, body 17, small 15, meta 13; weights 400 and 600.
  Spacing 4/8/12/16/24/32/48/64/96. Reading column 66 characters.

Never: terminal strips, tickers, blinking cursors, gradients, glows, purple, cream and
terracotta, icon tiles above headings, three identical cards in a row, cards inside cards,
numbered 01/02/03 markers on non-sequences, scroll-reveal on every section, hover lift on every
card, bounce easing, pulsing dots, custom cursors, illustrations, mascots, emoji, exclamation
marks, "seamless", "supercharge", "AI-powered", "unlock".

## The screens (design in this order)

1. **Home (the morning)**, 390 × 844 first, then 1280. Top bar: company switcher, "Stop all
   agents" outlined control. The date in meta, then the brief's headline sentence as the
   largest text: "2 sign-ups yesterday. $14 spent. 1 card waiting." Then **Today's actions**:
   the pending card in full (see 2), under it the receipt rows of cards already answered. If
   nothing is pending: the line "Nothing else needs you today" in body size. Below the fold:
   the brief collapsed to "Read the brief · 60 s" (expanded: Yesterday, Metrics, Spend,
   Signals as rows with hairlines; empty sections omitted), Goal (name, current / target, thin
   bar, due date), This week (a paragraph and task rows), Team (one row per active role),
   Artifacts, Website, and a "Chief of Staff" entry at the end. At 1280: the reading column on
   the left, Today's actions on the right.
2. **The decision card** (inline on Home, and the detail page). Meta line (tier in plain words,
   cost, due) → question as the largest text on the card, verb first, ≤ 15 words → "Why", two
   lines + "Show reasoning" → facts as a two-column mini table → options: the recommended one
   is the only ink-filled control, labelled "Recommended", ≥ 44 px, never pre-selected; the
   others outlined → directly under: "If you don't answer by Thu 18:00, nothing is sent."
   States: waiting; chosen (check + "Chosen"); sending with "Sending in 5 s · Undo" inside a
   collapsed receipt row; sent; failed ("Build failed a check. Nothing went live."); stopped.
   Money variant: the option reads "Hold to spend $40 of ad budget from your Meta Ads account"
   with the fill half-grown.
3. **Landing** (both colour schemes; follows the visitor's scheme). Fold at 390: H1 "Three
   decisions a day. Everything else gets done.", the gate sentence "Nothing reaches the world
   without your yes.", one CTA "Start a company" with "14 days · no card · your code stays in
   your GitHub" under it, and the top edge of the product itself: the real Home brief with one
   pending card, rendered with the same components, tipped 6° in perspective and flattening on
   scroll, labelled "Demo company · nothing is sent". Then: five rows "What happens in 30 days"
   (day 1, 7, 15, 21, 30; claim ≤ 12 words + a product screenshot each); the gate as a four-row
   table; a proof block (a real ledger excerpt, "your website's code lives in your own GitHub
   account", "money moves only from your own accounts", "practice mode by default", "export
   everything"); "What North does not do" (≥ 5 items); pricing as three sentences, no table;
   the brand line and the CTA again; footer. No illustration, no dark hero, no logos.
4. **Team**: rows, not a grid. Name, plain role, state word (Thinking / Waiting for you /
   Executing / Done / Idle; "Waiting for you" is the only bold one), current task, step n of m,
   last evidence link, a per-role Stop. Then the 24-hour stream as rows with the tier in plain
   words. No chat bubbles, no progress bars.
5. **Ledger**: month summary (spend versus metric per channel; a counts line "41 decisions
   answered · 38 tasks done, all with evidence · 12 actions sent in your name · 3 standing
   rules") then rows: action · metric before → after · cost · evidence. Tabular figures, money
   right-aligned, a rule under each row. At 390 a row stacks to two lines.
6. **Onboarding**: five steps, count shown (questions ≤ 5 → goal with a proposed default →
   budget with a required hard cap → connect tools or skip → summary that reads the thesis back
   in ≤ 120 words with one "Approve and start" control). And `/new`: "What are you building?"
   with a thesis box carrying a two-line example.
7. **Settings**: plan as a sentence ("Solo plan. 1 company. 120 agent tasks a month; 84 left
   until 1 Nov."), usage, decisions and brief (quota 1-5, time zone, brief hour), notifications,
   connections as rows (service, scope in words, practice or live), export, standing rules as
   sentences with a cap and one-tap delete, "What North does not do". Billing: three plans as
   sentences, the current one marked, no table.
8. **The stop control and the stopped state**: idle = ink outline "Stop all agents", top right
   of the bar on every screen; stopped = "Stopped 14:02 · Resume" in needle red, a one-line
   banner under the bar, running rows struck through with a needle hairline.
9. **Login, Companies (portfolio), Artifacts list and detail, Public page**: same system,
   one intent each (Login: "Don't make me think"; Companies: one morning for all companies, cards
   answerable inline; Artifacts: readable in a minute with version, cost, evidence; Public page:
   only what the owner chose, nothing to sell).

Each screen needs six states where they apply: default, empty, loading (first load only),
error, offline, long content. Empty states say what will appear and who makes it, with at most
one action.

## Voice

A competent chief of staff reporting to the CEO. Second person for the user; never "we".
Sentences ≤ 15 words in the app. Numbers as numerals with units. Card questions verb-first,
ending in "?". Option labels name the action and the object ("Send 5 emails", "Don't send"),
never Yes/No/Approve/Decline. Errors say what happened, what did not happen, what next; no
"oops", "sorry", "invalid", "successfully". Confirmations are nouns: "Card answered." Two money
words that never mix: *spent* (your accounts) and *tasks* (what the plan includes). Internal
codes (K0-K3, role ids) never appear alone; tiers read "Runs automatically / Tells you after /
Needs your decision / Only you can do this". The word "kill" never appears; the button is
"Stop all agents".
