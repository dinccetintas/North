# 07 · Verification: how the agent proves "not good yet, because X"

Evidence base: Anthropic's harness post (self-evaluation skews positive; a skeptical standalone
evaluator is tractable; "does this follow our principles?" beats "is this beautiful?"; few-shot
score breakdowns reduce drift; 5-15 rounds; complexity creeps; the author sometimes preferred a
middle iteration). Zheng et al. 2023 (position, verbosity and self-enhancement bias; swap and
agree; chain of thought). UICrit 2024 (zero-shot VLM critique 0.31 against human 0.75; nearest
few-shot examples plus coordinates 0.48; critique and locate as separate calls). Connor &
Irizarry (critique is evaluating a design against its goals; the rest is reaction).

## The loop (execute verbatim per screen)

Setup once: `pnpm add -D -w @axe-core/playwright lighthouse`; `apps/web/e2e/critic/{render,gates,
heuristics}.spec.ts`; a Playwright project `critic-desktop` (1440 × 900) beside `mobile`
(390 × 844); Vercel's `command.md` vendored as `.claude/commands/wig.md`; `.critic/` git-ignored,
every iteration kept at `.critic/<screen>/<n>/`.

1. **Intent.** Write the screen's one-sentence intent (from `04`) into `SCREENS[]` before any pixel.
2. **Build production.** `pnpm --filter @north/web build && pnpm --filter @north/web start`
   on :3100. Dev mode lies about LCP, fonts and CLS.
3. **Render.** Each route × {390 × 844, 1440 × 900} × {light, dark} × {motion, reduced}; wait
   `document.fonts.ready` and network idle; move the mouse off-screen; save `fold.png`,
   `full.png`, the DOM facts JSON and the heuristic variants.
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
every edit and the full loop only when gates pass. A screen converges in 1-3 hours under $20.

## Deterministic gates (pass/fail at 390 and 1440, light and dark)

| Gate | Threshold | Tool |
| --- | --- | --- |
| Overflow | `scrollWidth ≤ innerWidth` | Playwright |
| Console | 0 errors, 0 hydration mismatches | Playwright |
| Fonts | `document.fonts.check()` true for every declared family | Playwright |
| Accessibility | 0 critical/serious; 4.5:1 text, 3:1 large text and controls | axe, WCAG 2.2 AA tags |
| Dark contrast | APCA Lc ≥ 75 body, ≥ 60 display, ≥ 45 labels | apca-w3 on computed colours |
| Tap targets | all controls ≥ 24 px; primary actions, card options, stop control ≥ 44 px | bbox scan |
| Headings | one `h1`, no level skip | DOM |
| Line length | every `p` 45-75 characters | DOM |
| Spacing | ≥ 95 % of margin/padding/gap on the 8-value scale | DOM |
| Cards in cards | 0 | DOM |
| Fold at 390 | landing: H1 + CTA; card: question + options + default line; home: headline + first card, all `bbox.bottom ≤ 844` | DOM |
| Reduced motion | `getAnimations().length === 0` except `[data-motion="essential"]` | Playwright |
| Motion budget | no width/height/top/left/margin/padding animation; no `transition: all`; feedback ≤ 200 ms | `getAnimations()` + `/wig` |
| Web vitals (lab, mobile) | LCP ≤ 2.5 s, CLS ≤ 0.1, TBT ≤ 200 ms; home ≤ 1.5 s | Lighthouse CLI |
| Lighthouse | performance ≥ 80, accessibility ≥ 95, best practices and SEO ≥ 90 | Lighthouse CLI |
| Slop detector | `npx impeccable detect apps/web/src --json` and `… detect http://localhost:3100 --viewport 390x844 --json` exit 0; advisories go to the critic | impeccable (58 rules) |
| Code guidelines | `/wig` on changed files: 0 findings in accessibility, focus, forms, animation, typography | Vercel web-interface-guidelines |
| Tokens | computed font, size, tracking and colour of `h1`, `body`, the primary button and the mono label equal `tokens.json` in both schemes | Playwright vs JSON |
| Counts | the `02` census: families, sizes, accent fills above the fold, radii, shadows | DOM |
| Copy | banned-word grep = 0; card question regex; option labels never Yes/No alone; "we/our" = 0 | grep |
| Change detector | `toHaveScreenshot` vs n-1, 0.005 | Playwright |

## Cheap heuristics on screenshots

| Test | How | Must report |
| --- | --- | --- |
| Squint | `html { filter: blur(8px) }` → `squint.png` | tonal masses (≤ 3) and which is largest |
| Greyscale | `html { filter: grayscale(1) }` | is the primary action and the recommended option identifiable by fill alone? |
| 5-second | `fold.png` alone to a separate judge call: what is it, what does it want, what do you remember? | three answers against the intent sentence |
| First click | `fold.png` + task ("answer this decision"); judge returns coordinates; `elementFromPoint` | hit equals the intended control? |
| 3-foot | `fold.png` at 25 % | H1 legible, CTA found? |
| Parity | light fold beside dark fold | same hierarchy order? |

## The rubric (the ten principles of `01`, scored 1-10 with evidence)

A score without a crop id, selector, computed value or metric is discarded and the call re-run.
Pass: weighted mean ≥ 8, no principle < 6; Fit, Hierarchy, Restraint and Craft weigh 2×.

| Principle | The critic asks | Evidence | 2 / 5 / 8 / 10 |
| --- | --- | --- | --- |
| Fit | Which sentence of the brief does this element serve? | selector + brief line | 2: half the fold is unmotivated. 5: one ornament. 8: every element answers. 10: the subject is visible in the choices |
| Hierarchy | In the blurred fold, what reads first, and is it what the user came for? | `squint.png`; size ratio; largest mass | 2: three equal masses. 5: H1 first but a label competes. 8: H1 → action → nothing. 10: H1 and action read as one gesture in both schemes |
| Counted system | How many families, sizes, tones, radii, shadows, accent fills? Same thing, same look across routes? | census; cross-route style diff | 2: seven sizes, five greys. 5: near-duplicates coexist. 8: within `02`, zero drift. 10: landing and app are one product |
| Craft | Edges, gaps, orphans, quotes, `…`, tabular numerals, hairlines in dark? | `/wig`; left-edge histogram; gap ratios; heading crops | 2: five or more errors. 5: one or two. 8: none found. 10: invisible because all correct |
| Earned motion | How often is this seen a day? What does the motion explain? | trigger, duration, easing | 2: bounce, blink, marquee. 5: uniform fades. 8: tied to cause, 0 under reduced motion. 10: the signature feels physical |
| Instant acknowledgement | What does the user see at 0, 100 and 1000 ms after a click? | trace ms to DOM change; `:active`; pending state | 2: nothing until the server. 5: spinner only. 8: optimistic ≤ 100 ms, inline failure. 10: instant and reversible |
| Honest copy | Could another product ship this sentence? Does it say what happened and what did not? | string + replacement | 2: generic, apologetic. 5: specific but long. 8: `06` rules met. 10: the read-aloud test passes |
| Back of the drawer | Show me the state nobody asked for | six-state screenshots | 2: states missing or clipped. 5: present, unstyled. 8: designed. 10: the empty state is the best screen |
| Restraint | Delete the weakest element; what was lost? | before/after crop; fold element count | 2: ticker, cursor, strip. 5: two ornaments. 8: zero. 10: fewer elements than the competitor, more felt |
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

Worked example, today's landing: Principle Fit 3/10 and Restraint 2/10. Evidence
`img:landing-390-dark-fold`: terminal strip, orange ticker, blinking cursor, serif H1, one CTA;
5-second recall "a hacker product for developers"; impeccable primary findings for marquee and
blinking cursor. Violation: the fold tells "software" and names decoration, not the promise.
Fix: delete strip, ticker and cursor; hero = a real brief with one pending card under it, in the
app's components; H1 above, CTA below; accent used once. Expected: detector 0; recall contains
"brief" or "decide"; squint shows two masses and one bright spot.

Worked example, today's card at 390: Hierarchy 4/10. Evidence `img:card-390-light-squint`: three
equal masses; in greyscale the recommended option differs only by "★"; `.deadline-line`
`bbox.top` 912 > 844; options 36 px. Fix: question first; rationale in a closed "Why"; the
recommended option the single filled control at ≥ 44 px; default line directly under the
options. Expected: one mass and one bright spot; greyscale separates by fill; default line inside
the fold; first click lands on the recommended option.

## Bias controls

Pairwise swapped and agreeing; chain of thought with evidence before each number; the judge
never sees the builder's explanation; a different subagent (ideally a different model) that
never grades its own fixes; a founder-scored calibration set with the nearest examples per call;
two held-out principles per round unknown to the builder; the 5-second wording rotates; the
founder blind-scores one screen every fifth iteration and at every stop, and a disagreement over
two points rewrites that anchor; coordinates, not grids, for localisation.

## Stop rules

Ship when all gates pass in four renders, the weighted mean is ≥ 8 with nothing under 6, and the
pairwise judge prefers n once in both orders and then ties. Keep every iteration so a middle one
can be chosen. Escalate after three rounds without a pairwise win, at iteration 12, or at $25 for
the screen: hand over the last three folds with the critique. Refine when the lowest scores are
execution-level (Craft, Counted system, Earned motion); pivot when, after three rounds, the
lowest is direction-level (Fit, Hierarchy, Restraint) or the 5-second recall is still wrong: restart
from the intent sentence with a different structure, one pivot per screen. A fix that loses the
pairwise is reverted.
