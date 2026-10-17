# 10 · Handoff to Claude Design, and from Claude Design to the build session

Checked on 2026-10-17 against Anthropic's "Get started with Claude Design" help article and
its announcement: Claude Design builds from a **design system** you import (from a GitHub repo,
design files, raw uploads or a local codebase via `/design-sync`), takes uploads (screenshots,
documents, decks, codebases) and prompts that name goal, layout, content, audience and devices,
checks its output against the imported system, and exports as .zip, standalone HTML, PDF/PPTX
or "Send to Claude Code". Standalone claude.ai/design closes on 14 December 2026; design
systems move into the main Claude app. Usage counts against the plan's limits.

## Straight answer

The ten research documents are the contract for the **build** session, not an input for Claude
Design. Handing them over as they are would give Claude Design 15,000 words of Playwright
commands, repo paths and rubric mechanics it cannot act on, and no design system to check
against. What Claude Design needs is in `claude-design/`:

| File | Purpose |
| --- | --- |
| `claude-design/system/tokens.css` + `system/previews/*.html` | The design system to import: the eight colours, five type roles, the control, the row, the card, the brief; each preview carries an `@dsCard` marker so `/design-sync` builds the cards |
| `claude-design/BRIEF.md` | The one upload that replaces the ten docs: product, feeling, direction, the screens in order, the voice, the banned list |
| `claude-design/SAMPLE-DATA.md` | Real words and numbers for every screen, so nothing is invented |
| `claude-design/PROMPTS.md` | Nine prompts in order (setup, Home, card states, desktop and dark, landing, Team and Ledger, onboarding, the rest, stop and states) |
| `claude-design/REVIEW-PROMPT.md` | The ten-principle critique adapted to what Claude Design can see; paste after each screen |

## Step by step

1. **Import the design system.** From Claude Code on your machine, in the repo: `/design-sync`
   and point it at `docs/design-research/claude-design/system/` (the previews already carry the
   `@dsCard` markers). Name the project "North". If you prefer the app's own importer, upload
   `tokens.css` and the six previews as a raw upload instead. Turn on **Published** when the
   generated UI kit matches `BRIEF.md`'s direction; if it does not, upload the Home preview
   screenshot from step 3 and regenerate.
2. **Start a design project** on that system. Upload `BRIEF.md` and `SAMPLE-DATA.md`
   (markdown uploads are accepted; if an upload is refused, paste the text into the chat).
   Send prompt 0 from `PROMPTS.md` and read the confirmation; correct it before continuing.
3. **Design in the order of `PROMPTS.md`.** Home first, because every other screen reuses its
   components; ask for two variants where the prompt says so; use inline comments for local
   fixes and chat for system-wide ones. After each prompt, paste `REVIEW-PROMPT.md`, fix only
   Blocker and High, review once more, then move on. Keep every variant; a middle one is often
   the best.
4. **Your own check on each screen** (what the critic prompt cannot do): tip your head back
   and squint at the first viewport: one headline, one dark control, nothing else should
   survive. Count the filled controls above the fold (one). Read the strings aloud (`06`). Look
   at the dark scheme beside the light: same order of importance.
5. **Export.** "Export → standalone HTML" (or .zip) for every screen and state, into
   `docs/evidence/design/<screen>/` in the repo, plus one PDF of the whole set for reading on a
   phone. Keep the share URL in `docs/evidence/design/README.md`. The HTML is the source of
   truth for the build session; the PDF is for you.
6. **Start the build session** with the header in `08-skills-playbook.md`, adding one line:
   "The approved designs are under `docs/evidence/design/`; match them, and where a design and
   `02` disagree, `02` wins and you say so." Use "Send to Claude Code" from Claude Design only
   as a convenience; the repo copy is what the build session reads.

## What Claude Design cannot verify (leave it to the build session)

Motion timing and easing, the press and hold feel, the 5-second undo and the worker-side
withdrawal, keyboard flows, real data states behind auth, performance budgets, contrast at the
computed-style level, the six states on live routes. Claude Design shows how a hold-to-confirm
button looks; `07` proves how it behaves.

## What to watch for in Claude Design's output

It will tend to add what the banned list forbids: a grey box around every section, icon tiles,
a three-card feature row on the landing, a gradient hero, uppercase tracked labels, a second
accent. The review prompt catches these; so does counting. If a generated UI kit shows a
second font or a purple anywhere, the import did not take: re-upload the kit and regenerate
before designing a screen.
