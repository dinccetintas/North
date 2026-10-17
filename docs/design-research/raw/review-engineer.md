# Implementing-engineer review of docs/design-research (2026-10-17)

## Verdict

The direction and the critic are sound, but a fresh agent cannot start without guessing the six colour values, the fonts, the shared-element mechanism and the undo semantics, and 07's loop does not run as written here (wrong port, no critic Playwright project, `/wig` and `impeccable` unverified, `.critic` not ignored). The persona files the agent reads first (`north-frontend.md`, `north-design.md`) still prescribe the look 02 removes, so the docs lose by precedence until those change. The signature as specified (5 s undo before dispatch) breaks DEC-2 and the write-once `answerCard`; it needs a worker-side undo window, not a client delay.

## 1. Ambiguities

1. **Colour values.** 02:81 names six roles; 01:97 says "needle red"; 08:202 asks for "named oklch values" but none are given. Guess: ink `oklch(15% 0 0)`, paper `oklch(99% 0 0)`, greys 45 %/88 %, needle `oklch(55% 0.2 25)`, verified `oklch(50% 0.12 150)`; nothing says what replaces `--link`, `--warning`, `--error`, `--success-bg` (globals.css:16-23). *Edit 02 "Colour":* add a table of the six values per scheme with APCA Lc, and one line: "error = needle, warning = needle, link = ink underlined; the `*-bg` tints are removed".
2. **Fonts.** 02:75 offers Newsreader *or* three others, IBM Plex Mono *or* Commit Mono (not on Google Fonts). Guess: Newsreader with `axes: ["opsz"]`, IBM Plex Mono 400 only. *Edit 02:75:* "Newsreader variable (opsz 6-72), one file; IBM Plex Mono 400, one file; both via `next/font/google` in `apps/web/src/app/layout.tsx`."
3. **Answered strip.** 04:73 "one-line ledger"; 05:245 gives it as a middle-dot string, which 02:146 bans; today it is a `<details>` (decisions-section.tsx:75-91, testids `answered-cards`/`answered-card`). *Edit 04 "Home" §2:* "a three-column row: answer label · cost (mono, right) · time (mono); keep `data-testid="answered-cards"` and `answered-card`; the `<details>` becomes an always-open list of ≤ 3 rows plus 'n more'."
4. **State chip** (04:112) is undefined. Guess: 13 px sentence-case text, no dot, needle only for "waiting for you". *Edit 04 "Team":* define it and list `data-state` values.
5. **Sheet library.** 05:223 describes Vaul without naming it. *Edit 05:* "native `<dialog>` + `@starting-style`; no drag in v1" (see §4).
6. **View Transitions vs App Router.** 05:232 "cross-document VT for landing → login → onboarding": `/` → `/login` via `next/link` is same-document, so `@view-transition { navigation: auto }` never fires; login → onboarding passes through a magic-link email (flows.ts:16), so nothing navigates. Same-document VT in Next 16 needs `experimental.viewTransition` and React `<ViewTransition>` (React 19.3, package.json:28); a bare `view-transition-name` does nothing because the router never calls `startViewTransition`. *Edit 05 "Page transitions":* "Use `<a>` (not `<Link>`) for `/` → `/login` with `@view-transition`; app routes use React `<ViewTransition name>` behind `experimental.viewTransition`; drop the onboarding leg."
7. **Kill switch name survival.** `KillSwitch` sits in the company layout (layout.tsx:177), which persists across child navigation; `revalidatePath(..., "layout")` (actions.ts:45) re-renders it, but React keeps the node when type and position hold. kill-switch.tsx:180 returns a different element for billing pauses, which breaks that. *Edit 05:* "the stop control is always the same element; billing states change its content, not its type."
8. **Option fill "moves as one object"** (05:218) across separate buttons needs a shared background. *Edit 05:* "one positioned fill behind the option group, `translateX`; buttons are transparent."
9. **Keyboard.** 04:86 "instantly", 05:193 "0 ms", 05:249 "same at `--dur-fast`", 04:104 hold-to-confirm for money. *Edit 05 "Signature":* "keyboard: non-money answers commit at 0 ms; money cards require holding Enter 600 ms."
10. **Desktop width.** 1280 (02:99, 04:5, 08:214, playwright.config.ts:30) vs 1440 (07:14, 07:23). *Edit 07:* 1280 × 800.
11. **Six states for every route** (02:117) but nothing says how the critic reaches them on a production build behind RLS (seeded company, auth storage state, `page.route`, `setOffline`). *Edit 07 "Setup":* name a `e2e/critic/fixtures.ts` that seeds via `e2e/stack.ts` helpers and saves `storageState`.
12. **`tokens.json`** (07:61) does not exist; north-design.md:7 owns a non-existent `styles/tokens.css`; 08:205 says globals.css. *Edit 07:* "tokens live in `apps/web/src/app/globals.css`; the gate reads `apps/web/e2e/critic/tokens.ts`."

## 2. Contradictions

- **Persona files vs 02.** north-frontend.md:12-16 and north-design.md:41-45 mandate Instrument Serif, Geist Mono 11 px uppercase, `#e65100`, terminal stream, retro gradient buttons, dark = inversion; 02:143-157 removes each. The agent will follow the persona. *Edit both persona files* to point at `docs/design-research/02-design-contract.md` and delete the aesthetic paragraphs.
- **"Kill" never on screen** (06:181) vs CONTEXT.md:45 "Kill Switch" (CLAUDE.md: use glossary names in UI), brief-panel.tsx:288, offline-brief.tsx:82, labels.ts:23. *Edit CONTEXT.md:45:* "code name `KillSwitch`; on screen 'Stop all agents' / 'Stopped hh:mm'."
- **Middle dots** banned (02:146) yet used in 04:76, 04:101, 04:131, 04:171, 05:245, 06:180, 06:191. *Edit 02:146:* "banned as a label line above a heading; allowed inside a mono data row."
- **Stream rows** 120 ms opacity only (02:110, 05:188) vs 200 ms with `translateY` (04:118, 05:230). Pick 120, opacity.
- **Durations off-token:** 150 ms (05:227, 05:233), "600-700 ms" (05:248) vs 02:106. Pick 120 and 600.
- **Non-user-triggered motion ≤ 1 per screen** (02:109) vs ledger odometers (04:132) and stream fades.
- **TDD / Playwright first** (CLAUDE.md, north-frontend.md:23) vs 07's loop, which has no failing-test step. *Edit 07 step 1:* "write or adjust the e2e flow assertion before the token plan."
- **Zod at boundaries** (CLAUDE.md) vs 07:73 "judge returns coordinates; `elementFromPoint`": model output consumed unvalidated. *Edit 07:* parse every critic JSON with Zod.
- **File limits.** `decisions/[id]/page.tsx` is already 205 lines; 07's `gates.spec.ts` (20 gates × 4 variants) will pass 400. *Edit 07:* one spec per gate group.
- **`pnpm --filter web`** (north-frontend.md:25) matches nothing; the package is `@north/web` (package.json:2).
- **Ownership.** `apps/web/e2e/**` belongs to both north-frontend (md:8) and north-qa-validator (md:56).

## 3. Feasibility of 07's loop

- Package name `@north/web` is right. `next start` has no port (package.json:7), so "start on :3100" lands on :3000, and :3100 is the dev server the Inngest dev server targets (root package.json `inngest:dev`). *Use* `pnpm --filter @north/web build && pnpm --filter @north/web start -- -p 3200`, as `playwright.prod.config.ts` already does.
- `mobile` at 390 × 844 exists; no `critic-desktop`, no dark or reduced-motion projects. Add `apps/web/playwright.critic.config.ts` with four projects (`colorScheme`, `reducedMotion` in `use`) and `webServer` from the prod config; `playwright.config.ts:10` must also `testIgnore` `e2e/critic/**`, or `pnpm e2e` runs the critic with every milestone spec at `workers: 1`.
- `node_modules` is absent; step 0 is `pnpm install`.
- `pnpm add -D -w` puts axe at the root; use `pnpm --filter @north/web add -D @axe-core/playwright`.
- Lighthouse: follow `scripts/lighthouse-pwa.sh` (`npx --yes lighthouse@13`, `CHROME_PATH=/opt/pw-browsers/chromium`), no dependency.
- `impeccable` 4.6.0 is on npm (56 KB launcher); the registry is reachable, the binary host and the `detect` flags in 07:59 are not verified. Make it a soft gate (skip with reason), vendor the binary with a hash, add waivers for mono data and zero radius.
- `/wig` does not exist (`.claude/` holds `agents` and `launch.json`), and a slash command is a model step, so it cannot be a gate under "code decides" (07:25). Move it to heuristics.
- `.critic/` is not in `.gitignore`; add it.
- `apca-w3` (07:48) is not a listed dependency and has a non-OSI licence; say so or use axe's contrast only.

## 4. Dependencies

| Package | Licence, size | Verdict |
| --- | --- | --- |
| motion 14.3.0 | MIT, 809 KB unpacked (~30 KB gz for layout) | Replace with React `<ViewTransition>`; allow only if the Next flag proves unusable |
| sonner 2.0.8 | MIT, 174 KB | Replace: 05:218 already morphs the label in place ("Queued · Undo"); an inline `role="status"` row is the toast |
| @number-flow/react 0.6.2 | MIT, 25 KB | Replace: a ≤ 3×/day odometer is a 15-line CSS translate; 05:236 forbids frequent animation anyway |
| vaul 1.1.2 (+ Radix Dialog) | MIT, 184 KB + deps | Replace with `<dialog>`, `@starting-style`, `overscroll-behavior`; no drag in v1 |
| @axe-core/playwright 4.14 | MPL-2.0, 48 KB (dev) | Justified |
| lighthouse 13.5 | Apache-2.0, 19 MB | Justified via `npx`, not a dependency |
| impeccable 4.6.0 | Apache-2.0, launcher + binary | Optional, vendored |

Minimal set: no runtime additions; dev: `@axe-core/playwright`. *Edit 05 "Tokens":* replace "Springs (Motion for React…)" with "No animation library; springs are CSS `linear()` easings."

## 5. Signature interaction risks and shape

- **DEC-2 conflict.** SPEC.md:102/198: the answer reaches the queue in 2 s. A 5 s client-side undo before `answerCardAction` makes it ≥ 5 s. `answerCard` is write-once (actions.ts:72 `AlreadyAnsweredError`) and the worker settles within 2 s (actions.ts:48), so a post-send undo is impossible today. A client delay also loses answers when the PWA closes inside the window. **Resolve:** commit immediately; the worker's `decision/answered` handler sleeps 5 s (`step.sleep`) and checks `answer_withdrawn_at` on `decision_cards` (not an append-only table per CLAUDE.md §3); `withdrawAnswerAction` sets it and writes an action row. Undo only for one-tap non-money cards; hold-to-confirm and keyboard money answers have no undo. This is backend work; 04/05 must say which persona owns it.
- **Shape.** `DecisionCard` stays client with a state machine `waiting → queued(undo) → answered | failed`, timer in a ref (React Compiler is on, next.config.ts:5). `revalidatePath(layout)` (actions.ts:79) moves the card from `pending` to `answered-cards` server-side; optimistic and server rows share `<ViewTransition name={card-${id}}>` keyed by id so the flight happens once.
- **iOS Safari.** A 600 ms hold triggers the callout and selection: `-webkit-touch-callout: none; user-select: none`, pointer events with `pointercancel` on scroll; `:active` is unreliable on iOS, use `[data-pressed]`. VT and `@starting-style` need Safari 18/17.5.
- **Firefox.** 05:234 "cuts" is right; `text-wrap: pretty` needs a fallback.
- **`useTransition`.** `pending` disables every button (decision-card.tsx:108); undo must stay enabled and outside `aria-busy`.
- **Kill switch hold.** e2e `click()` (m0:37, flows.ts:72) fails under hold-to-confirm; use `click({ delay: 650 })`. "Holds its breath in 100 ms" is an optimistic `data-stopped` on `<html>` before `toggleKillSwitchAction` (awaits `inngest.send`, actions.ts:41).

*Edit 05 "Signature":* replace "the label becomes Queued · Undo for 5 s. Then …" with the commit-then-withdraw sequence above and the undo scope.

## 6. Migration order

1. Persona files and CONTEXT.md:45.
2. Tokens PR in `globals.css`: six oklch roles, four durations, three easings, spacing override, with aliases (`--deep: var(--needle)`) so the 27 `*-deep` uses and 62 `retro-button` uses keep compiling; fonts swapped in `layout.tsx` only. No layout change; e2e stays green.
3. Delete: `TerminalStrip` (app/page.tsx:3), `cursor-blink` (4 files), the gradient inside `retro-button` (keep the class for one PR), `north-blink`.
4. Decision card + answered strip + signature (smallest, best covered). Move e2e from text to attributes in the same PR: `toContainText("Approve")` (m2:60,71; m3:78,113; m4:80,128,180; m5:48,97,163) → `toHaveAttribute("data-answered", "approve")`; `"No answer by the deadline → Decline"` (m4:120) → `data-default="decline"`; `toContainText("K2")` (m2:31, m3:32, m4:72,118, m5:78) → `data-tier`; option ids stay `approve`/`decline` so `answer-<id>` testids survive while labels change (labels come from `packages/core`: 06 rule 3 is a core change).
5. Stop control: `toHaveText("Stop all agents")`/"Resume agents" (m0:34,38, flows.ts:72) survive; `"All agents are stopped"` (m0:39) and brief "Morning brief" (m5:66) change with copy; update in the same PR.
6. Home header and brief (`Nothing` removed, brief-panel.tsx:201), then Team, Ledger, landing, dark palette, Settings.

## 7. Missing from 08's header

The six colour values and two font files; the route, seed and storage state for the screen; the four Playwright projects and the :3200 production server; where iterations (`.critic/`) and finals (`docs/evidence/design/<screen>/`) go; the testid and data-attribute contract ("never rename"); the e2e-copy rule from §6; the dependency policy (no runtime additions); the Next flag `experimental.viewTransition`; the DEC-2 resolution; that `pnpm install` precedes everything; how the $25 budget is measured; which persona owns the worker change for undo. *Edit 08 header:* add a "Facts" block listing these twelve lines.

## The five edits I would insist on

1. **02 "Colour" and "Faces":** the six oklch values per scheme and the two exact font files; remove the alternatives.
2. **05 "Signature" and 04 "Decision card · States":** commit immediately, worker-side 5 s withdraw window, undo only for one-tap non-money cards; name the backend owner.
3. **07 "Setup" and step 2:** `playwright.critic.config.ts` with four projects at 390 × 844 and 1280 × 800, production on :3200, `pnpm install` first, `.critic/` in `.gitignore`, `/wig` and `impeccable` moved to soft heuristics.
4. **`.claude/agents/north-frontend.md` and `north-design.md`:** replace the aesthetic paragraphs with a pointer to 02; fix `--filter web` to `--filter @north/web`.
5. **05 "Page transitions" and "Tokens":** React `<ViewTransition>` behind `experimental.viewTransition`, `<a>` for landing → login, no Motion, Sonner, NumberFlow or Vaul.
