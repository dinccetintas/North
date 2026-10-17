# Critic review of docs/design-research (drafts of 2026-10-17)

## (a) Verdict

The verification layer (07) and the voice rules (06) are the best design-ops writing in this repo; the visual direction (01/02) is the weakest: it is the AI "editorial" default with the ornaments removed and the skeleton kept, and it never names the two things an agent most needs: type sizes and colour values. The docs contradict each other on motion numbers, the fold, the accent, keyboard timing and their own copy rules often enough that an agent following them verbatim would fail its own gates. Fix the five edits in (d) and this is shippable.

## (b) Answers

### 1. Direction: choice or filed-off default?

Mostly the default. The cluster quoted in 01:113-117 is "hairline rules, zero radius, tracked eyebrow, mono for small data". The proposed system keeps hairlines, zero radius, mono for data, uppercase tracking (badges, headers) and a Google-Fonts text serif; it removes ticker, cursor, gradient and orange: ornaments, not structure. Swapping Instrument Serif for Newsreader (02:27) swaps one AI-shortlist serif for the next. The evidence for "quiet" (01:76) is linear, raycast, family.co: three sites from the design-engineer circle whose essays make up `09`. That is selection bias, not a finding.

Strongest alternative, "the receipt": North's subject-specific artefacts are the decision slip and the ledger, not the memo. One family (a text serif with opsz and `tnum`), tabular lining figures for every number, mono demoted to ids and code. Rules as the only structural device (every row sits on a rule, no boxes), amounts right-aligned, the card a stub that detaches. Neither editorial nor terminal, and it kills the serif+mono pairing that is the strongest "AI made this" tell. I would ship the memo direction with that amendment. Edit 02:20 to: `1 text family with opsz + tnum for all text and numbers; mono only for ids, hashes and code in artifacts`.

### 2. Red for needs-you, stopped and failure

For: all three mean "the human must look"; one hue is learnable; the compass story is good. Against: a waiting card is the *expected* daily event (3×/day); stopped is the user's own safe act (05:75 "safety reads as power"); failure is the system's fault. Painting the ritual in the alarm hue contradicts "Calm" (01:69) and repeats audit finding 7 (red STOP "reads as alarm"). Frequency decides too: red seen every morning stops meaning "something is wrong", and a failed ledger row reads as "a card". Decide: split. Needle red = "agents are not running" (stopped, failed); the waiting card is loud by size and by being the only ink-filled control. Edit 01:146-148 and 02:34: `The needle red is used only for the stopped state and a failure. A waiting card is the largest and the only filled element on Home; it carries no hue.` Update 07:71 to "fill", not hue.

### 3. The counts

Two families: fine (one is better). ≤4 sizes on Home (02:21): too tight; Home needs bar, headline, question, body, meta and button label, so agents will cheat with weight and line-height. Six colours (02:33): will hurt; muted text, faint text, hairline and the elevated surface are already four greys, and "paused by billing" (04:83) and "failed" (04:103) have no colour at all. Spacings: add 96 for landing sections (02:46). Four durations: the authors wrote 150 ms twice (05:49, 05:55), so the agent will too. Missing count: weights (prose already uses 600). Edit 02: `Sizes 13/15/17/22/32 px, ≤5 on every surface; weights 400 and 600 only. Colour: 8 roles: ink, paper, text-2, text-3, rule, surface, needle, verified; alpha tints of ink count as their parent.` Replace 150 ms in 05 with `--dur-fast`.

### 4. The signature

Emil's table (05:11) gives 1-10×/day actions ≤300 ms, interruptible; the signature is 200 ms select + 5 s undo + 320 ms flight + odometer, seen ~60 times by day 20 (Rauno's "cognitive burden"). It also misfires: it flies *after* the undo window (05:65-67), so it is non-user-triggered when it plays (violating 02:61) and plays while the user reads card 2. On a 390 phone with two more cards the strip "under the cards" (04:72) is below the fold: the card flies off-screen in the designed context. On `/decisions/[id]` there is no strip (04:101), so the signature exists on Home only. A gimmick with a good idea inside. Better: collapse-in-place at tap (the card becomes its own receipt row, shaped like a ledger row, with Undo inside it; the next card moves up), and make hold-to-confirm the true signature: gesture-paced motion never fatigues, and no competitor has it at the money moment. Edit 05 §signature: replace "Then the card shrinks … flies … into the answered strip" with `On tap the card collapses in place over --dur-slow into a one-line receipt row (action · cost · time) that stays where the card was and holds Undo for 5 s; the next card moves up.` Delete the strip from 04:72.

### 5. See (c).

### 6. Untestable or mis-tested

- 01:154 "300 ms flash": nobody can flash an image at a model; 07 uses 5 s. Say 5 s.
- 01:162 / 07:92 Restraint "if nothing is lost": who measures loss? Make it a pairwise with/without crop, preferred in both orders.
- 02:46 "sibling gaps … not all identical across the page" forbids rhythm; replace with `inter-section gap ≥ 2× intra-section gap`.
- 07:51 "every `p` 45-75 characters" counts characters, not measure; "Nothing else needs you today" fails. Test the column's `max-width` in `ch`.
- 07:55 `getAnimations() === 0` cannot see a `setInterval` spinner (05:53) or rAF springs, and 05:82 keeps 120 ms fades and the hold fill, so every correct build fails. Define `[data-motion="essential"]` in 05.
- 07:56 "feedback ≤200 ms" undefined; the 320 ms signature and 600 ms reveal fail it.
- 04:59 "reads better than the user wrote it", 05:98 "sells the same", 01:83 "90/10": no procedure; give a pairwise call or label them guidance.

### 7. Missing (the agent will guess, generically)

Type-scale and colour values in oklch, light and dark (spacing, radii, durations are named; the two most visible axes are not). A component inventory so 07:86 "same look" can be diffed. Focus ring. Form controls: the onboarding "dial" (04:50) has no visual. Mobile nav: 04 never places Home/Team/Ledger/Artifacts at 390. Ledger row at 390: four fixed columns (04:127) do not fit; a stacking rule. Desktop Home: audit item 3 is unaddressed; 02:51 re-specifies the empty centred column. Wordmark, icons, number formats. The landing in dark for `prefers-color-scheme` users (04:14 vs 07:21). Add `02 §Values` and `04 §Shared components`.

### 8. The founder's ask

The founder's brief appears nowhere in the drafts (raw 02:3 only), so the designing agent cannot weigh it. The pushback rests on three sites from one taste community plus Fogg/Lindgaard, who say first impressions matter, not that they must be quiet: that part is taste with footnotes. The pushback *is* justified on grounds the docs underuse: the budgets (home 1.5 s on 4G, PWA, offline) and Kerem's fear that theatre means fake (03:28). Concede, explicitly: (1) "wow on every button" = press scale, hold fill and instant state on every pressable, already specified but framed as refusal; reframe it as the answer. (2) "futuristic" = a first-class designed dark theme for the evening laptop (02:11). (3) "3D maybe" = the one CSS-3D landing device (05:93) is the demo card you tip and answer, plus a budgeted hero experiment that must beat its own screenshot in a founder-scored pairwise. (4) "modern" = tabular figures, not typewriter mono, in the instrument register. Edit 01: add `## The founder's brief and our answer`, four rows: ask · what ships · evidence line.

## (c) Contradictions

1. README:38 "eight principles" vs 01:151 "Ten principles".
2. README:6 raw reports "in git history" vs `raw/` in the tree.
3. 01:101 "five sizes" vs 02:21 "≤4 (Home, Card)".
4. 02:58 four tokens vs 05:49 "exit 150 ms", 05:55 "150 ms cross-fade"; 02:62 nav ≤120 ms vs 05:55 app routes 150 ms.
5. 05:11 "≤300 ms" for card answer vs 05:22 `--dur-slow: 320ms` used at 05:66.
6. 05:15 keyboard "0 ms" and 04:86 "instantly" vs 05:72 "at `--dur-fast`".
7. 05:10 / 02:62 stream rows "≤120 ms opacity only" vs 05:52 / 04:118 200 ms with `translateY`.
8. 05:82 reduced motion keeps 120 ms fades and the hold fill vs 07:55 `getAnimations().length === 0`.
9. 07:56 "feedback ≤200 ms" vs 05:22 320 ms and 05:23 600 ms.
10. 02:61 one non-user-triggered motion (the brief) vs 05:65-67 the flight fires 5 s after the tap.
11. 04:13 landing fold = H1 + gate sentence + CTA + brief + card vs 07:54 "landing: H1 + CTA"; 02:52 primary action in the bottom half vs 04:13 CTA under H1.
12. 04:67 brief headline "the page's largest text" vs 04:93 inline card question "the largest text on the screen".
13. 02:52 tap targets ≥44 px vs 07:49 "all controls ≥24 px".
14. 02:23 measure 60-70 ch vs 07:51 45-75 characters.
15. 02:45 spacing 100 % on scale vs 07:52 "≥95 %".
16. 06:126 "never we", 07:63 "we/our = 0" vs 04:40 "We email you a link", 04:47 "What are we building?", 04:48 "why we ask".
17. 04:13 H1 "contains a North noun" (raw 01:108: card, brief, staff, ledger, gate) vs 06:133 recommended H1, which contains none; option B also fails.
18. 02:65 forbids scroll-reveal on sections vs 04:30 allows it for the five-row story vs 05:103 forbids it on "every" section.
19. 03:49 recommended option "never pre-selected" vs 04:94 "the only filled control" (fill is the cue in 07:71).
20. Receipt row: 04:101 "Answered · Send 5 emails · 09:12" vs 05:66 "Send 5 emails · $0 · 09:12" vs 06:175 "action · before → after · cost · evidence".
21. 04:169 hold 600 ms vs 05:70 and 03:78 "600-700 ms".
22. 07:137-138 pivot on "5-second recall" maps to raw's Intent principle, which 01's ten omit; 07:80 weights do not include it.
23. 02:36 forbids `#e65100` vs raw 01:89, the rule it cites, which prescribes it.
24. 04:14 landing "in the app's light theme" vs 07:21 landing rendered and gated in dark.

## (d) Five edits before an implementing agent sees this

1. **02 §Values.** Five sizes with line-heights, two weights, eight colour roles as oklch in light and dark. Counts without values are not a system.
2. **Accent semantics.** 01:146-148, 02:34, 07:71: needle red = stopped and failed only; the waiting card is loud by size and ink fill.
3. **Signature.** 05 §signature and 04:72: collapse-in-place at tap with Undo in the row; no delayed flight, no strip; hold-to-confirm named as the second signature.
4. **One motion table.** Reconcile 02:58-65, 05:10-27, 05:49-55, 05:72, 05:82 and 07:55-56 to the four tokens; define `[data-motion="essential"]`; keyboard = 0 ms; stream rows = `--dur-fast` opacity only.
5. **Self-consistency pass.** Rewrite the H1 options to pass 04:13's own test or drop the noun rule; remove "we" from 04; make 07:54 match 04:13 or cut the demo card from the 390 fold; resolve 04:67 vs 04:93 (on Home the headline wins).
