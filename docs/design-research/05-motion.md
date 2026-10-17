# 05 · Motion and interaction: the system, the signature, the 3D policy

The decision framework is Emil Kowalski's (`08`): should it animate at all (frequency), what is
its purpose, which easing, how fast. The numbers below are the answers for North.

## Frequency decides

| How often the user sees it | Motion allowed |
| --- | --- |
| ≥ 20× a day: navigation, hover, keyboard, stream rows, list updates | none, or ≤ 120 ms opacity |
| 1-10× a day: card answer, toast, sheet, menu | ≤ 300 ms, ease-out, interruptible |
| ≤ 1× a day: the brief's first reveal | ≤ 600 ms, may stagger; the only "wow" slot on Home |
| Once ever: onboarding end, first card | ≤ 1.5 s choreography, skippable, never repeats |

Keyboard-initiated actions (1/2/3 to answer, Esc, shortcuts) run at 0 ms. Stopping is instant.

## Tokens (`globals.css`; nothing else declares a duration or curve)

```css
--dur-fast: 120ms;    /* press, hover, toggles, opacity */
--dur-base: 200ms;    /* menus, option select, toast enter, row enter */
--dur-slow: 320ms;    /* sheet, page transition, the answer that travels */
--dur-reveal: 600ms;  /* brief first reveal, once a day */
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);     /* default: enters, feedback */
--ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);  /* things already on screen moving */
--ease-exit: cubic-bezier(0.4, 0, 1, 1);        /* leaving: faster than entering */
```

Springs (Motion for React, spatial props only, never colour or opacity, never bounce):
`fast {stiffness 1400, damping 90}` for toggles; `default {700, 60}` for sheets and the card
stack; `slow {300, 40}` for full-screen. Only `transform`, `opacity`, `clip-path` and
`stroke-dashoffset` animate. `transition: all` never appears.

## Per-component rules

- **Pressables.** `:active { transform: scale(0.97) }` over `--dur-fast --ease-out`;
  `touch-action: manipulation`; tap highlight transparent; hover effects only under
  `@media (hover: hover)`; a visible focus ring. The flat control replaces the gradient button:
  what feels physical is the press, not the paint.
- **Option select on a card.** The chosen option's fill moves as one object via `clip-path`
  (200 ms); other options fade to 0.4; the label morphs in place ("Send 5 emails" → "Queued").
- **Toast (K1, undo).** Sonner defaults: 4 s, stack scale 0.95 per step, swipe to dismiss with
  velocity > 0.11 px/ms, pause on hover and when the tab is hidden; `aria-live="polite"`; enter
  `--dur-base --ease-out`.
- **Sheet (mobile card detail, settings, scoped chat).** Bottom sheet, `spring.default`, drag
  with velocity close, `overscroll-behavior: contain`, distinct heights per step, backdrop
  opacity tied to drag progress, 6 px radius, the one surface with a shadow.
- **Menus and popovers.** `@starting-style` + `transition-behavior: allow-discrete`;
  `transform-origin` at the trigger; enter from `scale(0.96)`, never from 0; exit 150 ms.
- **Brief reveal.** First open of the day: paragraphs enter in 40 ms steps with `blur(4px)` → 0
  and opacity, total ≤ 600 ms; numbers tick once with an odometer. Every later open that day: cut.
- **Agent stream.** New rows: opacity 0 → 1 and `translateY(-4px)` → 0 over `--dur-base`;
  batches of more than three insert instantly; the ASCII spinner at 8 fps beside a named step.
- **Page transitions.** Cross-document View Transitions for landing → login → onboarding;
  same-document for app routes; 150 ms cross-fade; named shared elements only: the company name
  in the bar, the active card, the stop control (so it is visibly always there). Firefox cuts.
- **Numbers.** Costs, quota (1/3 → 2/3), ledger totals use an odometer that respects reduced
  motion; a value that changes more than once a minute does not animate.
- **Waits.** 0-100 ms nothing; 100 ms-1 s the control itself shows pending; > 1 s a named step
  ("Reading inbox…"); > 10 s progress and cancel. No indeterminate bar longer than 3 s.

## The signature: the answer that travels

Answering a card is North's one ritual (≤ 3 a day), so it is the one place the product moves.
Tap an option: the fill slides to it, the others fade, the label becomes "Queued · Undo" for
5 s. Then the card shrinks to one line (question → "Send 5 emails · $0 · 09:12") and *flies*, as
a shared element (`view-transition-name: card-<id>` or Motion `layoutId`), into the answered
strip under the cards; the day's quota ticks 1/3 → 2/3 and the cost column increments. The server
changes nothing visible unless it fails, in which case the row flies back with an inline message.
Money cards replace the tap with hold-to-confirm: a hairline fill grows left to right inside the
button over 600-700 ms with the amount in the label; release before full = nothing. Keyboard
answers do the same at `--dur-fast`. Reduced motion: cut, same end state. No competitor renders
"decision → consequence" as one continuous object; it teaches the ledger without a sentence.

Two supporting signatures: **the page holds its breath** (stop: one root attribute pauses
every animation and strikes through running rows; safety reads as power) and, later,
**evidence draw-in** (a hairline draws from a ledger row to its verified evidence; dashed while
unverified, solid when verified; teaches "no evidence, no done").

## Reduced motion

Under `prefers-reduced-motion: reduce`: every `--dur-*` becomes 0 except 120 ms opacity fades;
springs off; view transitions off; the brief appears in one step; the hold-to-confirm fill stays
(it conveys state). Any information carried by motion has a text or colour equivalent.

## 3D policy

3D is used only where the object is the product. Igloo and Lusion sell a studio's capability,
Stripe's globe shows a network, Apple's AirPods pages show a physical thing. North's product is
decisions, a brief, a ledger and agents: text and time. Rules:

- App routes: no WebGL, no canvas heroes. Budget 0 KB.
- Landing: at most one CSS-3D or SVG device (for example the demo card at `perspective: 1200px;
  rotateX(6deg)` flattening on scroll), ≤ 15 KB, no library, never the LCP element.
- Any future hero: ≤ 200 KB JS gzipped, poster `<img fetchpriority="high">` as LCP, canvas
  mounted after load and idle, static under reduced motion and on coarse pointers, 60 fps on a
  2020 phone or it is cut. Three.js alone exceeds the budget.
- The test: replace the hero with a screenshot; if the page sells the same, delete the hero.

## Anti-patterns (confirmed slop, grep for them)

Custom cursors and trails; 500 ms enters; `transition: all`; `scale(0)` enters; animated
gradient blobs behind headlines; parallax on every section; scroll-reveal on every section;
hover lift on every card; bounce easing; pulsing dots; marquee; blinking cursor on static text;
sound on routine actions (an optional single soft confirm on card answer, off by default, is the
only sound allowed).
