# 08 · Skills playbook: Emil, frontend-design, impeccable, and the North header

Three skills were read in full. Each is good at one layer and silent on the others. Use them in
this order, with these overrides, and start every design session with the header at the end.

## `emil-design-eng` (Emil Kowalski): the motion layer. Adopt whole.

Why it works: it is an ordered decision tree with numbers, not adjectives. Should this animate at
all (frequency table: 100+ a day = never); what is the purpose (spatial consistency, state,
feedback, explanation); which easing (enter/exit → ease-out; on-screen movement → ease-in-out;
hover → ease; constant → linear; never ease-in); how fast (press 100-160 ms, tooltip 125-200,
dropdown 150-250, modal 200-500, UI under 300). Plus concrete craft: `scale(0.97)` on press,
never enter from `scale(0)`, origin-aware popovers, instant subsequent tooltips, transitions over
keyframes for interruptible UI, `@starting-style`, transform and opacity only, CSS over JS under
load, reduced motion means fewer and gentler, not none. Its review format (a Before / After /
Why table) is already a critic output. What it lacks: anything outside motion. Override for
North: `05` fixes the numbers as tokens; the frequency table is the law.

## `frontend-design` (Anthropic): the direction layer. Keep the method, drop the adjectives.

Keep: ground the design in the subject (the brief's vernacular is where distinct choices come
from); the five convergence clusters as a self-check; "spend your boldness in one place";
structural devices must encode information (numbers only for sequences); one orchestrated
motion moment beats scattered effects; the two-pass process (compact token plan → review it
against the brief for genericness → build → critique with screenshots); the writing rules
(active voice, the same verb through the flow, errors don't apologise, empty states invite).
Drop: "be bold", "distinctive point of view", "take aesthetic risk": a model cannot verify an
adjective, and rubric adjectives leak into output (the harness post's "museum quality"). It has
no numbers and no evidence-bearing verification; `02` and `07` supply them. Note its own rule:
the brief's words win even when they ask for a listed look, so North's document aesthetic is
allowed because `01` motivates it, and the borrowed chrome is not.

## `impeccable` (Paul Bakaus): the process layer. Adopt the shape, write North's detectors.

What it adds that the others lack: product context before style (`PRODUCT.md`: audience,
purpose, constraints, voice; then `DESIGN.md`: the system, with drift detection); 58
deterministic detectors that run without a model, with exit codes, JSON and waivers; `critique`
(hierarchy, clarity, resonance) separated from `audit` (accessibility, performance,
responsiveness); `harden` and `onboard` for the unhappy paths; `distill` and `quieter` as
explicit moves. Its anti-pattern list (Inter for everything, purple gradients, cards in cards,
grey text on colour, tinted neutrals without reason, bounce easing) is the seed of `02`'s
catalogue. Weaknesses: 24 commands is too many; the launcher downloads a binary on first run
(vendor it, hash it); it flags things North does on purpose (mono data, zero radius), so it needs
a waiver file with reasons. Use: `impeccable detect` in CI on source and on the 390 URL;
`critique` and `audit` as the two halves of the loop in `07`.

## What none of them has, and `07` adds

A separate critic that must cite a selector or crop; pairwise judgment in both orders; a
founder-scored calibration set; deterministic gates that run before any model call; stop rules
and a refine/pivot decision; the "why it's not good" template. Taste without a critic drifts to
the median.

## The header for the designing agent (paste at the top of the session)

```
You are designing or building one screen of North. Read, in order:
docs/design-research/01-thesis.md, 02-design-contract.md, 04-screens.md (your screen),
05-motion.md, 06-voice.md, 07-verification.md. CLAUDE.md and docs/SPEC.md win over all of them.

Before any code: write the screen's intent sentence (from 04) and a compact token plan
(colour as named oklch values within 02's counts; type roles; an ASCII layout at 390 and 1280;
the one memorable element; the one motion). Then check the plan against 02's slop catalogue
and against "would any similar product arrive here?"; revise what is generic and say why.

Build with the repo's conventions (Next.js 16, Tailwind v4 tokens in globals.css, components
under 200 lines, Playwright flow first for a new flow). Every pressable has a press state;
every async action has an optimistic state and an inline failure; every screen ships six states.

Then run the loop in 07 until the gates pass and the critic table has zero fails, with a fresh
critic agent (north-qa-validator) that never sees your explanation. Keep every iteration under
.critic/<screen>/<n>/. Stop at the plateau; never pass 12 iterations or $25 without the founder.

Deliver: the screen, the six-state screenshots at 390 and 1280 in both themes under
docs/evidence/, the critic's final table, and a DESIGN.md diff naming every surviving tell
from 02 with its reason.
```
