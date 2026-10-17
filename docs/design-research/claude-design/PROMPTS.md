# Prompts for Claude Design (one per step; paste in order; refine before moving on)

Each prompt names goal, layout, content, audience and devices, as Claude Design's own guidance
asks. Keep the thread going; do not restart with one giant prompt.

## 0 · Setup (before any screen)

"Use the North design system I uploaded (`system/tokens.css` and the preview cards). Read
`BRIEF.md` and `SAMPLE-DATA.md`. Confirm in one paragraph: the one type family and five roles,
the eight colours and what needle red and verified green are reserved for, rules-not-boxes,
the single filled control per screen, and the banned list. Do not design anything yet."

## 1 · Home, mobile

"Design North's Home screen at 390 × 844 for a technical founder reading on a phone at 07:30.
Goal: answer 'what needs me today' in five minutes, then feel done. Layout: top bar (company
name, 'Stop all agents' outlined control), the date in meta, the brief headline as the largest
text, then Today's actions with card #1 from SAMPLE-DATA fully inside the fold (its options
reachable by thumb), then the two receipt rows. Below the fold in this order: the brief
collapsed to 'Read the brief · 60 s', Goal, This week, Team (one row per active role),
Artifacts, Website, Chief of Staff entry. Use the sample data verbatim. One filled control on
the screen: the recommended option. No boxes around sections; rules between rows only. Show
two variants: one with the card pending, one with no cards and the line 'Nothing else needs
you today'."

## 2 · Decision card states

"Take the card from Home and show it in eight states as a row of frames at 390 wide: waiting;
chosen (check + 'Chosen', others faded); collapsing into its receipt row with 'Sending in 5 s ·
Undo'; sent; failed ('Build failed a check. Nothing went live.'); stopped (options disabled,
reason line); the money variant with 'Hold to spend $40 of ad budget from your Meta Ads
account' as the filled option and its fill half-grown; the detail page at 1280 with the
question in display size, 'Show reasoning' open, and the 'At a glance' table only for what the
card did not already show."

## 3 · Home, desktop and dark

"Home at 1280 × 800: the reading column (max 66 characters) on the left with the brief and
goal; Today's actions on the right, same components. Then the same two screens in the dark
scheme from tokens.css (not an inversion). Check that the hierarchy order is identical in both
schemes."

## 4 · Landing

"Design the landing page at 390 and 1280, in the light scheme and then dark, for a technical
builder deciding in 60 seconds whether North is real. Content exactly from SAMPLE-DATA ›
Landing. The fold at 390 holds the H1, the gate sentence, the CTA with its small line, and the
top edge of the product: the real Home brief with card #1, built from the same components,
tipped 6° in perspective, labelled 'Demo company · nothing is sent'. Then the five-day rows
(each with a product screenshot from the Home design, not an illustration), the gate table,
the proof block, the 'does not do' list, pricing as three sentences, the brand line and CTA,
footer. No illustration, no logos, no dark hero, no gradients, one CTA per viewport."

## 5 · Team, Ledger

"Team at 390 and 1280 with the SAMPLE-DATA rows: role rows (state word, task, step n of m,
evidence link, per-role Stop), then the 24-hour stream. 'Waiting for you' is the only bold
state; 'Failed' is the only needle-red text. Then the Ledger: month summary, the counts line,
rows with tabular figures and money right-aligned; show the 390 two-line stacking."

## 6 · Onboarding and /new

"`/new` ('What are you building?' with the thesis box carrying the two-line example) and the
five onboarding steps at 390, step count visible: questions, goal, budget (hard cap required;
'nothing is spent until a card says so'), connect tools (Connect or Skip per service), summary
(the thesis read back in ≤ 120 words, one control 'Approve and start'). Then the Home state
right after approval: 'Agents are starting. First results within 24 hours; the brief arrives
at 07:00.'"

## 7 · Settings, Billing, Login, Companies, Artifacts, Public page

"Settings and Billing at 390 and 1280 with the SAMPLE-DATA sentences (no comparison table;
rules as sentences with a cap and delete). Login. Companies (the merged digest, companies with
pending cards first, cards answerable inline). Artifacts list and one detail (version, cost,
evidence, Comment, Show work). The public page."

## 8 · Stop and the six states

"On Home, Team and the card: the stopped state (bar reads 'Stopped 14:02 · Resume' in needle
red, a one-line banner, running rows struck through). Then for Home, Ledger and Artifacts the
remaining states: empty, loading (first load only), error, offline ('Offline · brief from
07:00'), long content."

## 9 · Review (paste `REVIEW-PROMPT.md`), then fix only Blocker and High, then review again.
