# 01 — Taste theorist: what taste is, why Apple feels premium, what slop is, how to give an AI taste

## 1. Definition of taste (defensible)

Taste is the trained ability to make, and to recognise, choices *motivated by the specific problem* rather than by habit, fashion or the statistical default, whose aggregate the user feels as ease and care without being able to point at any one of them. Three sources carry this. Paul Graham (*Taste for Makers*): taste is not preference, because people demonstrably get better at it; good design is simple, solves the right problem, looks easy, often redesigned, and its unseen details "combine to produce something that's just stunning, like a thousand barely audible voices all singing in tune." Rams (principle 10, via Vitsœ): "as little design as possible ... less, but better — because it concentrates on the essential aspects." Reber, Schwarz & Winkielman (2004, *PSPR* 8:364-382): beauty is largely *processing fluency* — the more easily a perceiver processes an object (symmetry, figure-ground contrast, prototypicality, repetition), the more positive the aesthetic response. So taste has an objective core (fluency, fit) and a trained layer (knowing which default to refuse). Practitioner opinion (Freiberg, Kowalski, Saarinen): "it feels nice" is not an explanation; "there must be a reason" is what makes taste transferable — and therefore the only form of taste an AI can be given.

## 2. Why Apple feels premium — mechanisms, evidence, North translation

1. **Fluency, not features.** Reber et al. 2004: ease of processing is read as beauty. Apple screens: few elements, strong figure-ground, one typeface. *North:* every screen summarisable in one sentence; ≤3 type sizes per screen; one accent.
2. **Instant feedback (<100 ms) makes the object feel solid.** Nielsen's 0.1/1/10 s limits; Doherty & Thadani 1982 (IBM Systems Journal): productivity jumps under 400 ms because users stop holding state in working memory. Apple's press states, haptics and interruptible springs acknowledge in <100 ms. *North:* every control shows a visual state change within one frame of pointerdown; optimistic UI for card answers; nothing beyond 1 s without an explicit "working" state.
3. **First impression is decided in 50 ms and rarely revised.** Lindgaard et al. 2006 (*Behaviour & IT*): visual-appeal judgments at 50 ms correlate with judgments after long exposure. Kurosu & Kashimura 1995 (252 participants, 26 ATM layouts): perceived usability tracks aesthetic rating more than actual usability (aesthetic-usability effect, NN/g). Fogg 2002 (2,684 participants, 100 sites): 46.1 % of credibility comments cite "design look". *North:* the landing's first viewport and the home screen's first paint are the two surfaces where polish is non-negotiable; test them as still images.
4. **Care is legible.** Ive (TIME 2014): people "do care about things that are thoughtfully conceived and well made"; Apple's success is "giving a damn". Finishing the back of the drawer (cable packaging, unseen edges) is the mechanism: users infer global care from local care. *North:* the unloved surfaces — empty states, error copy, the 404, the kill-switch confirmation, the offline brief — get the same budget as the hero.
5. **Restraint signals confidence (luxury codes).** Kapferer & Bastien, *The Luxury Strategy*: luxury does not respond to rising demand, does not compare itself, does not pander. Apple pages do not show competitor tables or ten CTAs. *North:* one CTA on the landing, no comparison tables, no urgency banners, no "AI-powered" badges.
6. **Motion obeys frequency.** Rauno Freiberg, *Invisible Details of Interaction Design*: "it does start to feel more like cognitive burden after seeing the same animation for the hundredth time"; Apple animates the rare (app launch from its icon = spatial consistency) and not the frequent (keyboard). Kowalski's framework: 100+/day → no animation; occasional → 150-300 ms ease-out. *North:* answering a card (≤3/day) may have a considered reveal; opening the Ledger (many/day) must not.
7. **Emotion at three levels.** Norman, *Emotional Design*: visceral (first look), behavioral (use), reflective (what owning it says about me). Apple's reflective layer is strongest: the product flatters the owner. *North:* reflective message = "I run a company; my staff is software"; brief, ledger and Team page must make the user look like a CEO, not a prompt engineer.
8. **"Design is how it works."** Jobs, NYT Magazine 2003 (Rob Walker): "Design is not just what it looks like and feels like. Design is how it works." Premium feel collapses when the thing is slow or wrong. *North:* the performance budgets (home 1.5 s, answer in queue 2 s) are design rules, and a missed budget is a design failure.
9. **Constraint as identity.** Teenage Engineering (Kouthoofd, SFMOMA interview): "I set up restrictions when I design" — simple geometry, a 40-colour RAL palette, German industrial standards. Rams/Braun did the same with a grid and two materials. *North:* a token system with hard counts (see §6) is the identity; freedom lives in content, not in chrome.
10. **Data-ink.** Tufte: erase non-data-ink; a chart that "purveys Graphical Style rather than quantitative information" is a duck. *North:* ledger and goal progress show numbers and deltas with no decorative gridlines, gradients or icon tiles.

## 3. AI slop catalogue (each with a detectable test)

Slop is not ugliness; it is *fluent default* — the model returning the median of its training data (uxdesign.cc). Anthropic's frontend-design skill lists five convergence clusters; impeccable ships 59 deterministic detectors. **The current North system matches Anthropic's clusters 3 and 5 almost verbatim** (serif display, hairline rules, zero radius, mono small-caps labels, tinted near-black, terminal strip, blinking cursor, ticker). Each must be re-justified or dropped (§6).

**Type**
- Inter/Geist/system as the only face. Test: computed `font-family` of body ∈ {Inter, Geist, system-ui, Arial} with no second face → fail (impeccable `overused-font`).
- Tracked-out ALL-CAPS eyebrow above every heading; "WORD — fragment" labels; middle-dot meta strings. Test: count of `text-transform: uppercase` elements with `letter-spacing ≥ 0.05em` immediately preceding an `h1-h3` > 2 per page.
- Italic serif display as editorial shortcut; one italic/coloured word in a headline. Test: `h1 > em|span[style*=color]` present.
- Flat hierarchy: largest and body size ratio < 1.5. Test: computed font-size max/base.
- Gradient text. Test: `background-clip: text` + `gradient`.

**Colour**
- Indigo→purple gradient (Tailwind `indigo-500` lineage); cyan/violet neon on dark with glowing borders; radial "halo" behind hero; warm cream `#F4F1EA` + terracotta `#D97757` (Anthropic's own accent). Test: any gradient whose stops include hue 240-290; `box-shadow` with blur > 24 px and saturated colour; background within ΔE < 10 of those hexes.
- Grey text on a coloured background. Test: text colour saturation < 10 % on a background with saturation > 20 %.
- Tinted near-black (#0B0B0B, #111) as "black" without a reason. Test: documented in DESIGN.md or fail.

**Layout**
- Three identical rounded cards in a row with icon-tile + heading + text; cards nested in cards; one radius on everything; same `rgba(0,0,0,.1)` shadow everywhere. Test: ≥3 siblings with identical box, radius and shadow, each containing an `svg` in a rounded square above a heading.
- Numbered 01/02/03 markers on content that is not a sequence. Test: numbered labels whose parent is not `ol`.
- Side-tab accent border (4 px left border on a card). Test: `border-left-width ≥ 3px` with accent colour on a non-alert.
- Big-number hero metric with small stats + gradient accent. Test: hero contains a numeral at ≥ 4× body size.
- Monotonous spacing: every vertical gap identical. Test: standard deviation of sibling gaps = 0 across a section.

**Motion**
- Fade-and-slide-up on every section at scroll; identical hover lift on every card; bounce/elastic easing; pulsing status dot; marquee/ticker; decorative blinking cursor; "AI is thinking" shimmer. Test: count of `IntersectionObserver`-triggered entrances > 1 per page; `cubic-bezier` with y > 1; `animation: pulse|blink|marquee` on non-interactive text; `transition: all`.
- Animating keyboard-initiated actions. Test: any `transition-duration > 0` on elements toggled by a keydown handler.

**Copy**
- "Build faster. Ship smarter." headlines that any product could say; "Not a feature. A platform." forced contrast; em-dash in every sentence; "supercharge", "seamless", "AI-powered"; `→` appended to every link. Test: headline passes the "only North could say this" check (contains a North noun: card, brief, staff, ledger, gate); em-dash count / sentence count > 0.3; banned-word list grep.
- Errors that apologise or are vague. Test: error strings matching /sorry|oops|something went wrong/.

**Structure**
- Hero → three features → testimonials → pricing → FAQ regardless of product; everything visible at once; missing empty/loading/error/offline states. Test: each route has all four states rendered in Storybook/Playwright; landing section order documented as a decision.

## 4. How to give an AI taste

Principle: **taste = constraints (numbers, not adjectives) + exemplars (few-shot with score breakdowns) + a separate critic that must name the violated principle and cite evidence.** Evidence: Anthropic's harness post — agents "reliably skew positive when grading their own work"; a standalone evaluator "tuned to be skeptical turns out to be far more tractable"; the stock evaluator "would talk itself into deciding" issues didn't matter until few-shot examples with score breakdowns were added; rubric wording leaks into output ("museum quality" caused convergence). Zheng et al. 2023: judges show position, verbosity and self-enhancement bias; pairwise with swapped order beats absolute scores; >80 % human agreement only after mitigation. For North: the critic scores **pairwise** (new vs. previous or vs. reference crop), **in both orders**, on a different model from the generator where possible, and cannot pass a screen without quoting a selector or computed style. Cheap deterministic detectors run first; the LLM critic judges only what they cannot (fit, hierarchy, voice).

### Draft rubric — 10 named principles

| # | Principle | Definition | Critic's question | Evidence required | Pass/fail |
|---|---|---|---|---|---|
| 1 | Fit | Every visible element answers a need in the brief/PRODUCT.md | Which sentence of the brief does this element serve? | Element selector + brief line | Any element with no answer → fail |
| 2 | One thing | Each screen has one primary action and one memorable element | What is the single action? What is the one bold thing? | Screenshot crop of primary; count of accent-coloured CTAs | >1 accent CTA above the fold → fail |
| 3 | Fluency | Hierarchy readable in a 50 ms glance | In a 300 ms flash, what did you see first/second/third? Does that match intent? | 3 crops in order; computed font-size/weight | First-seen ≠ intended primary → fail |
| 4 | Counted system | Tokens used are within the declared counts | How many faces, sizes, radii, shadows, colours on this screen? | Computed-style census | Any count above DESIGN.md → fail |
| 5 | Earned motion | Animation frequency matches novelty; ≤300 ms; ease-out | How often per day is this seen? What does the motion explain? | Trigger, duration, easing from CSS | Frequent action animated, >300 ms, bounce, `transition: all` → fail |
| 6 | Instant acknowledgement | Every control changes within one frame of press; waits >1 s have state | What does the user see at 0 ms, 100 ms, 1 s? | `:active` style, pending state selector, trace timings | Missing `:active`/pending → fail |
| 7 | Honest copy | Each string is specific, active, North-vocabulary, says what happens | Could another product ship this sentence? | String + replacement | Generic → fail |
| 8 | Back of the drawer | Empty, loading, error, offline, long-text, 390 px states exist and match | Show me the state nobody asked for | Screenshots of 6 states | Any missing/clipped → fail |
| 9 | Non-default | No cluster from the slop catalogue unless written as a decision | Which decision record justifies this? | Catalogue rule id + DESIGN.md line | Unjustified tell → fail |
| 10 | Restraint | Nothing to remove without losing meaning (Chanel: remove one accessory) | Remove the weakest element; did anything break? | Before/after crop | Removal harmless → fail (it was decoration) |

The critic's output is a table: rule id, selector or crop, computed value, violated principle, one-line fix. A verdict without a selector or crop is invalid.

## 5. Critique of the three skills

**Emil Kowalski (`emil-design-eng`).** Keep: the ordered decision framework (animate at all? → purpose → easing → duration) with numbers (100-160 ms press, 125-200 tooltips, 150-250 dropdowns, ≤300 ms UI; `cubic-bezier(0.23,1,0.32,1)`; `scale(0.97)` on `:active`; never `scale(0)`; origin-aware popovers; instant subsequent tooltips; transitions over keyframes; `@starting-style`). Its Before/After/Why review table is already a critic format. Drop: course upsell, "taste is trained" preamble (true, non-actionable). Weak: motion only. **North: adopt whole as the motion layer.**

**Anthropic `frontend-design`.** Keep: "spend your boldness in one place"; structural devices must encode information; the five convergence clusters as self-check; the copy rules (active voice, same verb through the flow, errors don't apologise); two passes then review against the brief. Drop: persona framing, "take aesthetic risk if justified", "distinctive point of view" — adjectives the model cannot verify; absolute bans on all-caps and mono labels (tells only when unmotivated). Missing: numbers, evidence-bearing verification, frequency-based motion. **North: keep clusters and copy rules; replace adjectives with the §4 rubric.**

**impeccable.** Adds what the others lack: product context *before* style (PRODUCT.md: audience, purpose, constraints, voice; DESIGN.md: the system, with drift detectors); 59 deterministic detectors with exit codes, JSON and waivers; `critique` (hierarchy, clarity, resonance) separated from `audit` (a11y, perf, responsive); `harden`/`onboard` for unhappy paths. Weak: 24 commands; some detectors are review-only; it flags things North does on purpose, so needs a waiver file. **North: adopt PRODUCT.md + DESIGN.md + detector-in-CI; write North-specific detectors for the rules below.**

## 6. What North should do — testable rules

Type and colour
1. Exactly two typeface families on any screen (one display, one text) plus a mono for data only; mono never used for labels above headings. Test: computed-style census.
2. Type scale of ≤5 sizes per surface; the display/body ratio ≥ 2 on landing and brief; ≤ 1.6 on dense screens (Ledger, Team).
3. Uppercase tracked labels allowed only as *column headers and tier badges* (K0-K3); never above an h1-h3. Test: selector rule.
4. One accent (#e65100) used only for the primary action and the kill switch state; max one accent-filled element above the fold. Test: count.
5. Pure black on pure white in light mode; dark mode is a designed palette, not inversion (contrast-checked, accent re-tuned). Test: `filter: invert` absent; WCAG AA on every text node.
6. No gradients, glows, halos, blurs or gradient text anywhere except the physical "retro" button, which must be documented as a decision in DESIGN.md or removed. Test: grep.

Layout
7. Card nesting depth = 1; identical sibling cards ≤ 2 in a row; the decision card is the only card with a shadow.
8. Spacing scale of 8 values; adjacent sections never share the same gap as intra-section rhythm (grouping must be visible). Test: gap census per section.
9. Mobile 390 px: no horizontal scroll, touch targets ≥ 44 px, side gutter 16 px. Playwright.
10. Decision card: question is the largest text on the screen; options are the only buttons; the "no answer by deadline" line is present and in body size, not small print.

Motion
11. Budget: ≤ 1 non-user-triggered motion per screen (the brief's arrival or the card's reveal), ≤ 600 ms. No scroll-reveal, no marquee ticker, no pulsing dots, no blinking cursor on static text, no spinner glyph cycling for > 2 s without a named step ("Reading inbox…").
12. Every pressable: `:active` scale 0.97 at 100-160 ms ease-out; focus ring visible; `transition` lists properties explicitly; no `cubic-bezier` with overshoot. Grep + Playwright.
13. Keyboard-initiated actions and the kill switch have zero animation; kill switch confirmation ≤ 1 tap and the "stopped" state renders within 100 ms optimistically.
14. Waits: 0-100 ms nothing; 100 ms-1 s pending state on the control itself; >1 s a named step; >10 s progress + cancel. Per Nielsen.
15. `prefers-reduced-motion` honoured on every animation. Grep.

Copy and states
16. Every CTA names the result ("Answer card", "Stop all agents", "Send brief"), never "Continue/Submit/Get started"; the verb persists into the toast ("Stopped").
17. Headlines must contain a North noun (staff, brief, card, ledger, gate) or they fail the "only North could say this" check; banned list: seamless, supercharge, AI-powered, effortless, unlock.
18. Errors state what happened and the next action; no apology words. Empty states contain one action.
19. Every route ships six states (default, empty, loading, error, offline, long-content) in Storybook; Playwright screenshots all six at 390 px and 1280 px.

Process and verification
20. PRODUCT.md (audience, job, voice, constraints) and DESIGN.md (token counts above) exist before any screen is built; a detector (impeccable or a North fork) runs on every PR and fails on primary findings.
21. Every surviving slop-catalogue tell (serif display, hairline rules, mono data, zero radius, dark landing) has a one-line justification in DESIGN.md tied to a brief sentence; absent justification = fail. This is the Polsia test: if the only reason is "the competitor does it", drop it.
22. A critic pass (separate model/prompt from the generator) runs on screenshots and computed styles, uses the §4 rubric, outputs selector/crop + principle + fix, and judges new vs. previous in both orders; no screen is "done" without a critic table with zero fails.
23. The 50 ms test: a reviewer sees a 300 ms flash of landing and home; what they report seeing first must be the headline and the pending card respectively. Run before each milestone.
24. Performance budgets are design rules: home first paint ≤ 1.5 s on 4G throttling, card answer acknowledged ≤ 100 ms optimistically, queued ≤ 2 s. Lighthouse + trace in CI.
25. Remove-one test at review: delete the weakest element on the screen; if nothing is lost, it stays deleted.

## Sources

- Paul Graham, *Taste for Makers* — https://paulgraham.com/taste.html — taste is not preference; 14 properties of good design; "thousand barely audible voices".
- Vitsœ, Dieter Rams' ten principles — https://vitsoe.com/gb/about/good-design — "less, but better".
- Reber, Schwarz, Winkielman 2004, *Processing Fluency and Aesthetic Pleasure* — https://pages.ucsd.edu/~pwinkielman/reber-schwarz-winkielman-beauty-PSPR-2004.pdf — beauty as processing ease.
- Lindgaard et al. 2006, "Attention web designers: you have 50 milliseconds" — https://www.nature.com/news/2006/060109/full/news060109-13.html — 50 ms appeal judgments persist.
- NN/g, Aesthetic-Usability Effect — https://www.nngroup.com/articles/aesthetic-usability-effect/ — Kurosu & Kashimura 1995, 252 participants, 26 ATM layouts.
- Fogg et al. 2002, Stanford web credibility — https://clickz.com/study-for-site-cred-looks-matter/56564/ — 46.1 % of credibility comments cite design look.
- NN/g, Response times: 3 important limits — https://www.nngroup.com/articles/response-times-3-important-limits/ — 0.1/1/10 s.
- Laws of UX, Doherty threshold — https://lawsofux.com/doherty-threshold/ — 400 ms, Doherty & Thadani 1982.
- Norman, *Emotional Design* — https://en.wikipedia.org/wiki/Emotional_Design — visceral/behavioral/reflective.
- Jobs, NYT Magazine 2003 via Daring Fireball — https://daringfireball.net/linked/2007/01/23/how-it-works — "Design is how it works."
- Ive, TIME 2014 via TidBITS — https://tidbits.com/2014/03/19/ive-talks-to-time/ — "giving a damn"; care is legible.
- Ive, Stripe Sessions 2025 — https://appleinsider.com/articles/25/05/09/jony-ive-talks-about-minimalism-taste-and-apples-design-group — minimalism is not removing clutter; clean yet soulless is possible.
- Kapferer & Bastien, anti-laws of luxury — https://brandingstrategyinsider.com/2009/08/the-antilaws-of-luxury-marketing-5/ — don't respond to demand; restraint.
- Tufte, chartjunk/data-ink — https://data.europa.eu/apps/data-visualisation-guide/chart-junk-and-data-ink-origins — definitions; the "duck".
- Rauno Freiberg, *Invisible Details of Interaction Design* — https://rauno.me/craft/interaction-design — frequency & novelty, spatial consistency, "there must be a reason".
- Kouthoofd / Teenage Engineering, SFMOMA — https://www.sfmoma.org/read/stay-curious-stay-naive-an-interview-with-teenage-engineering-jesper-kouthoofd/ — "I set up restrictions when I design".
- Anthropic, harness design for long-running apps — https://www.anthropic.com/engineering/harness-design-long-running-apps — self-grading skews positive; separate skeptical evaluator; few-shot score breakdowns; rubric wording leaks.
- Zheng et al. 2023, *Judging LLM-as-a-Judge* — https://arxiv.org/abs/2306.05685 — position/verbosity/self-enhancement bias; >80 % agreement after mitigation.
- Anthropic `frontend-design` skill (local file /mnt/skills/public/frontend-design/SKILL.md) — five convergence clusters; copy rules.
- Emil Kowalski `emil-design-eng` skill (local) and https://emilkowal.ski/skill — animation decision framework with durations and curves.
- impeccable README — https://raw.githubusercontent.com/pbakaus/impeccable/main/README.md — product context before style; 59 detectors; anti-pattern list.
- impeccable slop catalogue — https://impeccable.style/slop — full detector list by category.
- impeccable detector docs — https://impeccable.style/docs/detector — source vs URL scans, DESIGN.md drift, exit codes.
- Vercel web-interface-guidelines — https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md — grep-testable rules (`transition: all`, `outline-none`, ellipsis).
- Leonxlnx/taste-skill — https://raw.githubusercontent.com/Leonxlnx/taste-skill/main/README.md — forced direction draw, browser check at three widths, capped self-critique rounds; v1 dials dropped.
- uxdesign.cc, "AI design isn't ugly, it's fluent" — https://uxdesign.cc/ai-design-isnt-ugly-it-s-fluent-and-that-s-the-problem-131b2f4eb78c — distributional convergence; the "never converge" instruction was unfollowable.
- 925 Studios, AI slop tells — https://www.925studios.co/blog/ai-slop-design-tells — Inter + indigo gradient + three cards fingerprint.
- Kosta C., "Spot the Slop" — https://world.hey.com/kostac/spot-the-slop-a-ui-designer-s-guide-to-fixing-ai-defaults-4c448c9c — seven tells with fixes; missing states; uniform everything.
