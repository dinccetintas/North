# 05 · Motion and interaction: the system, the signature, the 3D policy

The decision framework is Emil Kowalski's (`08`): should it animate at all (frequency), what is
its purpose, which easing, how fast. The tokens are in `02` (one table, four durations, three
easings); this file says where each is used. No animation library: everything below is CSS
(`@starting-style`, `transition-behavior: allow-discrete`, `grid-template-rows`, `linear()`
easings for spring-like settles) plus one `requestAnimationFrame` for the hold fill.

## Frequency decides

| How often the user sees it | Motion allowed |
| --- | --- |
| ≥ 20× a day: navigation, hover, keyboard, stream rows, list updates | `--dur-fast` opacity only, or none |
| 1-10× a day: card answer, undo row, sheet, menu | ≤ `--dur-slow`, ease-out, interruptible |
| ≤ 1× a day: the brief's first reveal | `--dur-reveal`, may stagger; the only non-user-triggered motion on Home |
| Once ever: onboarding end, first card | ≤ 1.5 s choreography, skippable, never repeats |

Keyboard-initiated actions (1/2/3 to select, Enter, Esc, shortcuts) run at 0 ms. Stopping
is instant.

## Per-component rules

- **Pressables.** `[data-pressed]` (set on `pointerdown`, iOS `:active` is unreliable):
  `transform: scale(0.97)` over `--dur-fast --ease-out`; `touch-action: manipulation`; tap
  highlight transparent; hover effects only under `@media (hover: hover)`; a 2 px ink focus ring
  offset 2 px, visible on `:focus-visible`. The flat control replaces the gradient button.
- **Option select on a card.** One positioned fill behind the option group (`translateX`,
  `--dur-base`), buttons transparent; the recommended option is ink-filled at rest and labelled
  "Recommended"; on selection the chosen option gets a check and the label "Chosen"; others fade
  to 0.4. `aria-pressed` and the check appear only on selection; nothing is autofocused.
- **Undo row.** An inline `role="status"` row, not a toast: "Sending in 5 s · Undo". No library.
- **Sheet (mobile card detail, settings, scoped chat).** Native `<dialog>` with
  `@starting-style`, `--dur-slow`, `linear()` settle, `overscroll-behavior: contain`, 6 px
  radius, the one surface with a shadow; backdrop fades `--dur-fast`. No drag in v1.
- **Menus and popovers.** Popover API; `transform-origin` at the trigger; enter from
  `scale(0.96)`, never from 0; exit `--dur-fast --ease-exit`.
- **Brief reveal.** First open of the day: paragraphs enter in 40 ms steps with `blur(4px)` → 0
  and opacity, total ≤ `--dur-reveal`; the headline numbers settle once (a 15-line CSS
  `translateY` odometer, respecting reduced motion). Every later open that day: cut.
- **Agent stream.** New rows: opacity 0 → 1 over `--dur-fast`, no translate; batches of more
  than three insert instantly; the ASCII spinner at 8 fps beside a named step.
- **Page transitions.** Landing → login uses a plain `<a>` and `@view-transition { navigation:
  auto }` (cross-document; Firefox cuts). In-app routes: `--dur-fast` cross-fade through React's
  `<ViewTransition>` only if `experimental.viewTransition` proves stable in this repo; otherwise
  a cut, which is also fine. No shared-element flights.
- **Numbers.** Costs and totals settle with the CSS odometer at most once per render; a value
  that changes more than once a minute does not animate.
- **Waits.** 0-100 ms nothing; 100 ms-1 s the control itself shows pending; > 1 s a named step
  ("Reading inbox…"); > 10 s progress and cancel. No indeterminate bar longer than 3 s.

## The signature: the receipt

Answering a card is North's one ritual, so it is the one place the product moves, and it moves
in place, where the eye already is.

**One-tap cards (K2, not money, not a send to real people).** Tap an option: the fill moves to
it (`--dur-base`), the label becomes "Chosen", the others fade. The answer is committed at once
(DEC-2: it reaches the queue within 2 s; `answerCard` is write-once). Over `--dur-slow` the
card collapses in place (`grid-template-rows` 1fr → 0fr on the body) into a one-line receipt row
shaped like every other row in the product: what · cost · time, with "Sending in 5 s · Undo"
inside it. The worker sleeps 5 s before performing and honours `answer_withdrawn_at` on the
card (`decision_cards` is not append-only; the withdrawal is also written as an action row);
Undo sets it and the row reads "Withdrawn". The next card moves up for free because the list is
one server-rendered "Today's actions" list keyed by card id. On the detail page the same row
appears with the same Undo. Server failure: the row shows what failed and that nothing happened.

**Money and sends (spend from the user's account, outreach batch, go live, raise a cap).**
No tap, no undo. Pointer: hold the recommended or chosen option for 600 ms; a hairline fill
grows left to right inside the button (`data-motion="essential"`, driven by a
`requestAnimationFrame` timer on `pointerdown`, cancelled on `pointerup`, `pointercancel` or
`pointerleave`; `-webkit-touch-callout: none; user-select: none`), the label carries the
amount and the account: "Hold to spend $40 of ad budget from your Meta Ads account". Keyboard:
1/2/3 or Tab selects and relabels the option "Confirm: spend $40"; Enter commits; Esc cancels.
No timed key holds (auto-repeat, switch access and voice control cannot hold a key). The
receipt row then reads "Sent · $40 · 09:12" with no Undo.

Why this is the signature: gesture-paced motion never fatigues (it is as long as the user's own
hold), the collapse teaches "decision → receipt" without a sentence, and no competitor has a
physical gesture at the money moment.

**The page holds its breath (stop).** One tap. Within 100 ms, optimistically,
`<html data-stopped>` pauses every animation (`animation-play-state: paused; transition:
none`), running stream rows get a `--needle` hairline through them, the bar reads
"Stopped 14:02 · Resume" in `--needle`, and the action row lands within 5 s. Resume is one tap.

Later, **evidence draw-in**: a hairline draws (`stroke-dashoffset`, `--dur-base`) from an action
row to its verified evidence; dashed while unverified, solid when verified.

## Reduced motion

Under `prefers-reduced-motion: reduce`: every `--dur-*` becomes 0 except `--dur-fast` opacity
fades; view transitions off; the brief appears in one step; the card collapse is a cut to the
receipt row; the hold fill stays (it conveys state). Any information carried by motion has a
text or colour equivalent. The gate: `getAnimations()` empty except `[data-motion="essential"]`.

## 3D policy

3D is used only where the object is the product. Igloo and Lusion sell a studio's capability,
Stripe's globe shows a network, Apple's AirPods pages show a physical thing. North's product is
decisions, a brief, a ledger and agents: text and time. Rules:

- App routes: no WebGL, no canvas heroes. Budget 0 KB.
- Landing: one CSS-3D device, the demo card at `perspective: 1200px; rotateX(6deg)` that
  flattens as it enters the viewport (`animation-timeline: view()` where supported, static
  otherwise), ≤ 15 KB, no library, never the LCP element.
- Any future hero: ≤ 200 KB JS gzipped, poster `<img fetchpriority="high">` as LCP, canvas
  mounted after load and idle, static under reduced motion and on coarse pointers, 60 fps on a
  2020 phone, and it must win a founder-scored pairwise against its own screenshot before it
  ships. Three.js alone exceeds the budget.

## Anti-patterns (confirmed slop, grep for them)

Custom cursors and trails; 500 ms enters; `transition: all`; `scale(0)` enters; animated
gradient blobs behind headlines; parallax; scroll-reveal on sections (the five-row story on the
landing may use `view()` once, for the card device only); hover lift on every card; bounce
easing; pulsing dots; marquee; blinking cursor on static text; sound (an optional single soft
confirm on card answer, off by default, is the only sound allowed).
