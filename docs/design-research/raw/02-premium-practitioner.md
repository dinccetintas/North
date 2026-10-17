# 02 — Premium web / motion / 3D practitioner

Question: which concrete techniques make 2025-26 product sites feel premium, fast and futuristic without becoming a template, and what should North's motion/interaction/3D system be?

Research method: fetched primary sources (Emil Kowalski, Rauno Freiberg, Josh Comeau, Benji Taylor, Stripe engineering, Abeto/Igloo case study, Vercel web-interface-guidelines, Material spring tokens, MDN/Chrome docs, Nielsen) plus live markup of linear.app, raycast.com, family.co, vercel.com/ship. Where only secondary sources existed, it is marked (secondary).

## Headline finding

The premium product sites of 2025-26 are **quiet**. linear.app, raycast.com and family.co ship no `<canvas>`, no `<video>` hero, no Lottie; they are typography, screenshots and restraint (live markup, Oct 2026). "Wow" comes from four mechanisms, not spectacle: (1) *speed*: nothing waits (Linear local-first writes, Raycast zero-animation launcher); (2) *continuity*: elements move instead of being redrawn ("we fly instead of teleport", Family); (3) *one deliberate novelty*: ~90% familiar / 10% novel, at first encounters (Rauno, *Novelty*, 2026); (4) *invisible correctness*: transform-origin, easing, interruptibility, reduced-motion. 3D wins awards (Igloo, Lusion) and is avoided by every B2B product studied.

## Pattern library of premium (26 techniques)

Fit = North fit 1-5. Where = landing / onboarding / home / card (decision card) / team / artifacts / settings / kill.

| # | Technique | Seen at | Mechanism (why it reads premium) | Cost / risk | Fit | Where |
|---|---|---|---|---|---|---|
| 1 | **Zero-animation for frequent keyboard actions** | Raycast launcher; Emil "great animations": "never animate keyboard initiated actions" | Repetition kills novelty; absence of delay reads as mastery | None; needs discipline | 5 | home, card answer, nav |
| 2 | **Local-first optimistic writes, no spinner** | Linear sync engine (secondary: performance.dev) | UI mutates in-memory first, server later; "spinners exist to cover network latency" | Conflict handling; North already has queue → show "queued" state, not spinner | 5 | card answer, settings |
| 3 | **ease-out by default, <300 ms, custom bezier** | Emil Kowalski (great-animations; good-vs-great) | Fast start = immediate acknowledgement; built-in CSS easings "too weak" | None | 5 | everywhere |
| 4 | **Origin-aware motion** (`transform-origin` = trigger point) | Emil; Radix `--radix-popover-content-transform-origin` | Thing grows from where you touched → causality | None | 5 | menus, agent detail popovers |
| 5 | **Interruptible transitions** (CSS transitions / springs, not keyframes) | Emil (Sonner), Rauno (Invisible Details), Vercel guidelines | Reverse mid-flight = never waits on the machine | Use `transition`, not `@keyframes`, for stateful UI | 5 | drawer, card, kill |
| 6 | **clip-path reveal for active-state movement** | emilkowal.ski/ui/the-magic-of-clip-path | Duplicate layer clipped `inset(0 r% 0 l% round Rpx)`; highlight moves as one object, no layout | Duplicate DOM, `aria-hidden` | 4 | option buttons on card, tabs on team |
| 7 | **Text morph / partial text update** | Family ("Continue"→"Confirm" morphs shared letters; only the changing word updates) | Consequential step made noticeable without a modal | Needs per-character layout anim (Motion `layoutId`) | 5 | card: "Choose" → "Confirmed"; brief diff |
| 8 | **Dynamic tray with distinct heights per step** | Family dynamic tray system | Overlay keeps context; different height = you moved to a new step | Vaul-style drawer, `overscroll-behavior: contain` | 4 | mobile card answer, settings |
| 9 | **Stacked toasts, depth scale 0.95/step, swipe-velocity dismiss > 0.11 px/ms, 4 s life, pause on hover/hidden** | Sonner (Emil, building-a-toast) | Physical stack metaphor; flick works | Use Sonner as-is | 4 | K1 notify toasts |
| 10 | **Number odometer with masks** | NumberFlow (number-flow.barvian.me): digit spin, gradient edge masks, layout transform, `respectMotionPreference` default | Money/counters feel "live" without being a chart | ~small dep; don't use on values that change >1×/min | 5 | ledger, cost on card, quota 2/3 |
| 11 | **Streaming text with fade/blur-in per token** | Streamdown docs; ChatGPT/Claude (secondary) | Time-to-first-token is the felt speed; blur masks bursty batches | Buffer tokens, release at steady rate | 4 | brief reveal, agent stream |
| 12 | **Draw-in (dash-offset / setDrawRange)** | Stripe globe arcs draw over 2.5 s via `setDrawRange`; SVG `stroke-dashoffset` equivalent | Line appearing = "being written", evidence of work | Trivial for SVG | 4 | evidence links, ledger connections |
| 13 | **Scroll-driven animation in CSS** (`animation-timeline: view()`) | Chrome docs; Safari 26 (Sep 2025), Firefox still flagged | Off-main-thread, no scroll listeners; progressive enhancement via `@supports` | Firefox fallback = static | 3 | landing only |
| 14 | **Apple image-sequence canvas scrub** | Apple AirPods pages (secondary teardown: canvas + pre-extracted frames, 60-180 frames) | Frame drawn to canvas is instant; `<video currentTime>` scrubbing is jerky on iOS | 2-6 MB of frames; heavy | 1 | not for North |
| 15 | **Cross-document View Transitions** (`@view-transition { navigation: auto }`) | Chrome 126, Safari 18.2; Firefox not shipped (Chrome docs; Jake Archibald, Feb 2026) | MPA feels like SPA; shared element (`view-transition-name`) persists across routes | Firefox = instant cut (fine) | 5 | landing→login→onboarding→home |
| 16 | **Same-document View Transitions for list/detail** | `document.startViewTransition` (Chrome 111, Safari 18, Firefox 144) | Card expands to detail; "we fly" | Name only 1-3 elements per transition | 5 | card list → card detail |
| 17 | **@starting-style + `allow-discrete`** for enter/exit of popovers/dialogs | MDN (Baseline Aug 2024) | Entry animation from `display:none` in pure CSS; exit keeps element until done | None | 5 | all popovers, drawers |
| 18 | **Anchor positioning** for tooltips/menus | MDN; Chrome 125, Safari 26 (Firefox pending) | Menus anchored by CSS, no JS measuring, no layout reads | Needs Floating-UI fallback for Firefox | 3 | team view |
| 19 | **Layered, tinted shadows** | Josh Comeau "Designing Beautiful Shadows" | One light source; 3-5 layers `1px 2px 2px … 16px 32px 32px` at 0.075-0.2 α; tint = background hue | Don't animate layered shadows | 2 | North is hairline-border flat; use only on floating sheet |
| 20 | **Perceptual colour (LCH/oklch) themes from 3 inputs** | Linear redesign post: base, accent, contrast replace 98 variables | Equal perceived lightness across hues; high-contrast themes for free | Tailwind v4 is oklch-native | 4 | settings, theming |
| 21 | **`text-wrap: balance` on headings, `pretty` on body** | MDN (Baseline Mar 2024) | No orphans; "typeset" feel | `pretty` slower; body only | 5 | brief, card question |
| 22 | **Spring motion for spatial, not for colour/opacity** | Material spring tokens: spatial damping 0.9 / stiffness 1400 (fast) 700 (default) 300 (slow); effects damping 1 / 3800 / 1600 / 800; Josh Comeau springs | Springs model momentum, interruptible; colour needs no bounce | Springs need JS (Motion) | 4 | drawer, card stack |
| 23 | **Hold-to-confirm** | rauno.me/craft/hold-enter-to-confirm (2021) | Progress fill under sustained input = intent without a modal | Must have keyboard equivalent | 5 | kill switch, K3 actions |
| 24 | **"We fly instead of teleport": shared element persists** | Family values | Same card moves between screens, never duplicated | `layoutId` or view-transition-name | 5 | card → ledger entry |
| 25 | **Real-time in-engine intro instead of video; assets compiled in background** | Igloo Inc (Abeto case study, Awwwards 2024) | Procedural = tiny payload at any resolution; perf measured continuously | Weeks of shader work | 1 | n/a |
| 26 | **Antialias off, filter dots to 1/3, pause other anims during scroll, 60 fps budget** | Stripe globe blog | GPU budget discipline makes 3D feel light | Only if 3D exists | 2 | landing hero only |

Anti-patterns confirmed as "slop": custom cursors and cursor trails (no 2025 premium product site uses one), 500 ms enter animations (Emil's example of frustration), `transition: all`, `scale(0)` enters (min 0.95), animated gradient blobs behind headlines ("the Linear effect" imitation, Rectangle Substack), parallax on every section, sound on routine actions ("a triumphant cue on a routine action gets tiring fast").

## Motion system draft for North

### Tokens (CSS custom properties, `packages/ui` or `apps/web/app/globals.css`)

```
--dur-instant: 0ms;      /* keyboard, frequent actions */
--dur-fast: 120ms;       /* press, hover, toggles */
--dur-base: 200ms;       /* popovers, option select, toast enter */
--dur-slow: 320ms;       /* drawer, sheet, page transition (cap: <300ms visible movement + 20ms settle) */
--dur-reveal: 600ms;     /* brief reveal, once/day only */
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);        /* default; strong ease-out (Emil-derived) */
--ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);     /* elements already on screen moving */
--ease-exit: cubic-bezier(0.4, 0, 1, 1);           /* leaving: fast, no lingering */
--ease-hover: ease;                                 /* colour/background only */
```

Spring presets (Motion for React, JS-only, spatial props only):
`spring.fast = {stiffness: 1400, damping: 90, mass: 1}` (buttons/toggles) · `spring.default = {stiffness: 700, damping: 60}` (sheets, card stack) · `spring.slow = {stiffness: 300, damping: 40}` (full-screen). Derived from Material's damping-ratio 0.9 (verify ratio ≈ 0.9 in Motion's visualizer). Never bounce. Colour/opacity never use springs.

### Per-component rules

- **Button press**: `transform: scale(0.97)` on `:active`, `--dur-fast`, `--ease-out`; release springs back `spring.fast`. Retro-gradient buttons: additionally shift gradient 1px down (pressed look). `touch-action: manipulation`; explicit `-webkit-tap-highlight-color: transparent`. No hover animation on touch (`@media (hover: hover)` only).
- **Card answer** (the core act, ≤3/day → may carry motion): option chosen → chosen option's background moves via clip-path (#6) `--dur-base`; other options fade to 0.4 opacity; label text morphs "Choose" → "Queued" (#7); card then **flies** (#24, view-transition-name `card-{id}`) into the ledger/"answered" slot in `--dur-slow`. Server confirmation changes nothing visible unless it fails (then the card flies back + inline error). Keyboard answer (1/2/3 keys) = same but `--dur-fast`.
- **Brief reveal** (once a day, first open): body lines stream in paragraph-chunks with 40 ms stagger, blur(4px)→0 + opacity, `--dur-reveal` total ≤ 600 ms; subsequent opens that day: `--dur-instant`. Numbers in the brief use NumberFlow on first reveal only.
- **Agent activity stream** (team page, 24 h): new rows enter with `@starting-style` opacity 0 → 1, `translateY(-4px)`→0, `--dur-base`; **no** per-token animation; rows older than viewport insert without motion; batch inserts >3 rows at once = instant. Running agent indicator = the existing ASCII spinner `| / - \` at 8 fps, never a CSS spinner.
- **Page transitions**: cross-document View Transitions on landing→login→onboarding; same-document for in-app routes; default = 150 ms cross-fade; shared elements only: company name in top bar, the active decision card, kill switch button (so it is visibly *always there*). Firefox: cut.
- **Kill switch**: hold-to-confirm 600 ms with a hairline progress fill left→right inside the button; keyboard: hold Enter/Space. On trigger: every animated element on screen stops (`:root[data-killed]` sets `animation-play-state: paused; transition: none`), agent stream rows get `strikethrough`-style red hairline over 150 ms, ticker stops. Must be visible within 100 ms of release; the 5 s spec is for backend, UI confirms in <100 ms optimistically and shows "Stopping… 3 agents" → "Stopped" via text update, not toast.
- **Toast (K1 notify)**: Sonner defaults (4 s, stack scale 0.95, swipe dismiss), `aria-live="polite"`, ease `--ease-out` 200 ms not Sonner's 400 ms `ease`.
- **Drawer/sheet (mobile card detail, settings)**: Vaul-style bottom sheet, `spring.default`, drag with velocity close, `overscroll-behavior: contain`, distinct heights per step (Family trays), backdrop opacity tied to drag progress.

### Frequency rules (Emil / Rauno)

| Frequency | Motion |
|---|---|
| ≥ 20×/day (nav, hover, keyboard, stream rows) | none or ≤120 ms opacity only |
| 1-10×/day (card answer, toasts, drawer) | ≤ 300 ms, ease-out, interruptible |
| ≤ 1×/day (brief reveal, first-run) | ≤ 600 ms, may stagger, the only place for "wow" |
| Once ever (onboarding, first card) | ≤ 1.5 s choreography, skippable, never repeats |

### Reduced motion

`@media (prefers-reduced-motion: reduce)`: all `--dur-*` → 0 ms except opacity fades (120 ms); springs → `animate={false}`; NumberFlow `respectMotionPreference` stays true; View Transitions → `::view-transition-group(*) { animation: none }`; streaming becomes chunked paragraph appearance; hold-to-confirm keeps progress fill (it conveys state, not decoration). Information conveyed by motion must survive its removal (Apple Reduce Motion: cross-fade replaces slide).

## The one signature: three candidates

1. **The Answer That Travels** (decision card). Answering a card is the product's only ritual. The chosen option's highlight slides via clip-path, the question text shrinks to a one-line ledger row, and the whole card *flies* (shared element) into the ledger strip at the bottom of Home, where a NumberFlow ticks the day's quota 1/3 → 2/3 and the cost column increments. Build: Motion `layoutId` (or `view-transition-name`) on the card, clip-path on options, NumberFlow for quota/cost, optimistic state from the queue. Falls back to instant on reduced motion. Why only North: no competitor renders "decision → consequence" as one continuous object.

2. **Evidence Draw-in** (task done ⇢ evidence). A task becomes `done` only with verified Evidence. Render evidence as a hairline that *draws* (SVG `stroke-dashoffset`, 400 ms, ease-out) from the ledger entry to the artifact/URL/screenshot thumbnail; unverified = dashed, verified = solid, drawn once on arrival. Build: inline SVG `<path>` with `pathLength=1`, `@starting-style` from `stroke-dashoffset: 1`. Teaches "no evidence, no done" without a sentence.

3. **Stop All = The Page Holds Its Breath** (kill switch). The only full-screen motion in the product, and it is the *removal* of motion: hold-to-confirm fill, then every spinner freezes mid-frame, ticker halts, stream rows get a red hairline, and the top bar text updates "Stopped · 0 agents running". Build: `data-killed` attribute on `<html>`, CSS `animation-play-state: paused` + `transition: none` globally, optimistic state, hold = `pointerdown`/`keydown` timer with progress via CSS `--hold` custom property. Safety reads as power.

Recommendation: ship #1 as the signature; #3 is cheap and required anyway; #2 in M-later.

## 3D policy

Rule: **3D only where the object is the product.** Igloo and Lusion sell a studio's capability; Stripe's globe shows a global network; Apple's AirPods pages show a physical object. North's product is decisions, a brief, a ledger, agents: all text and time. Nothing in it is a 3D object.

- **App**: no WebGL, no canvas heroes, ever. Budget: 0 KB.
- **Landing**: optional *one* CSS-3D or SVG device (e.g. a decision card with `perspective: 1200px; rotateX(6deg)` that flattens on scroll via `animation-timeline: view()`), ≤ 15 KB, no library, no LCP impact. Budget cap for any future hero: ≤ 200 KB JS gzipped, poster `<img fetchpriority="high">` is the LCP, canvas mounts after `load` + `requestIdleCallback`, static image under `prefers-reduced-motion` and on `pointer: coarse`, `antialias: false`, 60 fps on a 2020 phone or cut it. Three.js core ≈ 600 KB minified (secondary) already exceeds the budget → de facto ban.
- **Test**: if the hero is replaced by a screenshot and the page sells the same, delete the hero.

## What North should do (testable rules)

1. No animated property other than `transform`, `opacity`, `clip-path`, `stroke-dashoffset`; `grep` for `transition: all` returns 0.
2. Every `transition`/`animation` declares a `--dur-*` and `--ease-*` token; no literal ms/bezier outside `globals.css`.
3. No visible UI motion exceeds 300 ms except the daily brief reveal (≤600 ms) and first-run onboarding (≤1.5 s).
4. Keyboard-initiated actions (shortcuts, Enter, Esc, 1/2/3 to answer) run at `--dur-instant`.
5. Buttons: `:active` scale 0.97, `touch-action: manipulation`, explicit tap-highlight; hover effects wrapped in `@media (hover: hover)`.
6. Every popover/menu sets `transform-origin` to its trigger side; dropdowns never grow from center.
7. Enter animations never start below `scale(0.95)`; exits are ≤ 150 ms and faster than enters.
8. Popovers/drawers/dialogs use `@starting-style` + `transition-behavior: allow-discrete`; no JS mount flags for entry.
9. Card answer: optimistic state within 100 ms of click; no spinner; server failure reverts with inline error; queue confirmation within 2 s (spec) changes nothing visible.
10. Zero CSS spinners in the app; only the ASCII `| / - \` indicator; skeletons only on cold first load, never after navigation (data must be prefetched/cached).
11. All `<Link>`s to Home/Team/Ledger/Artifacts prefetch on viewport (Next default) and hover; in-app navigation completes <100 ms perceived (cross-fade only).
12. Cross-document View Transitions enabled (`@view-transition { navigation: auto }`) for landing→login→onboarding; same-document for app; named elements ≤ 3 per transition; Firefox shows a cut without errors.
13. Shared-element rule: the decision card and the kill switch button carry `view-transition-name` on every screen where they appear.
14. Numbers that change (cost, quota, ledger totals) use an odometer with reduced-motion respect; numbers updating more than once a minute do not animate.
15. Agent stream: new rows fade/translate ≤ 200 ms; batches of >3 rows insert instantly; no per-token typing effects outside the brief reveal.
16. Kill switch: hold-to-confirm ≥ 500 ms with visible fill, keyboard-holdable, UI reflects "stopped" state <100 ms after release, all on-screen animation frozen via one root attribute.
17. Toasts: `aria-live="polite"`, 4 s, pause on hover and on `document.hidden`, swipe to dismiss on touch.
18. `prefers-reduced-motion: reduce` removes all transform motion and keeps 120 ms opacity fades; every motion that conveys state has a non-motion equivalent (text or colour change).
19. Headings `text-wrap: balance`; brief/body `text-wrap: pretty`; no heading wraps to a one-word orphan at 390 px.
20. Colour tokens defined in oklch (Tailwind v4) with ≥ 3 lightness tiers for surfaces; dark mode is a token swap, not CSS inversion (inversion distorts the orange accent and shadows).
21. Zero `<canvas>`/WebGL in `apps/web` app routes; landing hero JS ≤ 200 KB gzipped and LCP element is an `<img>` or text.
22. Lists > 50 rows (ledger, stream) virtualize or use `content-visibility: auto`; no `getBoundingClientRect` in render.
23. Hover/tap on card option shows the "No answer by deadline → X" consequence line for *that* option only (contextual reveal), no modal.
24. Novelty budget: ≤ 10% of screens contain a bespoke interaction; a reviewer can list them (target: card answer, brief reveal, kill switch).
25. Sound: none, except an optional single soft confirm on card answer, off by default, in Settings.

## Sources

- https://emilkowal.ski/ui/great-animations — <300 ms, ease-out, never animate keyboard actions, animate transform/opacity, interruptible, reduced-motion.
- https://emilkowal.ski/ui/good-vs-great-animations — transform-origin, custom curves, springs for mouse-driven, test in slow motion.
- https://emilkowal.ski/ui/the-magic-of-clip-path — clip-path inset active-state technique.
- https://emilkowal.ski/ui/building-a-toast-component — Sonner: 0.95 stack scale, velocity 0.11 dismiss, 4 s, pause on hover/hidden.
- https://rauno.me/craft/interaction-design — Invisible Details: interruptible, skip motion for frequent actions, trigger destructive on gesture end.
- https://rauno.me/craft/novelty — 90/10 familiar/novel, novelty at first encounters, "novelty tax".
- https://rauno.me/craft — index incl. Hold Enter to confirm (2021), Devouring Details (2025), DD System (2026).
- https://benji.org/family-values — fluidity, "we fly instead of teleport", text morphing, dynamic trays with distinct heights.
- https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md — Vercel rules: transform/opacity only, no `transition: all`, touch-action, overscroll, virtualize >50, aria-live.
- https://linear.app/now/how-we-redesigned-the-linear-ui — LCH themes from 3 inputs, elevation tiers, Inter Display.
- https://linear.app/ , https://www.raycast.com/ , https://family.co/ , https://vercel.com/ship — live markup Oct 2026: no canvas/video heroes; screenshots + type.
- https://stripe.com/blog/globe — Three.js, 60 fps budget, antialias off, setDrawRange arcs 2.5 s, pause during scroll.
- https://awwwards.com/igloo-inc-case-study.html — Abeto: Three.js/Svelte/GSAP, in-engine intro, background shader compile, SOTY 2024.
- https://raw.githubusercontent.com/material-components/material-components-android/master/docs/theming/Motion.md — six spring tokens (spatial 0.9/1400·700·300; effects 1/3800·1600·800).
- https://www.joshwcomeau.com/animation/a-friendly-introduction-to-spring-physics/ — mass/tension/friction; springs for motion not colour.
- https://www.joshwcomeau.com/css/designing-shadows/ — single light source, layered tinted shadows, elevation scale.
- https://number-flow.barvian.me/ — odometer technique, masks, respectMotionPreference.
- https://developer.chrome.com/docs/web-platform/view-transitions — same-doc Chrome 111/Safari 18/Firefox 144; cross-doc Chrome 126/Safari 18.2, no Firefox.
- https://developer.chrome.com/docs/css-ui/scroll-driven-animations — scroll()/view() timelines, off-main-thread; Safari 26.
- https://developer.mozilla.org/en-US/docs/Web/CSS/@starting-style — Baseline Aug 2024; allow-discrete pattern.
- https://developer.mozilla.org/en-US/docs/Web/CSS/text-wrap — balance (≤6 lines Chromium), pretty for body; Baseline Mar 2024.
- https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/light-dark — requires `color-scheme: light dark`; Baseline May 2024.
- https://www.nngroup.com/articles/response-times-3-important-limits/ — 0.1 s / 1 s / 10 s; indicate work >1 s; percent-done >10 s.
- https://lawsofux.com/doherty-threshold/ — 400 ms heuristic (1982, one study).
- https://streamdown.ai/docs/animation — fadeIn/blurIn for streaming tokens (secondary for Claude/ChatGPT practice).
- https://nextjs.org/docs/app/guides/prefetching — App Router viewport + hover prefetch; prefetch={false} disables both.
- https://www.mintlify.com/lochie/web-haptics/advanced/browser-support — iOS Safari has no Vibration API; switch-input hack patched in iOS 26.5 (secondary).
- https://support.apple.com/guide/iphone/motion-iph0b691d3ed/ios — Reduce Motion + Prefer Cross-Fade Transitions semantics.
