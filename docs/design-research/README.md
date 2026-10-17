# North design research: how to use these documents

Written 2026-10-17 by five research personas (taste theorist, premium-web practitioner,
customer-journey researcher, copy strategist, verification engineer), then argued over by three
reviewers (a skeptical critic, a user advocate, the implementing engineer) and merged. Every
claim has a source in `09-sources.md`. Raw persona reports and the three reviews live under `docs/design-research/raw/` for anyone
who wants the long form.

## Who reads what

| You are | Read, in order | Then do |
| --- | --- | --- |
| The agent about to design or build North's front end | `01-thesis.md` → `02-design-contract.md` → `04-screens.md` (your screen) → `05-motion.md` → `06-voice.md` → `07-verification.md` | Write the screen's token plan, build, run the loop in 07 until the critic table has zero fails, attach the evidence |
| A reviewer of a design PR | `07-verification.md` → `02-design-contract.md` | Fill the critic table; a verdict without a selector or crop is invalid |
| Someone deciding product/UX questions | `01-thesis.md` → `03-journey.md` | Check the decision against the persona table and the approval layer |
| Someone writing copy or prompts | `06-voice.md` | Grep for banned words before merging |

## The one-paragraph version

North sells a feeling: *I run a company, my staff is software, and nothing leaves the building
without my yes.* Premium is not spectacle; the premium products of 2025-26 are quiet. The feeling
comes from four mechanisms: speed (nothing waits), continuity (things move, never teleport),
one deliberate novelty per surface, and invisible correctness (easing, origin, states, copy).
Taste is not an adjective: it is a counted system plus a critic that must name the violated
principle and cite evidence. The current North look is competent and honest but is the
"editorial terminal" default that AI tools converge on (and the Polsia look). Keep what the
subject justifies (the brief is a document, the ledger is a table), drop the borrowed chrome, and
spend the boldness in one place: the moment a decision is made.

## Non-negotiables carried from `CLAUDE.md` and `docs/SPEC.md`

Boardroom, not chat. Home = brief + the day's cards (the quota, default 3). Stop control on every screen. Mobile
first at 390 px. Home paints in 1.5 s; a card answer reaches the queue in 2 s. Every action
through the gate; every "done" with evidence. These documents never override them.

## How the review round changed the draft (the debate log)

Three reviewers read the first draft; each answered the other two in a rebuttal round
(`raw/review-*.md`, `raw/rebuttal-*.md`). Outcomes:

- **Stop is one tap**, never a hold (SPEC "tek tıkla"; a tap that does nothing is the worst
  feedback in a panic; an accidental stop costs one tap on Resume). Hold-to-confirm stays only
  on money and sends.
- **One type family**, not serif plus mono: Source Serif 4 with optical sizes and tabular
  figures; mono only for code and ids. The serif-plus-mono pairing was the strongest "AI made
  this" tell. Verified that the served font carries `tnum`.
- **The signature is the receipt**, not a flight: the card collapses in place into its own row
  with Undo inside; the answer is committed at once and the worker honours a 5 s withdrawal
  window (a client-side delay would break the 2 s queue rule). Money is confirmed by holding;
  on the keyboard by select, relabel, Enter (timed key holds are not reliable).
- **Red only for stopped and failed.** A waiting card is loud by size and by the single
  ink-filled control; the morning is never painted in the alarm colour.
- **No ledger theatre.** Ledger rows are measured metric change only; answered cards and sends
  live in "Today's actions"; the landing demo never shows a fabricated ledger row.
- **Onboarding matches the spec**: five steps including connect tools (or skip); no setting
  grants a standing rule in advance; cards on Home are bounded by the quota (1-5), not by 3.
- **One money vocabulary**: "spent" for the user's accounts, "tasks" for the plan; ad spend
  leaves the ad account, never "from Stripe"; no per-task dollar figure on Team rows.
- **Values, not adjectives**: 02 now carries oklch values for both schemes, five type roles with
  sizes, two weights, nine spacings, the four durations; 07 runs on :3200 with a dedicated
  Playwright config and no runtime dependencies.

## Files

- `01-thesis.md` — the story, the feeling, ten principles, the visual direction and why.
- `02-design-contract.md` — tokens with hard counts (type, colour, space, radius, motion), the
  slop catalogue with tests, what stays and what goes from the current system.
- `03-journey.md` — five personas, the journey map, where they meet, the approval layer, agents.
- `04-screens.md` — per-screen specs: first paint, content order, states, interactions, copy.
- `05-motion.md` — motion tokens, per-component rules, the signature interaction, 3D policy.
- `06-voice.md` — the story in words, landing copy, in-app rules, agent grammar, banned words.
- `07-verification.md` — the loop, gates, rubric, output format, stop rules.
- `08-skills-playbook.md` — how to use the Emil, frontend-design and impeccable skills, what
  each gets wrong for North, and the prompt header the designing agent should start from.
- `09-sources.md` — annotated bibliography.
