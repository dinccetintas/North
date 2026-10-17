# North design research: how to use these documents

Written 2026-10-17 by five research personas (taste theorist, premium-web practitioner,
customer-journey researcher, copy strategist, verification engineer), then argued over by three
reviewers (a skeptical critic, a user advocate, the implementing engineer) and merged. Every
claim has a source in `09-sources.md`. Raw persona reports live in git history under
`docs/design-research/raw/` for anyone who wants the long form.

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

Boardroom, not chat. Home = brief + at most three cards. Kill switch on every screen. Mobile
first at 390 px. Home paints in 1.5 s; a card answer reaches the queue in 2 s. Every action
through the gate; every "done" with evidence. These documents never override them.

## Files

- `01-thesis.md` — the story, the feeling, eight principles, the visual direction and why.
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
