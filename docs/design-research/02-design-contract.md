# 02 · Design contract: values, counts, slop tests, what stays and what goes

This is the `DESIGN.md` the designing agent starts from (impeccable's pattern: product context,
then a system with drift detectors). Numbers are limits a reviewer can count. Change a number
only with a written reason in the PR. Reviewed by three personas on 2026-10-17; the decisions
below are the merged result (`raw/review-*.md`, `raw/rebuttal-*.md`).

## Product context (the `PRODUCT.md` part)

- Audience: first, technical builders with a full-time job; then solo operators with revenue.
- Job: read the morning, answer at most a few cards (the quota, 1-5, default 3), trust the
  staff with the rest.
- Operating context: phone in the morning (390 px, one hand, 5 minutes), laptop in the evening.
- Voice: a competent chief of staff reporting to the CEO (`06`).
- Constraints: home paints in 1.5 s; answer queued in 2 s; PWA; offline brief; stop control on
  every screen; chat optional, never the primary surface.

## Values (the agent does not guess these)

### Type

One family. `Source_Serif_4` from `next/font/google` with `axes: ["opsz"]`, roman and italic
(two files, ~122 KB each, variable, `opsz` 8-60, `wght` 200-900; the Latin file carries `tnum`,
verified). Loaded in `apps/web/src/app/layout.tsx` as `--font-text`. Mono: `IBM_Plex_Mono`
400 only, as `--font-code`, used solely in `.prose-north code, pre` and on ids.

| Role | Size / line-height | Weight | `opsz` | Where |
| --- | --- | --- | --- | --- |
| display | 32 / 1.1 | 400 | 60 | H1, the brief headline, the card question on the detail page |
| title | 22 / 1.2 | 400 | 36 | section titles, the inline card question |
| body | 17 / 1.5 | 400 | 16 | prose, options, rows |
| small | 15 / 1.45 | 400 | 14 | secondary lines, default line, receipt rows |
| meta | 13 / 1.4 | 400 | 12 | dates, labels, tier words, column headers (sentence case) |

Weights 400 and 600 only (600 for the recommended option label and the stopped banner).
Numbers everywhere: `font-variant-numeric: tabular-nums`, right-aligned in rows. Headings
`text-wrap: balance`; body `text-wrap: pretty`. Reading column `max-width: 66ch`. Nothing is
uppercase-tracked; nothing is set in mono except code and ids.

### Colour (oklch; tokens in `globals.css`; Tailwind v4 reads them)

| Role | Light | Dark | Use |
| --- | --- | --- | --- |
| `--paper` | `oklch(99% 0.004 80)` | `oklch(17% 0.008 260)` | page background (dark is off-black *for reading comfort*, which is the written reason) |
| `--ink` | `oklch(15% 0.01 260)` | `oklch(94% 0.006 80)` | text, the filled control, rules at full strength |
| `--text-2` | `oklch(42% 0.012 260)` | `oklch(72% 0.01 80)` | secondary text |
| `--text-3` | `oklch(58% 0.01 260)` | `oklch(58% 0.01 80)` | meta, placeholders (≥ 4.5:1 on paper in both) |
| `--rule` | `oklch(86% 0.006 260)` | `oklch(30% 0.008 260)` | hairlines |
| `--surface` | `oklch(96.5% 0.005 80)` | `oklch(21% 0.008 260)` | the one elevated sheet; the offline banner |
| `--needle` | `oklch(52% 0.2 27)` | `oklch(68% 0.18 27)` | stopped, failed; nothing else |
| `--verified` | `oklch(48% 0.11 150)` | `oklch(72% 0.12 150)` | verified evidence, "live" |

Eight roles; alpha tints of `--ink` count as `--ink`. Links are ink, underlined, offset 3 px.
Warning and error states use `--needle` with a label; success uses `--verified`. The old
`*-bg` tints, `--link`, `--warning`, `--deep` are removed (keep `--deep: var(--needle)` as an
alias for one migration PR). Dark mode is this second column, never `filter: invert`, never a
bare swap; the accent is re-tuned per scheme as shown. Contrast: body ≥ 4.5:1, large text and
controls ≥ 3:1, both schemes (axe gate).

### Space, shape, elevation

Spacing scale, nine values: 4, 8, 12, 16, 24, 32, 48, 64, 96 (96 only between landing
sections). Inter-section gap ≥ 2 × the largest intra-section gap, so grouping is visible without
boxes. Radius: 0 surfaces, 2 px controls, 6 px the floating sheet. One shadow token, layered and
tinted with `--ink`, on the sheet only. Rules: 1 px `--rule`, between data rows and brief
sections only. Reading column 640-720 px; data screens (Ledger, Team) up to 1100 px; on a 1280
desktop Home keeps the reading column and places the day's actions list beside the brief
(two columns from 1024 px), so the width is used.

### Motion (one table; `05` explains it)

| Token | Value | Use |
| --- | --- | --- |
| `--dur-fast` | 120 ms | press, hover, toggles, opacity, exits, route cross-fade, stream rows |
| `--dur-base` | 200 ms | menus, option select, receipt row settle |
| `--dur-slow` | 280 ms | sheet, the card's collapse into its receipt row |
| `--dur-reveal` | 600 ms | the brief's first reveal of the day, nothing else |
| `--ease-out` | `cubic-bezier(0.23, 1, 0.32, 1)` | default |
| `--ease-in-out` | `cubic-bezier(0.65, 0, 0.35, 1)` | things already on screen moving |
| `--ease-exit` | `cubic-bezier(0.4, 0, 1, 1)` | leaving |

Only `transform`, `opacity`, `clip-path`, `stroke-dashoffset` animate; `height` may transition
once, for the card collapse, via `grid-template-rows` 0fr→1fr. `transition: all` never appears.
No literal duration or curve outside `globals.css`. Keyboard-initiated actions: 0 ms.
`[data-motion="essential"]` marks the two animations that survive reduced motion (the hold
fill, the spinner's text swap).

## Counts (the census the gate runs)

| Rule | Limit |
| --- | --- |
| Families per screen | 1 (+ mono only inside code/ids) |
| Sizes per surface | ≤ 5 (the roles above); display/body ratio ≈ 1.9 |
| Weights | 2 |
| Colour roles | 8; accent-coloured elements above the fold: 0 unless stopped or failed |
| Filled controls above the fold | ≤ 1 (the recommended option or the primary CTA) |
| Radii | 3 |
| Shadows | 1 token, sheet only |
| Spacing values | 9 |
| Durations | 4; easings 3 |
| Non-user-triggered motion per screen | ≤ 1 (the brief reveal), once a day |
| Card nesting depth | 1; boxes around sections: 0 |

## States

Every route ships six states, screenshotted in the five critic projects: default, empty,
loading (cold load only), error, offline, long content. An empty state names what will appear
and who makes it, and has at most one action.

## The slop catalogue (what the detector looks for)

Any survivor must have a one-line reason in this file.

- **Type:** one sans for everything; tracked uppercase eyebrow above headings; one italic or
  coloured word in a headline; display/body ratio < 1.5; gradient text; a mono face for data.
- **Colour:** indigo→purple gradients; neon on dark with glowing borders; radial halo behind the
  hero; cream + terracotta; tinted near-black without a written reason; grey text on colour.
- **Layout:** three identical rounded cards with icon tile + heading + text; cards in cards; one
  radius everywhere; the same `rgba(0,0,0,.1)` shadow under everything; `01 / 02 / 03` markers on
  non-sequences; a 4 px coloured left border on a non-alert; a big hero number with small stats;
  a grey box around every section.
- **Motion:** fade-and-slide-up on every section; hover lift on every card; bounce easing;
  pulsing status dot; marquee; blinking cursor; "thinking" shimmer; animated keyboard actions.
- **Copy:** headlines any product could say; "Not a feature. A platform."; em-dash in every
  sentence; "seamless", "supercharge", "AI-powered"; `→` after every link; errors that apologise.
- **Structure:** hero → three features → testimonials → pricing → FAQ regardless of product;
  missing empty/loading/error/offline states.

Written reasons for the survivors: hairline rules (they separate data rows: a receipt);
radius 0 (the slip and the sheet of paper); a serif (the subject is documents read by a CEO);
off-black dark paper (long serif reading on an evening laptop).

## Verdicts on the current system

| Element today | Verdict | Reason |
| --- | --- | --- |
| Instrument Serif + Newsreader + Geist Mono | Replace with Source Serif 4 (+ Plex Mono for code) | Three faces, two of them convergence defaults; one family with `opsz` and `tnum` does all roles |
| Geist Mono 11 px uppercase labels (279 uses of `mono-label`) | Remove; labels become `meta` (13 px, sentence case, `--text-3`) | Template chrome; mono body text overflowed the card |
| Middle-dot meta strings | Replace with aligned columns or two short lines | Cluster 5; harder to scan |
| Grey bordered box around every section | Remove; rules between rows only | Flat hierarchy |
| Zero radius | Keep (0 / 2 / 6) | Written reason above |
| Retro gradient button (62 uses) | Replace with the flat control; keep the class name for one migration PR | The press, not the paint, feels physical |
| Terminal strip, `cursor-blink`, ticker, `north-blink` | Delete | Theatre; motion on static text |
| ASCII spinner | Keep, only beside a named step, never alone > 2 s; `data-motion="essential"` | Honest and cheap |
| Orange `#e65100` (27 `*-deep` uses) | Replace with `--needle`, alias for one PR | A competitor's colour, and the wrong meaning |
| Red outlined "STOP ALL AGENTS" while idle | Ink outline while idle; `--needle` only when stopped | The stopped state deserves the colour, not the button |
| Black landing page | Landing follows the user's colour scheme like the app; no dark hero by default | Cluster 2 |
| Dark mode = inversion | Replace with the dark column above | Inversion distorts accent and reading |
| "Nothing." × 5 in the brief | One closure line; empty sections omitted | Five negatives read as dead |
| `MAX K0`, `CHIEF_OF_STAFF`, `signal.pursue` on screen | Plain labels; the code as a small meta word beside, never alone | Leaked identifiers (`06`) |

## Performance budgets are design rules

Home first paint ≤ 1.5 s on throttled 4G; card answer acknowledged ≤ 100 ms optimistically and
queued ≤ 2 s; LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1; no WebGL in app routes; landing JS ≤ 200 KB
gzipped; two font files, self-hosted via `next/font`, size-adjusted fallbacks so text never
shifts. No runtime dependency is added for motion (no Motion, Sonner, NumberFlow, Vaul): the
platform (`@starting-style`, `<dialog>`, `popover`, grid-rows transitions, `linear()` easings)
covers every interaction in `05`.
