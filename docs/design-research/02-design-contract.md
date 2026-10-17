# 02 · Design contract: the counted system, the slop tests, what stays and what goes

This is the `DESIGN.md` the designing agent starts from (impeccable's pattern: product context,
then a system with drift detectors). Numbers are limits a reviewer can count. Change a number
only with a written reason in the PR.

## Product context (the `PRODUCT.md` part)

- Audience: first, technical builders with a full-time job; then solo operators with revenue.
- Job: read the morning, answer at most three cards, trust the staff with the rest.
- Operating context: phone in the morning (390 px, one hand, 5 minutes), laptop in the evening.
- Voice: a competent chief of staff reporting to the CEO (`06`).
- Constraints: home paints in 1.5 s; answer queued in 2 s; PWA; offline brief; kill switch on
  every screen; no chat as the primary surface.

## Type

| Rule | Limit | Test |
| --- | --- | --- |
| Families per screen | 2: one text serif (display and body via optical size), one mono for data only | computed `font-family` census |
| Sizes per surface | ≤ 5 (dense screens: Ledger, Team) ; ≤ 4 (Home, Card) | computed `font-size` census |
| Display/body ratio | ≥ 2.0 on landing, brief headline and card question; ≤ 1.6 on dense screens | ratio of largest to body size |
| Body | 17-19 px, line-height 1.5-1.6, measure 60-70 ch, `text-wrap: pretty` | computed styles |
| Headings | `text-wrap: balance`, no one-word orphan at 390 px | screenshot |
| Mono | numbers, costs, times, ids, tier badges, column headers. Never labels above headings, never body text, never a URL inside a card | selector rule: `.mono` ancestor is not preceding an `h1-h3` |
| Uppercase + tracking | only tier badges and table column headers | count of `text-transform: uppercase` elements preceding a heading = 0 |
| Faces | Serif: Newsreader (opsz axis; already in the repo) as the single family, or a text serif with real optical sizes (Source Serif 4, Literata, Spectral). Drop Instrument Serif (now a convergence default). Mono: IBM Plex Mono or Commit Mono; drop Geist Mono (flagged overused). All OFL, self-hosted via `next/font` | font census; licence file |

## Colour

| Rule | Limit | Test |
| --- | --- | --- |
| Palette | ≤ 6 named values in light: ink, paper, two greys, needle (accent), verified (green). Dark: a designed set with the same six roles | `:root` token count |
| Accent | one hue, used only for: a card waiting for the user, the stopped state, a failure. Never on decoration, never on more than one filled element above the fold | count of accent-filled elements above fold ≤ 1 |
| Verified green | only on evidence that is verified and on "live" | grep |
| Forbidden | Polsia `#e65100`; Anthropic `#D97757` and cream `#F4F1EA`; any gradient with a stop in hue 240-290 (oklch); glows (`box-shadow` blur > 24 px with chroma); gradient text; grey text on coloured backgrounds | grep + computed style |
| Dark mode | a designed palette (off-black paper for reading comfort is allowed *because of* reading comfort; say so), accent re-tuned for contrast; never `filter: invert` or a bare swap of ink and paper | token diff; WCAG AA on every text node |
| Contrast | body ≥ 4.5:1, large text and controls ≥ 3:1, both modes | axe |
| Colour space | tokens in `oklch` (Tailwind v4 native) | grep |

## Space, shape, surfaces

| Rule | Limit | Test |
| --- | --- | --- |
| Spacing scale | 8 values: 4, 8, 12, 16, 24, 32, 48, 64 | grep for other px/rem gaps |
| Grouping | the gap between sections is larger than any gap inside a section (grouping must be visible); sibling gaps inside a section are not all identical across the page | gap census |
| Radius | 3 values: 0 (surfaces), 2 px (controls), 6 px (floating sheet only) | grep |
| Cards | nesting depth 1; the decision card is the only elevated surface; no identical grey box around every section | DOM check: `.card .card` = 0 |
| Rules | hairlines only where they separate rows of data or the brief's sections; never as decoration around a paragraph | screenshot |
| Shadows | one layered, tinted shadow token for the floating sheet; nothing else casts a shadow | grep `box-shadow` count ≤ 1 token |
| Layout width | reading column 640-720 px; Home and Card never wider; Ledger and Team may use a wider data column (960-1100 px) with the reading column for prose | screenshot at 1280 |
| Mobile | 390 px: no horizontal scroll, 16 px gutters, tap targets ≥ 44 px, primary actions in the bottom half of the first viewport | Playwright |

## Motion (details in `05`)

| Rule | Limit | Test |
| --- | --- | --- |
| Durations | 4 tokens: 120 / 200 / 320 / 600 ms; nothing else outside `globals.css` | grep literal `ms` |
| Easings | 3 tokens; no overshoot (`cubic-bezier` y > 1 forbidden) | grep |
| Properties | only `transform`, `opacity`, `clip-path`, `stroke-dashoffset`; `transition: all` = 0 | grep |
| Non-user-triggered motion | ≤ 1 per screen (the brief's arrival on first open), ≤ 600 ms, once a day | review |
| Frequent actions | nav, keyboard, hover, stream rows: 0-120 ms, opacity only | review |
| Press | every pressable: `:active` scale 0.97, 120 ms ease-out, `touch-action: manipulation` | grep |
| Reduced motion | honoured on every animation; state conveyed by motion has a non-motion equivalent | grep + screenshot |
| Forbidden | marquee/ticker, blinking cursor on static text, pulsing dots, scroll-reveal on sections, hover lift on every card, CSS spinner glyphs, custom cursors, sound by default | grep |

## States

Every route ships six states, screenshotted at 390 and 1280 in light and dark: default, empty,
loading (cold load only), error, offline, long content. An empty state names what will appear
and who makes it, and has at most one action.

## The slop catalogue (what the detector looks for)

Grouped; each item has a test. Any survivor must have a one-line reason in this file.

- **Type:** one sans for everything; tracked uppercase eyebrow above headings; one italic or
  coloured word in a headline; display/body ratio < 1.5; gradient text.
- **Colour:** indigo→purple gradients; neon on dark with glowing borders; radial halo behind the
  hero; cream + terracotta; tinted near-black without a reason; grey text on colour.
- **Layout:** three identical rounded cards with icon tile + heading + text; cards in cards; one
  radius everywhere; the same `rgba(0,0,0,.1)` shadow under everything; `01 / 02 / 03` markers on
  non-sequences; a 4 px coloured left border on a non-alert; a big hero number with small stats.
- **Motion:** fade-and-slide-up on every section; hover lift on every card; bounce easing;
  pulsing status dot; marquee; blinking cursor; "thinking" shimmer; animated keyboard actions.
- **Copy:** headlines any product could say; "Not a feature. A platform."; em-dash in every
  sentence; "seamless", "supercharge", "AI-powered"; `→` after every link; errors that apologise.
- **Structure:** hero → three features → testimonials → pricing → FAQ regardless of product;
  missing empty/loading/error/offline states.

## Verdicts on the current system (justified, changed, or removed)

| Element today | Verdict | Reason |
| --- | --- | --- |
| Serif display + serif body | Keep as one family with optical sizes | The brief and artifacts are documents the CEO reads; motivated by the subject |
| Instrument Serif | Replace | Now a convergence default; Newsreader's display opsz covers the role |
| Geist Mono 11 px uppercase labels everywhere | Restrict to data and tier badges; labels become 13 px sentence-case text | Template chrome (cluster 5); mono body text is hard to read and overflowed the card |
| Middle-dot meta strings (`K2 · your call · $0.00`) | Replace with two short lines or a small table | Cluster 5; harder to scan than aligned columns |
| Hairline borders around every section | Remove; keep rules only between data rows and brief sections | Flat hierarchy; everything looked equally important |
| Zero radius | Keep 0 on surfaces, 2 px on controls, 6 px on the sheet | Instrument register; stays, with a reason |
| Retro gradient button | Remove; replace with a flat control that moves on press | Borrowed from Polsia; the press behaviour, not the gradient, is what feels physical |
| Terminal strip, blinking cursor, ticker | Remove from product and landing | Polsia's theatre; motion on static text; a tell |
| ASCII spinner | Keep, only beside a named step ("Reading inbox…"), never alone > 2 s | Honest, cheap, on-brand for the instrument register |
| Orange `#e65100` | Replace with the needle accent | A competitor's colour; also reads as warning |
| Black landing page | Make a decision, not a default | Dark-with-one-accent is cluster 2; the landing should show the product in its real light theme |
| Dark mode = inversion | Replace with a designed palette | Inversion distorts the accent and makes long serif reading harsh |
| Grey "Nothing." in five brief sections | Replace with one "Nothing else needs you today" line and collapsed sections | Five negatives read as dead; one closure reads as calm |
| `MAX K0`, `CHIEF_OF_STAFF`, `signal.pursue` on screen | Replace with plain labels; codes may sit in a mono badge beside the label | Internal identifiers leaked into copy (`06`) |
| Red outlined "STOP ALL AGENTS" button, loudest element | Keep position; make it a calm instrument control with hold-to-confirm; accent only when stopped | Control without alarm; the stopped state, not the button, deserves the colour |

## Performance budgets are design rules

Home first paint ≤ 1.5 s on throttled 4G; card answer acknowledged ≤ 100 ms optimistically
and queued ≤ 2 s; LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1; no WebGL in app routes; landing JS
≤ 200 KB gzipped; fonts self-hosted, two files per family maximum, `font-display: swap` with
size-adjusted fallbacks so text never shifts.
