# 05 — The verification layer: how the front-end agent proves "this is not good yet, because X"

Extends `docs/research/dept-design-frontend.md` §2.4 (gates + LLM scores). Added here: the executable loop, the principle rubric with anchors, the critique format, judge-bias controls, stop rules.

## 0. Evidence in one paragraph

Anthropic's harness post: self-evaluation "skewed positive"; even a separate evaluator was generous; "out of the box, Claude is a poor QA agent". What worked: "does this follow our principles?" instead of "is this beautiful?", few-shot score breakdowns ("reduced score drift"), Playwright screenshots of the live page, refine-or-pivot each round, 5-15 rounds; warnings: "complexity tended to rise across rounds", the author "sometimes preferred a middle iteration". Zheng et al.: position bias (GPT-4 consistent in 65% of swapped pairs, 77.5% with few-shot), verbosity and self-enhancement bias; fixes are swap-and-agree, few-shot, chain-of-thought, reference-guided grading. UICrit (983 mobile UIs, 3,059 expert critiques with boxes): zero-shot VLM critique 0.31 vs human 0.75; similarity-chosen few-shot plus coordinate region prompts 0.48 (+55%); separate "critique" and "locate" calls. Claude Code best practices: "give Claude a check it can run", "show evidence rather than asserting success", grade in a fresh subagent, and "a reviewer prompted to find gaps will usually report some". Connor & Irizarry: critique is "evaluating a design against its goals"; the rest is reaction. Below: these findings as code.

## 1. The loop (a fresh agent executes this verbatim)

Setup once: `pnpm add -D -w @axe-core/playwright lighthouse`; create `apps/web/e2e/critic/{render,gates,heuristics}.spec.ts`; add Playwright project `critic-desktop` (1440x900) beside `mobile` (390x844); copy Vercel's `command.md` to `.claude/commands/wig.md`; git-ignore `.critic/`, keep every iteration at `.critic/<screen>/<n>/`.

1. **Build production.** `pnpm --filter @north/web build && pnpm --filter @north/web start` (port 3100). Dev mode lies about LCP, fonts and CLS.
2. **Render.** `pnpm --filter @north/web exec playwright test e2e/critic/render.spec.ts`: each route in `SCREENS` (landing, login, home, decision card, team, ledger, settings) × {390x844, 1440x900} × `emulateMedia({colorScheme})`; wait `document.fonts.ready` + `networkidle`, `page.mouse.move(-1,-1)`; save `fold.png`, `full.png`, DOM-facts JSON and the §5 variants as `<route>-<vp>-<scheme>-<variant>.png`.
3. **Deterministic gates** (§4) → `gates.json` with pass/fail, selector and bbox per rule. Any FAIL → step 7, no LLM call. Code decides; the model never argues with a gate.
4. **Heuristic screenshot tests** (§5); each yields one line the critic must quote.
5. **Principle-named critique** by a fresh subagent (`north-qa-validator`, never the builder's context): rubric (§2), template (§3), DOM facts, 8 images first, labelled `Image 1:`…. Call (a): absolute scores with evidence. Call (b): pairwise vs `n-1`, run twice with A/B swapped; a win needs both orders to agree, else tie.
6. **Decide refine / pivot / stop** (§7); write `decision.md`.
7. **Fix** Blocker/High only; expected effect written before editing; one fix per commit.
8. **Re-run from 1.** `toHaveScreenshot` against `n-1` with `maxDiffPixelRatio: 0.005`: a diff under 0.5% after a claimed visible fix is logged "no-op iteration" (usually a class Tailwind v4 purged or dark mode overrode).

Cost per loop (vision tokens `ceil(w/28)×ceil(h/28)`: 390x844 = 434, 1440x900 = 1,716, a 390x3000 full page ≈ 1,100 downscaled): 12 images ≈ 13k tokens, rubric + DOM facts ≈ 6k, three judge calls ≈ 50k in / 6k out ≈ $0.15-0.30; with builder tokens $0.50-2 and 6-15 min (build 90 s, render + gates 60 s, Lighthouse 50 s, critique 90 s, fix 3-10 min). Steps 1-4 alone are free and take 3 min: run them after every edit, the full loop only when gates pass. At 5-15 rounds a screen converges in 1-3 h for under $20.

## 2. The rubric (12 taste principles; correctness lives in §4)

Integer 1-10 per principle; evidence mandatory (crop id such as `img:landing-390-dark-fold`, selector, computed style or metric); a score without evidence is discarded and the call re-run. Anchors are few-shot descriptions; keep 3-5 founder-scored North screenshots per principle in `.critic/calibration/` and include the 2-3 visually nearest per call (UICrit). Pass: weighted mean ≥ 8, no principle < 6; Hierarchy, Intent, Restraint, Craft weigh 2× (North's current UI is already distinctive and under-crafted, the inverse of the harness post's case).

| # | Principle: definition | Critic's question | Evidence | 2 / 5 / 8 / 10 | Typical fix |
|---|---|---|---|---|---|
| 1 | **Hierarchy**: one thing first, one second, the rest recedes | In the blurred fold, what reads first, and is it what the user came for? | `squint.png`; h1/body size ratio; bbox of largest mass | 2: three equal masses. 5: H1 first but CTA and a label compete. 8: H1 → CTA → nothing. 10: H1 and CTA read as one gesture in both schemes | Demote one size and one tone step; delete the third thing |
| 2 | **Rhythm**: spacing is a scale, repeated | Do gaps come from the 4/8-pt scale and repeat between siblings? | % of computed margin/padding/gap on scale | 2: ad-hoc values. 5: scale exists, section gaps vary. 8: ≥95% on scale, section gap = 2× element gap. 10: spacing alone marks sections | Replace arbitrary values with tokens; one `--space-section` |
| 3 | **Contrast (typographic)**: differences are large enough to be intended | Is each size/weight/tone step ≥ 1.25×, or do near-duplicates coexist? | distinct font-sizes and text colors in use | 2: 7 sizes, 5 greys. 5: 14/15/16 px coexist. 8: ≤5 sizes, ≤3 tones. 10: display/body/label unmistakable at 390 | Collapse near-duplicates to tokens |
| 4 | **Alignment**: edges share lines | How many left edges in the fold? | histogram of `bbox.left` of text nodes | 2: >6. 5: 4-5, icons off-grid. 8: ≤3 with optical alignment. 10: one axis, indents mean something | Single container; `pl-0` lists; optical icon offset |
| 5 | **Proximity**: related things sit closer than unrelated | Is intra-group gap < inter-group gap everywhere? | measured gaps per section | 2: labels equidistant from both neighbours. 5: headers nearer the previous block. 8: inter ≥ 2× intra. 10: grouping legible without borders | Remove borders; fix gap ratios |
| 6 | **Consistency**: same thing, same look | Are primary button, mono label and card identical across landing, home, card, settings? | computed-style diff across routes and schemes | 2: each screen reinvents. 5: 2-3 drifts. 8: zero drift. 10: landing and app are one product | Tokens in `globals.css`; delete local overrides |
| 7 | **Affordance**: clickable looks clickable, primary looks primary | In greyscale, can a stranger pick the recommended option? | `grey.png`; option fills/borders; states | 2: identical except a glyph. 5: fill differs, hover/pressed don't. 8: one filled, rest outlined, all states, ≥44 px. 10: pressed state feels mechanical | One accent fill per view; outline secondaries |
| 8 | **Feedback**: every action answers ≤ 200 ms | After each click, what changed and when? | trace: ms click → DOM/aria-live change | 2: nothing until the server. 5: spinner only. 8: optimistic ≤100 ms, failure reverts with inline message. 10: instant and reversible | Optimistic UI + `aria-live="polite"` + revert |
| 9 | **Restraint**: nothing decorative | What can be deleted without losing a decision or a feeling? | fold element count; Impeccable advisories | 2: ticker, cursor, strip, gradients. 5: two ornaments remain. 8: zero ornaments. 10: fewer elements than Polsia, more felt | Delete; replace ornament with real content |
| 10 | **Intent**: the screen argues one thing | What does the fold want me to feel and do, in one sentence? Does the 5-second recall match? | 5-second answer vs intent sentence | 2: recall "terminal/hacker". 5: "AI tool for founders". 8: "my staff did the work; I decide". 10: recall equals the intent sentence | Rewrite H1/sub to the intent; put the real artifact in the hero |
| 11 | **Craft**: details are finished | Orphans, `...` vs `…`, straight quotes, icon optical size, `text-wrap`, hairlines in dark? | `/wig` output; text scan; heading crops | 2: 5+ errors. 5: 1-2. 8: none found by `/wig`, Impeccable or crops. 10: invisible because all correct | `text-balance`/`text-pretty`, typographic characters, `tabular-nums` |
| 12 | **Motion**: movement explains state | Does each animation show where something came from, ≤200 ms, transform/opacity only? | `getAnimations()` list; reduced-motion run | 2: bounce, blink, marquee. 5: uniform 300 ms fades. 8: tied to cause, 0 under reduced motion. 10: one signature interaction (card answer) feels physical | Remove all, then add one purposeful transition |

## 3. The "why it's not good" output

Per finding, Blocker → High → Medium → Nit, max 7 per round (cap the gap-hunter). The report opens with what works (critique against goals, not reaction).

```
FINDING <n> [Blocker|High|Medium|Nit]
Principle: <§2 name> (score x/10)
Intent of the screen: <the builder's one sentence, written before building>
Evidence: <crop id> | <selector> | <computed value / metric>   (at least one, verbatim)
Violation: <how the evidence contradicts the principle, one sentence>
Fix: <concrete change, file:line or token>
Expected effect: <what the next render's evidence will show>
```

**A — current landing (brief).**
```
FINDING 1 [Blocker]  Principle: Intent (3/10)
Intent: "My staff already did the work; I only decide." Convert a technical builder in 60 s.
Evidence: img:landing-390-dark-fold: terminal strip, orange ticker, blinking cursor, serif H1, one CTA.
5-second recall: "a hacker/terminal product for developers". Impeccable URL scan 390x844: primary
findings for marquee scroller and blinking terminal cursor (rules added in cli-v3.3.0).
Violation: The fold tells "software" when the ask is "less telling, more feeling"; recall names the
decoration, not the promise.
Fix: Delete strip, ticker, cursor. Hero = a real 200-word morning brief in Newsreader with one pending
card under it; H1 above, CTA below; accent used once (CTA).
Expected effect: Impeccable primary findings 0; recall contains "brief" or "decide"; squint.png shows
two masses (H1, brief) and one bright spot (CTA); Restraint ≥ 8.
```

**B — decision card at 390.**
```
FINDING 1 [High]  Principle: Hierarchy (4/10), Affordance (4/10)
Intent: Answer in under 10 s with confidence and know what happens if I don't.
Evidence: img:card-390-light-squint: three equal masses (question, rationale+facts, options).
img:card-390-light-grey: option fills identical; recommended differs only by "★".
DOM: ".deadline-line" bbox.top 912 px (> 844); option height 36 px (< 44).
Violation: The decision is not first, the recommendation is not visibly primary, the safe default is
below the fold.
Fix: Question first (serif 2xl); rationale + facts in a closed "Why" disclosure; recommended option is
the single accent-filled button, others outlined, all ≥ 44 px; deadline line directly under options;
tier + cost/due in one mono line on top.
Expected effect: squint = one mass + one bright spot; grey separates the recommended option by fill;
".deadline-line" bbox.bottom ≤ 844; tap-target gate passes; first-click lands on the recommended option.
```

## 4. Deterministic gates (pass/fail at 390 and 1440, light and dark)

| Gate | Threshold | Tool |
|---|---|---|
| Overflow | `documentElement.scrollWidth <= innerWidth` | Playwright evaluate |
| Console | 0 errors, 0 hydration mismatches | `page.on('console'/'pageerror')` |
| Fonts | `document.fonts.check()` true for Instrument Serif, Newsreader, Geist Mono after `fonts.ready` | Playwright |
| Accessibility | 0 critical/serious; contrast 4.5:1 text, 3:1 large (≥24 px / 18.5 px bold) and UI (WCAG 1.4.3 / 1.4.11) | `@axe-core/playwright` `withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa'])` |
| Dark-mode contrast | APCA Lc ≥ 75 body, ≥ 60 display ≥24 px, ≥ 45 labels, never < 30 | `apca-w3` on computed colors |
| Tap targets | all `a,button,[role=button],input,select,textarea` ≥ 24x24 (WCAG 2.5.8); primary actions, card options, kill switch ≥ 44x44 (Apple HIG) | bbox scan |
| Headings | one `h1`, no level skip | DOM scan |
| Line length | every `p` 45-75 chars/line (width ÷ 0.5·font-size) | DOM scan |
| Spacing | ≥ 95% of margin/padding/gap ∈ {0,2,4,8,12,16,24,32,48,64,96} | DOM scan |
| Cards in cards | 0 border+radius+padding elements nested in another | DOM scan |
| Fold at 390 | landing: H1 + CTA; card: question + options + deadline line; home: brief + first card, all `bbox.bottom ≤ 844` | DOM scan |
| Reduced motion | `emulateMedia({reducedMotion:'reduce'})` → `getAnimations().length === 0` except `[data-motion="essential"]` | Playwright |
| Motion budget | no animation of width/height/top/left/margin/padding; no `transition: all`; feedback ≤ 200 ms | `getAnimations()` + `/wig` |
| Web Vitals (lab, mobile) | LCP ≤ 2.5 s, CLS ≤ 0.1, TBT ≤ 200 ms; home TTI ≤ 1.5 s | `npx lighthouse http://localhost:3100/<route> --form-factor=mobile --output=json --chrome-flags="--headless=new" --only-categories=performance,accessibility,best-practices,seo` |
| Lighthouse | perf ≥ 80 mobile, a11y ≥ 95, BP/SEO ≥ 90 | same |
| AI-slop | `npx impeccable detect apps/web/src --json` and `npx impeccable detect http://localhost:3100 --viewport 390x844 --json` exit 0 (advisories passed to the critic) | Impeccable (58 rules: glow halos, gradient text, marquee, blinking cursor, text under overlay, first-viewport overflow…) |
| Code guidelines | `/wig` on changed files: 0 findings in Accessibility, Focus, Forms, Animation, Typography | Vercel web-interface-guidelines (`file:line`) |
| Tokens | computed font/size/tracking/color of `h1`, `body`, `button[data-primary]`, mono label equal `tokens.json` in both schemes | Playwright vs JSON |
| Change detector | `toHaveScreenshot` vs `n-1`, `maxDiffPixelRatio 0.005` → "no-op" flag (baselines only from the same container) | Playwright |

## 5. Cheap heuristic tests on screenshots

| Test | How | Must report |
|---|---|---|
| Squint | `page.addStyleTag({content:'html{filter:blur(8px)}'})` → `squint.png` | number of tonal masses (≤ 3) and which is largest |
| Greyscale | `html{filter:grayscale(1)}` → `grey.png` | primary action and recommended option identifiable by fill? |
| 5-second | `fold.png` alone to a separate judge call: "Seen for 5 s: what is it, what does it want, what do you remember?" | three answers vs the intent sentence |
| First-click | `fold.png` + task ("answer this decision"); judge returns coordinates; `elementFromPoint` maps to element | hit == intended control? (right first click → 87% completion vs 46%) |
| 3-foot | `fold.png` downscaled to 25% | H1 legible, CTA found? |
| Dark/light parity | `light-fold` beside `dark-fold` | same hierarchy order? (inversion flips hairlines and accent weight) |

## 6. Bias mitigations for the judge

- **Position bias:** pairwise run twice, A/B swapped, win only on agreement (Zheng et al.; WiserUI-Bench/G-FOCUS shows the same bias on UI pairs).
- **Generosity:** chain-of-thought with evidence before each number (G-Eval form-filling); judge prompted as skeptic; pass/fail belongs to code (harness post: a skeptical standalone evaluator is "far more tractable").
- **Verbosity / complexity creep:** judge sees renders and DOM facts, never the builder's explanation; fold element count is logged and rising count with flat scores is a Restraint finding.
- **Self-enhancement:** critic is a different subagent (ideally a different model) and never grades its own fixes.
- **Drift:** founder-scored calibration set, nearest examples by visual similarity (UICrit; harness post).
- **Goodhart:** two principles held out per round, unknown to the builder; the 5-second question wording rotates; every 5th iteration and at stop the founder blind-scores one screen, and a > 2-point disagreement rewrites that anchor.
- **Localization:** ask for coordinates, not grids (UICrit: 0.186 IoU vs ≈ 0); critique and localization in separate calls.

## 7. Stop rules; refine vs pivot

- **Ship:** all gates PASS in 4 renders, weighted mean ≥ 8, no principle < 6, and the pairwise judge prefers `n` in both orders once and then ties (high plateau). Keep every iteration so the founder can pick a middle one.
- **Escalate:** 3 rounds without a pairwise win, iteration 12, or $25 for the screen → hand the founder the last three folds with the critique; stop polishing.
- **Refine** when the lowest scores are execution-level (Rhythm, Alignment, Craft, Motion, Consistency).
- **Pivot** when after 3 rounds the lowest score is direction-level (Intent, Hierarchy, Restraint) or 5-second recall is still wrong: restart from the intent sentence with a different structure; one pivot per screen, counter resets.
- A fix that loses the pairwise is `git revert`ed (one fix per commit).

## 8. What North should do (testable)

1. Every screen has a one-sentence intent in `SCREENS[]` before any pixel; the critic quotes it.
2. No LLM critique until `gates.json` is all PASS on production builds; build the gate script first.
3. Render matrix: 390x844 and 1440x900 × light and dark × reduced motion; dark is scored on its own renders.
4. The critic is `north-qa-validator` in a fresh context; the builder never scores itself.
5. Every score carries a crop id, selector or metric, or it is discarded.
6. Pairwise judgments are swapped and must agree; ties are logged as ties.
7. Pass = weighted mean ≥ 8, no principle < 6; Hierarchy, Intent, Restraint, Craft weigh 2×.
8. Max 7 findings per round; only Blocker/High are fixed before the stop round; one fix per commit; a pairwise loss is reverted.
9. ≥ 3 founder-scored screenshots per principle in `.critic/calibration/`; the founder blind-scores one screen every 5 iterations and at every stop; a > 2-point disagreement rewrites the anchor.
10. Two held-out principles per round; rotating 5-second wording.
11. Impeccable exit 0 on source and on the 390 URL scan; cursor, ticker and gradients gone before any critique.
12. `/wig` zero findings in Accessibility, Focus, Forms, Animation, Typography on changed files.
13. Tap targets ≥ 24 px everywhere; ≥ 44 px for primary actions, card options and the kill switch.
14. Fold at 390: landing H1 + CTA; card question + options + deadline line; home brief + first card.
15. ≤ 5 font sizes, ≤ 3 text tones, ≤ 3 left edges per fold; ≥ 95% of spacing on scale.
16. The recommended option is distinguishable in greyscale by fill alone.
17. Every click shows an optimistic state ≤ 100 ms and an inline failure message; `aria-live="polite"` on async results.
18. Zero animations under reduced motion; otherwise transform/opacity only, ≤ 200 ms feedback.
19. Lab LCP ≤ 2.5 s, CLS ≤ 0.1, TBT ≤ 200 ms on every route; home ≤ 1.5 s.
20. Stop at plateau; never exceed 12 iterations or $25 per screen without the founder.

## Sources

- https://www.anthropic.com/engineering/harness-design-long-running-apps — evaluator loop, few-shot drift control, refine/pivot, 5-15 rounds, "poor QA agent", complexity creep, $9 vs $124-200.
- https://code.claude.com/docs/en/best-practices — a check Claude can run; screenshot-and-compare; fresh verifying subagent; show evidence; reviewers over-report.
- https://www.anthropic.com/engineering/building-effective-agents — evaluator-optimizer fits when criteria are clear.
- https://platform.claude.com/docs/en/build-with-claude/vision — `ceil(w/28)×ceil(h/28)` tokens; 2576 px / 4,784-token cap; images before text.
- https://arxiv.org/html/2306.05685v4 — Zheng et al.: position bias 65%→77.5%, verbosity, self-enhancement, swap-and-agree, CoT, reference-guided.
- https://arxiv.org/html/2407.08850 — UICrit: 0.31 → 0.48 vs human 0.75; similarity-sampled few-shot; coordinates over grids; prompt chaining.
- https://arxiv.org/abs/2303.16634 — G-Eval: CoT + form-filling evaluation.
- https://arxiv.org/abs/2505.05026v1 — WiserUI-Bench / G-FOCUS: position bias in VLM pairwise UI judging.
- https://impeccable.style/docs/detector — `impeccable detect` CLI, URL mode, `--viewport`, exit codes, advisories.
- https://newreleases.io/project/github/pbakaus/impeccable/release/cli-v3.3.0 — 58 rules; marquee, blinking cursor, glow, text-under-overlay rules.
- https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md — rule categories; `file:line` output.
- https://raw.githubusercontent.com/ibelick/ui-skills/main/skills/baseline-ui/SKILL.md — compositor-only motion, ≤200 ms, one accent, violation→why→fix.
- https://playwright.dev/docs/test-snapshots — `toHaveScreenshot` options, baselines, same-environment warning.
- https://playwright.dev/docs/accessibility-testing — `@axe-core/playwright` with WCAG tags.
- https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html — SC 2.5.8, 24x24 px.
- https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html — 4.5:1 / 3:1 and large-text definition.
- https://github.com/Myndex/apca-w3 — APCA Lc scale and floors.
- https://web.dev/articles/vitals — LCP 2.5 s, INP 200 ms, CLS 0.1 at p75.
- https://measuringu.com/first-click/ — 87% vs 46% completion by first click.
- https://www.designative.info/2025/07/03/book-review-discussing-design-by-adam-connor-aaron-irizarry/ — critique vs reaction; goals, context, principles, rationale.
- https://sketchplanations.com/the-blur-your-eyes-test — blur test for hierarchy.
- https://github.com/GoogleChrome/lighthouse/blob/main/docs/readme.md — Lighthouse CLI/Node flags.
