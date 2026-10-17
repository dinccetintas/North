# 06 · Voice: the story in words

## Does "less telling" work? Yes, with one correction

Short copy wins when it is concrete and loses when it is vague. Unbounce (41k pages): grade 5-7
copy converts at 11.1 % against 5.3 % at professional level; difficult words, word count and
reading time all correlate negatively. NN/g: concise + scannable + objective rewrites raised
measured usability 124 %; trustworthiness explains 52 % of willingness to recommend, friendliness
8 %, and playful copy was rated less trustworthy. Long copy wins only for unaware or high-stakes
buyers. North's first users are solution-aware and the stakes are high, so:

1. Headlines and claims: few words, each concrete (a number, a noun, a mechanism).
2. Where risk lives (money, a send in your name, deploy, data): explain more, in plain words,
   next to the button. That is the one place a longer sentence earns its keep.
3. Limits: ≤ 20 words a sentence on marketing pages, ≤ 15 in the app; Flesch-Kincaid grade ≤ 7.

## The voice in one line

A competent chief of staff reporting to the CEO. Matter-of-fact, second person for the user,
never "we" (there is no we; the user is the company), agents named by role. Casual-serious;
no humour in errors; no exclamation marks; no emoji.

## Landing copy

Hero options (headline ≤ 12 words, subline ≤ 25):

- A. *Three decisions a day. Everything else gets done.* / Agents plan, build, market and sell
  for your company. They ask you only when money, your name or your code is on the line.
  (Recommended H1: number first, then the promise; "decisions" is a North noun, so it passes
  the "only North could say this" test. The North nouns: decision, card, brief, ledger, gate,
  staff, agents, evidence.)
- B. *A company that runs while you sleep. You still decide.* / Every move an agent makes passes
  a gate. Small ones run. Big ones become a card with a recommendation, a safe default and a
  deadline.
- C. *Be the CEO of your life. Let the staff be software.* Keep as the closing brand line; alone
  it does not say what is sold.

Section claims (≤ 12 words, one real screenshot each): the brief, "Sixty seconds every morning:
what changed, what it cost, what needs you." Cards, "A question, two options, a recommendation,
a deadline. One tap." The gate, "Nothing reaches the world without a tier. Money and your name
need you." The ledger, "Every action, what it changed, what it cost. Nothing is ever deleted."
Stop, "One button. Every agent stops within five seconds."

Proof block: only what a reviewer can verify in the repo or a screenshot. No logos, no "trusted
by", no invented counts. CTA: "Start a company", with "14 days · no card · your code stays in
your GitHub" under it. Pricing as sentences: "Solo. $X a month. 1 company. N runs. Cancel any
time; your data is kept 90 days."

## In-app rules (before → after)

1. Brief headline is one fact, past tense, with a number. "Here's your morning update!" →
   "2 sign-ups yesterday. $14 spent. 1 card waiting."
2. Card question is verb-first, ≤ 15 words, ends with "?". "Approval needed for proposed
   outreach initiative" → "Send 5 first-contact emails from your Gmail?"
3. Options name the action and the object, never Yes/No/Approve/Decline. "Approve ★ /
   Decline" → "Send 5 emails ★ / Don't send".
4. The default line names the consequence in a plain sentence. "No answer by the deadline →
   decline" → "If you don't answer by Thu 18:00, nothing is sent." K3: "No default. Nothing
   happens until you answer."
5. Cost and deadline are numerals, always visible: "$10/day · due Thu 18:00".
6. Stop: the button is "Stop all agents", one tap, no confirmation; after: "Stopped 14:02 ·
   Resume". "Kill" never appears on screen.
7. Pause banner: state, reason, what still works, what to do. "Agents paused: subscription
   ended. Brief and export still work. Data kept until 14 Jan. Resubscribe to resume."
8. Empty states say what will appear and who makes it. "Nothing here yet." → "No ledger entries
   yet. The first appears when an action changes a metric." Quiet days on Home get one line,
   "Nothing else needs you today", never five "Nothing."s.
9. Errors: what happened, what did not happen, what next; no "oops", "sorry", "invalid",
   "please", "successfully". The model already in the repo: "Stripe did not answer in time.
   Nothing was charged."
10. Agent status lines are present-progressive, ≤ 5 words, with the object, and a last-changed
    time after 60 s: "Researching 12 competitors, 4 min".
11. Ledger rows keep one order: action · before → after · cost · evidence.
12. Confirmations are nouns: "Card answered." "Plan saved." "Export ready."
13. Billing speaks in the user's money: "Payment failed. Agents keep running for 3 days. Update
    your card."
14. Never ask for trust without data: "Recommended: option A. The last 3 tests at this budget
    returned 2-4 sign-ups each."
15. Money has two words that never mix: *spent* (your own accounts: the card, the budget,
    the ledger; "$14 spent") and *tasks* (what the plan includes; "120 agent tasks a month,
    84 left until 1 Nov"). Per-task model cost appears only in Settings › Usage, never on a
    Team row. Name the account money leaves: ad spend leaves the ad account ("Hold to spend
    $40 of ad budget from your Meta Ads account"); Stripe is read-only income and is never
    named as a source of spend. "Sandbox" reads "Practice mode: nothing real is sent or spent
    until you switch a connection to live."
16. Internal codes get a plain label: tiers read "Runs automatically / Tells you after / Needs
    your decision / Only you can do this" with the K-code as a badge beside, never alone.
    `CHIEF_OF_STAFF`, `signal.pursue`, `entitlement`, `provenance` never appear on screen.

## How an agent speaks

Reporting: result first, past tense, ≤ 2 sentences, evidence link, cost as numerals. "Shipped
the landing page. Preview: <link>. 1 run, $0.41." Asking: one question, the thing at stake
named, the recommendation with one reason and a number, then the default. Failing: what failed,
what did not happen, what happens next, no apology. "Build failed on test 14. Nothing deployed.
Retrying once with the fix; if it fails again the task stops and the brief says so." Forbidden:
"I've gone ahead and", "great news", "let's", hedges, any claim without evidence.

## Banned words (grep in `apps/web` strings and prompt templates; CI fails on a hit)

seamless, elevate, unlock, unleash, delve, empower, revolutionize, effortless, supercharge,
game-changer, cutting-edge, next-level, leverage, robust, streamline, harness, navigate,
landscape, tapestry, journey, AI-powered, powered by AI, magic, superpowers, 10x, "not only …
but also", successfully, oops, uh-oh, invalid, congrats, awesome, amazing, exciting, "we're
thrilled", "welcome aboard", any emoji, any exclamation mark in system copy.

Preferred: decide, run, plan, build, ship, send, start, stop, pause, resume, cost, spent,
changed, evidence, default, deadline, gate, brief, card, ledger, agent, thesis, goal, budget,
cap, your GitHub, your account, nothing happened, kept. Numerals always ("3 cards").

## Glossary on screen

Keep from `CONTEXT.md`: Brief, Card, Ledger, Evidence, Thesis, Goal, Budget, Plan, Agent, Chief
of Staff, Signal, Artifact, Credit, Export, Public page, Team. "Staff" lives only in the brand
line; the product says "agents". "Auto rule" may read "Standing answer" if Settings is rebuilt.
