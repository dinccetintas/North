# 01 · Thesis: what North's interface is for, and what it must feel like

## The story the interface tells

Old world: a founder with a job runs the company in the gaps. A hundred suggestions a day, tools
that wait for them, work instead of results. The shift: agents can now research, build, market
and sell on their own. What they cannot do is decide for you. The enemy is two tools at once:
the one that does nothing while you sleep, and the one that does everything without asking.
The promise: your company runs all day; you make at most three decisions, each with a safe
default if you make none. The proof: a ledger of every action, what it changed and what it
cost; evidence on every finished task; your code in your GitHub; money only from your accounts;
one button that stops everything in five seconds. (Sources: Raskin, Miller, Duarte in `09`.)

Every screen is one scene of that story. Landing shows the proof. Onboarding hands over the
company. Home is the morning: the brief, the cards, "nothing else needs you". The card is the
decision. The ledger is the receipt. The team page is the staff at work. Settings is the
constitution. If a screen cannot say which scene it is, it is decoration.

## The feeling, in four words

**Command. Calm. Evidence. Speed.** The user should feel like a CEO reading a memo from a chief
of staff who has already done the work, not like a prompt engineer watching a terminal. Norman's
reflective level (what owning this says about me) is where Apple wins; North's reflective
message is "I run a company; my staff is software." (`09`: Norman; Ive.)

## Why "premium" is quiet, not loud

Live markup of linear.app, raycast.com, family.co and vercel.com/ship (October 2026) shows no
canvas, no video hero, no Lottie: typography, screenshots and restraint. Their "wow" comes from
four mechanisms, and all four are available to North for free:

1. **Speed.** Nothing waits. Optimistic writes, no spinners, acknowledgement within 100 ms
   (Nielsen's 0.1 s limit; Doherty's 400 ms).
2. **Continuity.** Things move instead of being redrawn: "we fly instead of teleport" (Family).
3. **One deliberate novelty.** About 90 % familiar, 10 % novel, placed at first encounters
   (Freiberg). North's 10 %: the decision moment, the morning reveal, the stop.
4. **Invisible correctness.** Transform origin, ease-out under 300 ms, interruptibility, six
   states per screen, copy that says what happened. Users infer global care from local care
   (Ive: "giving a damn"; Graham: "a thousand barely audible voices all singing in tune").

Beauty is largely processing fluency (Reber, Schwarz, Winkielman 2004): the easier a screen is
to parse, the more beautiful and trustworthy it is judged, in 50 ms (Lindgaard 2006), and that
judgment transfers to perceived usability (Kurosu & Kashimura 1995) and credibility (Fogg 2002:
46 % of credibility remarks cite the look). So the two surfaces where polish is non-negotiable
are the landing's first viewport and Home's first paint, tested as still images.

## What taste is, operationally

Taste is choosing for *this* problem instead of taking the statistical default, and being able
to say why. The only transferable form of taste is "there must be a reason" (Freiberg), which is
exactly what an AI can be held to. So taste in North is implemented as three things:

- **A counted system** (`02`): numbers, not adjectives. Two type families, five sizes, one
  accent, eight spacing values, three radii, four durations. Freedom lives in content, not chrome
  (Teenage Engineering: "I set up restrictions when I design").
- **A slop catalogue with tests** (`02`): the defaults AI tools converge on, each with a grep,
  a computed-style check or a screenshot test, so "generic" is a finding, not an opinion.
- **A separate critic** (`07`) that scores pairwise against the previous version, in both
  orders, and may not pass a screen without quoting a selector or a crop and naming the violated
  principle. Self-grading skews positive (Anthropic harness post); a skeptical standalone
  evaluator is tractable.

## The honest finding about today's look

Anthropic's current `frontend-design` skill lists five looks that generated design converges on.
North today matches two of them almost verbatim: "broadsheet layout with hairline rules, zero
border-radius" and "template chrome: tracked-out ALL-CAPS eyebrow above every heading, meta
strings joined with middle dots, a monospace face for small data labels, '→' appended to links".
Add the terminal strip, the blinking cursor, the ticker and the retro gradient button, and it is
also the Polsia look (`docs/research/polsia-teardown.md` §4), down to the accent `#e65100`.

The skill's own rule applies: "the brief's own words always win, including when it asks for one
of these looks", but "where it leaves an axis free, don't spend that freedom on one of these
defaults". North's brief *does* motivate a document aesthetic: the brief is a memo, the ledger is
a table, the card is a decision slip. It does not motivate a terminal, a ticker, a cursor or a
competitor's orange. The rule for each element is therefore: justified by a sentence of the
brief, or gone. `02` lists the verdicts.

## The visual direction: "the morning memo", instrument-grade

Two registers, both motivated by the subject:

- **The document register** (brief, card question, artifacts, plan): a text serif with optical
  sizes, set like a well-printed memo. Reading comfort first: 17-19 px body, 60-70 characters,
  `text-wrap: pretty`, generous leading. This is where the CEO reads.
- **The instrument register** (numbers, costs, deadlines, tiers, controls, the kill switch): a
  mono for data only, hairline rules only where they separate data, controls that feel physical
  (press scale, hold-to-confirm fill) and are never decorated. This is where the CEO acts.

What is removed: the terminal strip, the ticker, the blinking cursor, uppercase mono labels above
headings, middle-dot meta strings, the retro gradient, identical grey boxes around everything,
Polsia's orange. What is added: a real hierarchy (the pending card is the loudest thing on Home;
"nothing needs you" is the calmest), designed empty states, a dark palette that is designed and
not inverted, and one signature interaction: **the answer that travels** (the card you answer
moves into the ledger and the quota ticks; `05`).

Accent: derive it from the name, not from a competitor. A compass paints north red. North's
accent is a single "needle" red reserved for the three states where the human must look: a
decision waiting, agents stopped, a failure. Verified evidence gets a quiet green. Nothing else is
coloured. The designing agent may propose a different derivation, but must defend it in
`DESIGN.md` against this paragraph and pass the slop tests in `02`.

## Ten principles (the rubric in `07` scores exactly these)

1. **Fit.** Every visible element serves a sentence of the brief. Name the sentence or remove it.
2. **Hierarchy.** One primary action, one memorable element; the order of reading is readable in
   a 300 ms flash and matches intent.
3. **Counted system.** Tokens stay within the declared counts; same thing, same look, everywhere.
4. **Craft.** Alignment, proximity, rhythm, typographic finishing: the details are finished.
5. **Earned motion.** Frequency decides: daily actions may move, hourly actions do not.
6. **Instant acknowledgement.** A control changes within one frame of press; waits have states.
7. **Honest copy.** Specific, active, North vocabulary; says what happened and what did not.
8. **Back of the drawer.** Empty, loading, error, offline, long-text and 390 px states get the
   same care as the hero.
9. **Restraint.** Remove the weakest element; if nothing is lost, it stays removed.
10. **Non-default.** Any surviving item from the slop catalogue carries a written reason.

## What this is not

Not a chat app. Not a dashboard of charts. Not a 3D showcase: nothing in North is a physical
object, so 3D adds nothing the user can use (`05`). Not a streak machine: the ritual is finite
and guilt-free. Not a credit meter: cost appears on the card before and in the ledger after,
never in the navigation.
