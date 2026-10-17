# Current-state audit (orchestrator, from docs/evidence screenshots M2-M6 + code)

Method: read apps/web source + looked at home-brief (390/1280), card-detail-signal (390),
team-stream (1280), settings, billing screenshots. Named-principle critique, not taste-talk.

## What is already right (keep)
- Honest information: every card shows tier, cost, deadline, safe default, facts. Nothing is hidden.
- One accent colour, serif display, mono labels: a recognisable, non-generic base (no Inter, no purple).
- Kill switch everywhere; "No answer by the deadline → X" line; "Written by the Chief of Staff from the ledger".
- Deterministic brief; evidence links on done tasks; radius 0/2px, hairlines: coherent "editorial terminal".
- Performance budget (home 1.5 s, card answer 2 s), PWA, offline brief.

## What is wrong, by principle
1. HIERARCHY. Every section is the same grey bordered box with a mono label on top (brief, decisions,
   signals, goal, this week, first 24 h, artifacts). The screen does not answer "what needs me?" at a
   glance; the one thing that matters (a pending card) has the same visual weight as "Signals: Nothing."
   Evidence: home-brief-mobile is ~9,200 px tall at 390 wide; a pending card sits ~1,900 px down.
2. EMPTY STATES. "Nothing." appears 4-5 times in one brief (today, signals, escalations, decisions).
   The product's quiet days read as dead, not calm. A premium ritual needs "all clear" to feel earned.
3. RHYTHM / DENSITY. Mobile home is a scroll of boxes; 5-minute ritual is not reachable in 5 minutes
   on a phone. Desktop is a 768 px column centred in 1280 with nothing around it: no use of width.
4. TYPOGRAPHIC CRAFT. Mono uppercase is used for *everything secondary*, including a 90-character
   URL inside the card facts (breaks the layout, overflows the card at 390). Uppercase mono at 11 px
   carries too much of the content (spend lines, goal lines); it is a label style, not a body style.
5. FEEDBACK / LIVENESS. Nothing moves except a blinking cursor and an ASCII spinner. "Agents are
   working for you" is the whole promise, and it is invisible on home; the terminal is only on Team.
6. PRESS AND STATE. Buttons have no :active, no transition, no focus ring beyond browser default;
   the answered state of a card is a green mono line; the moment of decision (the product's core) has
   no ceremony and no undo.
7. KILL SWITCH TONE. A red outlined "STOP ALL AGENTS" button is the loudest element on every screen.
   It reads as alarm, not control. It should be present and calm (premium = control without noise).
8. LANDING. Black page, terminal strip, orange ticker, one headline: structurally the Polsia layout.
   It says what North does but shows nothing (no product, no brief, no card). "Feeling" is absent.
9. CARD DETAIL. "Why" box repeats the facts (same URL twice); "At a glance" grid repeats tier/cost/
   deadline/default already shown in the card; signal excerpt shows raw `<b>` tags.
10. NAMING ON SCREEN. `MAX K0`, `CHIEF_OF_STAFF`, `signal.pursue`, `K2 · your call` leak internal
    identifiers into the UI (Team role cards, card header). The glossary names are good; the codes are not copy.
11. DARK MODE is a pure inversion (#000 bg): fine for the terminal, harsh for long serif reading.
12. NO MOTION SYSTEM, NO SPACING SCALE, NO COMPONENT STATES documented; `globals.css` has 4 utilities.

## Opportunities only North has (signature candidates, to be judged by the practitioner persona)
- The decision moment: a card answered is money/reputation moved; make it the one ceremonial interaction.
- The brief: a daily, finite, closable ritual ("done for today").
- The ledger: proof. "Every dollar, every result" as a living artefact.
- Agents working: the terminal stream as ambient, calm liveness on home (one line, expandable).
- The kill switch: a physical-feeling control (hold to stop), the product's trust anchor.
