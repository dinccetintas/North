# 07 · Verification: how the agent proves "not good yet, because X"

Evidence base: Anthropic's harness post (self-evaluation skews positive; a skeptical standalone
evaluator is tractable; "does this follow our principles?" beats "is this beautiful?"; few-shot
score breakdowns reduce drift; 5-15 rounds; complexity creeps; the author sometimes preferred a
middle iteration). Zheng et al. 2023 (position, verbosity and self-enhancement bias; swap and
agree; chain of thought). UICrit 2024 (zero-shot VLM critique 0.31 against human 0.75; nearest
few-shot examples plus coordinates 0.48; critique and locate as separate calls). Connor &
Irizarry (critique is evaluating a design against its goals; the rest is reaction).

## Setup, once (facts checked against the repo on 2026-10-17)

- `pnpm install` first (`node_modules` is absent in a fresh container).
- The web package is `@north/web`. Production serves on **:3200** (`pnpm --filter @north/web
  build && pnpm --filter @north/web start -- -p 3200`), as `playwright.prod.config.ts` already
  does; :3100 is the dev server and :3000 is `next start`'s default. Dev mode lies about LCP,
  fonts and CLS, so the critic only ever looks at :3200.
- Create `apps/web/playwright.critic.config.ts` with four projects: `mobile-light`,
  `mobile-dark` (390 × 844), `desktop-light`, `desktop-dark` (1280 × 800, the repo's desktop
  size), each with `colorScheme` set and a fifth `mobile-reduced` with `reducedMotion: "reduce"`;
  `webServer` copied from the prod config. Add `e2e/critic/**` to `testIgnore` in
  `playwright.config.ts` so `pnpm e2e` never runs the critic with the milestone specs.
- `apps/web/e2e/critic/`: `fixtures.ts` (seeds a company through the `e2e/stack.ts` helpers,
  saves `storageState`, exposes `setOffline`, long-content and error fixtures so all six states
  are reachable behind RLS), `render.spec.ts`, one spec per gate group (`gates-layout`,
  `gates-a11y`, `gates-motion`, `gates-copy`, each under 400 lines), `heuristics.spec.ts`,
  `tokens.ts` (the expected computed values; tokens live in `apps/web/src/app/globals.css`,
  there is no `tokens.json`).
- Dev dependency: `pnpm --filter @north/web add -D @axe-core/playwright` (MPL-2.0). Lighthouse
  runs through `scripts/lighthouse-pwa.sh`'s pattern (`npx --yes lighthouse@13`,
  `CHROME_PATH=/opt/pw-browsers/chromium`), not as a dependency. No runtime dependency is added
  for the critic.
- `.critic/` is added to `.gitignore`; every iteration is kept at `.critic/<screen>/<n>/`;
  finals go to `docs/evidence/design/<screen>/`.
- Soft heuristics, not gates: `impeccable detect` (its launcher downloads a binary; vendor and
  hash it, add a waiver file for mono ids and zero radius, skip with a reason when offline) and
  Vercel's `command.md` vendored as `.claude/commands/wig.md` (a model step, so it cannot be a
  gate under "code decides").
- Every JSON the critic returns (scores, findings, coordinates) is parsed with Zod before any
  code acts on it (CLAUDE.md: validate every boundary; model output is untrusted).

## The loop (execute verbatim per screen)

1. **Intent and test.** Write the screen's one-sentence intent (from `04`) into `SCREENS[]`,
   then write or adjust the Playwright flow assertion for the behaviour you are about to build
   (TDD: the test fails first). Testids and data attributes are a contract: never rename them.
2. **Build production** on :3200.
3. **Render.** Each route × the five projects; wait `document.fonts.ready` and network idle;
   move the mouse off-screen; save `fold.png`, `full.png`, the DOM facts JSON and the heuristic
   variants.
4. **Gates** (below) → `gates.json`. Any FAIL goes straight to the fix step; no model call.
   Code decides; the model never argues with a gate.
5. **Heuristics** (below); each yields one line the critic must quote.
6. **Critique** by a fresh subagent (`north-qa-validator`, never the builder's context), images
   first and labelled, then DOM facts, rubric and the two or three nearest calibration examples.
   Call (a): absolute scores with evidence. Call (b): pairwise against iteration n-1, run twice
   with A/B swapped; a win needs both orders to agree, otherwise a tie.
7. **Decide** refine / pivot / stop; write `decision.md`.
8. **Fix** Blocker and High only; write the expected effect before editing; one fix per commit.
9. **Re-run from 2.** `toHaveScreenshot` against n-1 at `maxDiffPixelRatio 0.005`: a diff under
   0.5 % after a claimed visible fix is a "no-op iteration" (a purged class, a dark override).

Cost: a critique is about $0.15-0.30 (12 images ≈ 13k vision tokens; three judge calls); a
full loop $0.50-2 and 6-15 minutes; steps 2-5 are free and take 3 minutes, so run them after
every edit and the full loop only when gates pass. A screen converges in 1-3 hours under $20;
the budget is the sum of the judge calls' reported usage, logged per iteration.

## Deterministic gates (pass/fail in all five projects)

| Gate | Threshold | Tool |
| --- | --- | --- |
| Overflow | `scrollWidth ≤ innerWidth` | Playwright |
| Console | 0 errors, 0 hydration mismatches | Playwright |
| Fonts | `document.fonts.check()` true for every declared family; `tnum` renders (digit widths equal) | Playwright |
| Accessibility | 0 critical/serious; 4.5:1 text, 3:1 large text and controls | axe, WCAG 2.2 AA tags |
| Tap targets | every control ≥ 24 × 24 (WCAG 2.5.8); primary actions, card options and the stop control ≥ 44 × 44 (HIG) | bbox scan |
| Headings | one `h1`, no level skip | DOM |
| Measure | every reading column's `max-width` is 60-70 `ch` of its own font | computed style |
| Spacing | ≥ 95 % of margin/padding/gap on the 9-value scale; inter-section gap ≥ 2 × the largest intra-section gap | DOM |
| Cards in cards | 0 | DOM |
| Fold at 390 | landing: H1 + gate sentence + CTA, and the demo card's top edge; card: question + options + default line; home: headline + the first card's options; all `bbox.bottom ≤ 844` | DOM |
| Reduced motion | `getAnimations()` is empty except elements with `data-motion="essential"` (the hold fill, the spinner's text swap) | Playwright |
| Motion budget | no width/height/top/left/margin/padding animation; no `transition: all`; every duration is one of the four tokens; feedback (the first visible change after a click) ≤ 120 ms | `getAnimations()` + grep |
| Web vitals (lab, mobile) | LCP ≤ 2.5 s, CLS ≤ 0.1, TBT ≤ 200 ms; home first paint ≤ 1.5 s | Lighthouse CLI |
| Lighthouse | performance ≥ 80, accessibility ≥ 95, best practices and SEO ≥ 90 | Lighthouse CLI |
| Tokens | computed font, size, weight, colour of `h1`, `body`, the primary button and the receipt row equal `tokens.ts` in both schemes | Playwright |
| Counts | the `02` census: families, sizes, weights, accent fills above the fold, radii, shadows | DOM |
| Copy | banned-word grep = 0; card question regex (verb first, ≤ 15 words, ends "?"); option labels never Yes/No/Approve/Decline alone; "we" / "our" = 0 in app strings | grep |
| Change detector | `toHaveScreenshot` vs n-1, 0.005 | Playwright |

Soft heuristics (reported, not gating): `impeccable detect` on source and on the 390 URL;
`/wig` on changed files; APCA Lc on dark text (≥ 75 body, ≥ 60 display) via a vendored
calculator if its licence is accepted, otherwise axe's ratios only.

## Cheap heuristics on screenshots

| Test | How | Must report |
| --- | --- | --- |
| Squint | `html { filter: blur(8px) }` → `squint.png` | tonal masses (≤ 3) and which is largest |
| Greyscale | `html { filter: grayscale(1) }` | is the primary action and the recommended option identifiable by fill alone? |
| 5-second | `fold.png` alone to a separate judge call: what is it, what does it want, what do you remember? | three answers against the intent sentence |
| First click | `fold.png` + task ("answer this decision"); judge returns coordinates (Zod-parsed); `elementFromPoint` | hit equals the intended control? |
| 3-foot | `fold.png` at 25 % | H1 legible, CTA found? |
| Parity | light fold beside dark fold | same hierarchy order? |
| Remove-one | the fold with the weakest element hidden, beside the original, pairwise in both orders | preferred without it → it was decoration |

## The rubric (the ten principles of `01`, scored 1-10 with evidence)

A score without a crop id, selector, computed value or metric is discarded and the call re-run.
Pass: weighted mean ≥ 8, no principle < 6; Fit, Hierarchy, Restraint and Craft weigh 2×.

| Principle | The critic asks | Evidence | 2 / 5 / 8 / 10 |
| --- | --- | --- | --- |
| Fit | Which sentence of the brief does this element serve? Does the 5-second recall match the intent? | selector + brief line; the 5-second answers | 2: half the fold is unmotivated, recall names decoration. 5: one ornament. 8: every element answers, recall matches. 10: the subject is visible in the choices |
| Hierarchy | In the blurred fold, what reads first, and is it what the user came for? | `squint.png`; size ratio; largest mass | 2: three equal masses. 5: H1 first but a label competes. 8: H1 → action → nothing. 10: H1 and action read as one gesture in both schemes |
| Counted system | How many families, sizes, weights, tones, radii, shadows, accent fills? Same thing, same look across routes? | census; cross-route style diff | 2: seven sizes, five greys. 5: near-duplicates coexist. 8: within `02`, zero drift. 10: landing and app are one product |
| Craft | Edges, gaps, orphans, quotes, `…`, tabular figures, hairlines in dark? | `/wig`; left-edge histogram; gap ratios; heading crops | 2: five or more errors. 5: one or two. 8: none found. 10: invisible because all correct |
| Earned motion | How often is this seen a day? What does the motion explain? | trigger, duration, easing | 2: bounce, blink, marquee. 5: uniform fades. 8: tied to cause, 0 under reduced motion. 10: the signature feels physical |
| Instant acknowledgement | What does the user see at 0, 100 and 1000 ms after a click? | trace ms to DOM change; pressed state; pending state | 2: nothing until the server. 5: spinner only. 8: optimistic ≤ 100 ms, inline failure. 10: instant and reversible |
| Honest copy | Could another product ship this sentence? Does it say what happened and what did not? | string + replacement | 2: generic, apologetic. 5: specific but long. 8: `06` rules met. 10: the read-aloud test passes |
| Back of the drawer | Show me the state nobody asked for | six-state screenshots | 2: states missing or clipped. 5: present, unstyled. 8: designed. 10: the empty state is the best screen |
| Restraint | Remove the weakest element: which version wins the pairwise? | remove-one pairwise result; fold element count | 2: ticker, cursor, strip. 5: two ornaments. 8: the original wins every remove-one. 10: fewer elements than the competitor, more felt |
| Non-default | Which written reason justifies this surviving tell? | catalogue id + `02` line | 2: unjustified tells. 5: justified but unexamined. 8: every tell has a reason. 10: none remain |

## The output (per finding; at most 7 per round; what works comes first)

```
FINDING <n> [Blocker | High | Medium | Nit]
Principle: <name> (score x/10)
Intent of the screen: <the sentence from SCREENS[]>
Evidence: <crop id> | <selector> | <computed value or metric>   (at least one, verbatim)
Violation: <how the evidence contradicts the principle, one sentence>
Fix: <concrete change, file:line or token>
Expected effect: <what the next render's evidence will show>
```

Worked example, today's landing: Fit 3/10 and Restraint 2/10. Evidence
`img:landing-390-dark-fold`: terminal strip, orange ticker, blinking cursor, serif H1, one CTA;
5-second recall "a hacker product for developers"; impeccable advisories for marquee and
blinking cursor. Violation: the fold tells "software" and names decoration, not the promise.
Fix: delete strip, ticker and cursor; hero = H1, gate sentence, CTA, then a real brief with one
pending card in the app's components; accent used nowhere above the fold. Expected: detector 0;
recall contains "brief" or "decide"; squint shows two masses and one dark control.

Worked example, today's card at 390: Hierarchy 4/10. Evidence `img:card-390-light-squint`: three
equal masses; in greyscale the recommended option differs only by "★"; `.deadline-line`
`bbox.top` 912 > 844; options 36 px. Fix: question first; rationale in a closed "Why"; the
recommended option the single ink-filled control at ≥ 44 px, labelled "Recommended"; default line
directly under the options. Expected: one mass and one dark control; greyscale separates by
fill; default line inside the fold; first click lands on the recommended option.

## Bias controls

Pairwise swapped and agreeing; chain of thought with evidence before each number; the judge
never sees the builder's explanation; a different subagent (ideally a different model) that
never grades its own fixes; a founder-scored calibration set with the nearest examples per call;
two held-out principles per round unknown to the builder; the 5-second wording rotates; the
founder blind-scores one screen every fifth iteration and at every stop, and a disagreement over
two points rewrites that anchor; coordinates, not grids, for localisation.

## Stop rules

Ship when all gates pass in the five projects, the weighted mean is ≥ 8 with nothing under 6,
and the pairwise judge prefers n once in both orders and then ties. Keep every iteration so a
middle one can be chosen. Escalate after three rounds without a pairwise win, at iteration 12,
or at $25 for the screen: hand over the last three folds with the critique. Refine when the
lowest scores are execution-level (Craft, Counted system, Earned motion); pivot when, after
three rounds, the lowest is direction-level (Fit, Hierarchy, Restraint) or the 5-second recall is
still wrong: restart from the intent sentence with a different structure, one pivot per screen.
A fix that loses the pairwise is reverted.
