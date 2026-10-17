# 03 — Customer journey and personas: where "worth every dollar" is decided

Scope: landing → sign-up → onboarding → first 24 h → daily ritual → decision → money → month 3. Five
personas, one interface. Evidence first, then rules a reviewer can check on a screenshot or in code.

## 1. The frame (what the evidence says a premium journey is)

- **JTBD / four forces.** People switch when push (current pain) + pull (new promise) outweigh anxiety
  (new risk) + habit (old way). Moesta and Spiek: teams over-invest in pull; "the hidden gem is reducing
  the anxiety the new solution creates" [S1]. For North the anxiety is specific: *agents touching my
  money, my inbox, my reputation.* Every stage below therefore has a "must feel" of **control before
  capability**.
- **Trust in automation (Lee & See 2004).** Trust is built from performance (what it does), process
  (how it works) and purpose (why it exists); the goal is *calibrated* reliance, not maximal trust [S2].
  Interface consequence: show evidence (performance), show the steps and the gate (process), state the
  intent and cost (purpose) on the same surface.
- **Peak-end.** Memory of an experience is the peak plus the end, not the average [S3]. Each stage must
  have one designed peak and a clean end state ("done for today").
- **Activation.** Median SaaS activation is 30%; the most common fixes are simpler onboarding, fewer
  steps, showing value earlier [S4]. Reforge's chain is setup → aha → habit, designed *backwards* from
  the habit [S5]. North's habit is the 5-minute morning; the aha is the first verified artifact; setup
  is onboarding. Design in that order.
- **Approval fatigue is measured.** Claude Code users approve 93% of permission prompts; the fix was a
  classifier plus a conservative "unauthorized until the user says otherwise" stance [S6]. Human review
  only has value when it is rare and consequential.
- **Money trust is low.** 24% of US adults trust an AI agent to make routine purchases [S7]; Operator's
  documented failure was a purchase that skipped its own confirmation [S8]. The money moment is where
  North wins or loses the skeptic.
- **Labor illusion.** Visible work raises perceived value (Buell & Norton; Growth.Design) — but only
  when the work is real; fake progress is a known ethical failure [S9].

## 2. Personas

| | Goal | Fear | "Premium" means | First thing sought on landing | Cancels at month 1-3 if |
|---|---|---|---|---|---|
| **Mert** — employed builder, side project, 1 h/evening | Ship a product without quitting the job | Another graveyard repo; paying for a toy | It worked *while I was at work* | "What does it do without me?" | Nothing verifiably shipped by day 30 |
| **Ayşe** — solo operator, $8k MRR | Grow without hiring; protect customers | An agent emails a customer or spends ad money badly | Calm control, every dollar accounted | "Can it touch my Gmail/Stripe safely?" | One unapproved action or a cost surprise |
| **Daniel** — non-technical founder, idea stage | Get to first customers; not be fooled | Jargon, hidden complexity, scams | Plain language, a staff that explains itself | "Do I need to code?" | Artifacts he cannot read; feels lost |
| **Lena** — consultant/agency, 3 companies | Run several companies in one brief | Noise, context bleed between companies | Speed, keyboard, one morning for all | "Multi-company?" | Per-company tax: 3× notifications, 3× rituals |
| **Kerem** — skeptic, burned by Polsia-type tools | Prove it is not fake | False "done", credits burned, lock-in | Evidence, refunds never needed, export | "What does it NOT do?" | First unverified "done" or credit drain |

## 3. Journey map

| Stage | User thought | Must feel | Must see first | The one action | Wow candidate | Risk | Metric |
|---|---|---|---|---|---|---|---|
| **Landing, first 5 s** | "Is this for me, is it real?" | Serious, calm, not hype | H1 + one line that names the gate ("Nothing leaves without your yes") + one CTA | Scroll or "Get started" | A *real* card from a demo company, answerable on the page | Polsia-style theatre (fake terminal) triggers Kerem | Scroll depth, CTA click |
| **Landing, scroll** | "What exactly happens, and what can't it do?" | Anxiety dropping | The 30-day story in 5 rows (day 1, 7, 15, 21, 30); the limits list; pricing with no table [S10] | "Get started" | Interactive ledger row: "Ad test · $40 · +3 signups" | Over-promising; feature grid | Sign-up rate |
| **Sign-up** | "Don't make me think" | Already partly mine | Google / magic link; no password; step count honest [S11] | One tap | Email arrives with first question pre-answered from the landing input | Step mismatch kills trust [S11] | Completion ≥ 90% |
| **Onboarding: idea → questions → goal → budget → team → summary** | "Does it get my idea?" | Understood, in command | Idea box with a 2-line example; ≤ 5 questions; goal with a default; budget with a hard cap; team with dials (Review drafts default) | Approve the summary | The summary reads back the thesis better than the user wrote it | > 10 min (ONB-1); jargon for Daniel | Time ≤ 10 min; team accepted ≤ 2 edits |
| **First 24 h wait** | "Is anything happening?" | Confident waiting | Team page: live state per role, step n/m, $ so far; one line "first report by 09:00" | None (pull only) | Push at the promised time, not before | Silence = anxiety; fake spinner = Kerem leaves | Return visit within 24 h |
| **First artifact** | "Is this any good?" | Proud, surprised | Market report with 100% cited claims, critic score, cost ($1.80), "what changed" vs. nothing | Read; comment | A finding the user did not know | Generic output (Sintra complaint) | Opened + time on artifact |
| **First decision card** | "I get it: this is my job now" | Competent in 60 s | Question (serif), why (2 lines), cost, deadline, default, 2-3 outcome-labelled options | One tap | Option tap → "Queued · Undo" toast → done | Default pre-selected; vague "Are you sure?" | Median answer < 60 s |
| **First money decision** | "Now it's real money" | Protected, deliberate | Amount in the button, source account, cap, what happens if nothing | Hold-to-confirm | Ledger row appears live with the spend and later the delta | Skipped confirmation (Operator [S8]) | 0 unapproved spends; answer rate |
| **Daily ritual, day 5-30** | "5 minutes and I'm done" | Finite, closable | Brief (200 w), cards (≤ 3), "Nothing else needs you today" | Answer cards | The brief's last line names yesterday's measured result | Streak guilt (Duolingo criticism [S12]); notifications beyond cards | D7/D30 ritual retention |
| **Month 3** | "Was it worth $X?" | Compounding | Ledger month view: spend vs. metric; auto-rules count; export | Renew / raise a dial | "You decided 41 things; 12 now run on rules" | Costs with no ledger delta | Net revenue retention; dials raised |

Peak per stage: landing = the real card; onboarding = the read-back summary; day 1 = the unknown
finding; decision = the undo toast; money = the live ledger row; month 3 = the rules count. End per
stage: an explicit closed state ("done for today").

## 4. Where the personas meet (one interface, no variants)

**Common wants** (all five): (1) nothing external without my yes; (2) proof, not claims; (3) the
morning is finite; (4) cost visible before and after; (5) fast on a phone; (6) I can leave with my
data.

**Interface decisions that satisfy all five**

1. **Home = brief + cards + "done" line.** Nothing else above the fold. Mert's 5 minutes, Lena's one
   morning, Daniel's no-jargon, Ayşe's calm, Kerem's "show me".
2. **Every card carries why + cost + default + deadline** in the same four slots, always. HAX G11
   ("make clear why"), G16 ("convey consequences") [S13].
3. **Options are labelled by outcome**, never Yes/No; recommended is marked ★ but never focused or
   pre-selected [S14].
4. **Evidence link on every artifact and ledger row** (URL, screenshot, metric). No evidence, no
   "done" (spec). Kerem's price of admission; Daniel's reading aid.
5. **Cost in two places only:** on the card (before) and in the ledger (after). Never a credit meter
   in the nav (Sintra/Genspark complaints).
6. **Kill switch: same place on every screen, one tap, no dialog**, confirmed by a visible state
   change ("All agents stopped 14:02 · Resume"). Linear AIG: respect disengage immediately [S15].
7. **Team page shows state, not chatter:** per role, one line (task · step n/m · $ today · last
   evidence). Linear AIG states: thinking / waiting / executing / done [S15].
8. **Pull-only progress; push only for K2/K3 cards and the two digests.** Notification = decision.
9. **Undo everywhere it is reversible, confirm only where it is not** (section 5).
10. **Plain language default, detail one tap away** (rationale, logs, prompts). Daniel reads the first
    layer; Mert and Lena open the second.
11. **Pricing: three plans, no comparison table, limits written as sentences** ("3 decisions a day,
    raise it in Settings"). Linear's restraint without even its table [S10].
12. **Export and "what North does not do" in the footer and in Settings**, not hidden in docs.

**Where they diverge, and the dial that absorbs it**

- *Technical depth* (Mert/Lena vs. Daniel): progressive disclosure, not modes. Artifacts open to a
  summary; "Show work" expands logs, prompts, diffs. Nothing is hidden, nothing is forced.
- *Autonomy appetite* (Kerem: review everything; Lena: autopilot fast): per-department dials
  (Review drafts / Autopilot) in onboarding and Settings, plus auto-rules proposed after three
  identical answers (DEC-3). Smashing's "Autonomy Dial" and Claude Code's allow-rules are the same
  idea [S6][S16]. The tier engine, not the user, sets the ceiling.
- *Several companies* (Lena): a company switcher in the top bar and one merged morning digest; the
  brief per company stays 200 words. No "agency edition".

## 5. The approval layer (decision card interaction)

Baymard's rule: weigh frequency against severity; demonstrate intent for rare + severe, make it
reversible for frequent [S17]. NN/g: confirm only when consequences are serious and undo is impossible;
prefer undo; vague dialogs train click-through [S14]. Mapping to North's tiers:

| Tier / case | Gesture | Recovery | Why |
|---|---|---|---|
| K0 auto, K1 notify | none | Ledger row + **15-min undo** where the action is reversible (unpublish, pause ad), window stated on the row [S16] | Frequent; reversibility beats confirmation [S17] |
| K2 card, non-money (pick variant, approve copy, choose channel) | **One tap** on an outcome-labelled option | Toast "Queued · Undo" for 5 s before dispatch (the 2-s queue budget allows this) | Rare, moderate severity; one tap keeps the 60-s target; undo covers slips |
| K2 card, money or external send to real people (spend from own account, outreach batch, go live) | **Hold-to-confirm, 700 ms**, amount inside the button ("Hold to spend $40 from Stripe") | None after dispatch; ledger row immediately; stop button if still running | Irreversible; a hold cannot be triggered by a scroll bump; Apple uses a physical gesture for the same reason [S18]; Operator's failure was a skipped confirm [S8] |
| K3 user-only (bank, legal, contracts) | No action in North | Card links to the user's own tool, then "Mark done" with evidence | Money never leaves through North (NN-6) |

Never use swipe for decisions: swipe fires during scrolling and is the leading source of accidental
destructive actions (GitHub mobile, swipe-to-delete reports) [S19]; Tinder's gesture is built for low
stakes and no regret.

**Why and what-it-costs presence.** Both are two lines above the options on every card; rationale
expands ("Show reasoning") per NN/g progressive disclosure [S14] and HAX G11 [S13]. Cost shows estimate
before, actual in the ledger after; no card without a number, even "$0".

**The "never ask again" moment.** Offered only after the third identical answer (DEC-3), *after* the
tap, as a separate line under the toast: "You picked this 3 times. Auto-approve outreach batches ≤ 50
emails? [Make rule]". Rules are phrased as a condition with a cap and listed in Settings with a
one-tap delete. Claude Code's 93% approval rate shows that un-capped prompts become noise [S6]; NN/g
says let users opt out of learned confirmations [S14]; Lindy's gate is per account, write-only [S20].
Money rules carry a per-rule ceiling and never exceed the budget cap.

**Kill switch as reassurance.** Its job is mostly to be seen. Lee & See: calibrated trust needs a
credible way to withdraw reliance [S2]; Linear AIG: disengage first, ask later [S15]. Always rendered,
same position, high contrast; no confirmation (stopping is the safe direction); after tap, a banner
with timestamp and "Resume", and a ledger entry. Show it on the landing page screenshot too: it is a
selling point, not an apology.

## 6. Talking to agents

**Chat is right** when the user originates intent: a new goal, "research this idea", a comment on a
variant or a paragraph, "why did you choose this?" on an artifact. It opens as a bottom sheet from the
artifact or role, pre-scoped to that context, and anything it produces re-enters the normal path
(review item or card). **Chat is wrong** as the home screen, for approvals, for status, and for
anything money. Approvals in chat lose the four slots (why/cost/default/deadline) and the quota; status
in chat is Polsia's terminal theatre. Keep the spec's position: Chief of Staff chat is optional and
never the only way to do anything.

**Team page that builds trust without noise.** Each role card: name and role, agent badge (identity
visually distinct [S15]), one-line current task, state chip (thinking / waiting for you / executing /
done), step n/m, "$ today", last evidence link, Stop. Below: the 24-h action stream with tier labels
(K0 grey, K1 blue, K2 orange) and the card or rule that authorised each K2 action. Acknowledge within
seconds when a goal is given [S15]; show labor only when it is real (the ASCII spinner is fine; a
progress bar that lies is not) [S9]. No chat bubbles, no "thinking…" prose, no per-token streaming on
this page.

## 7. What North should do (testable rules)

1. Landing H1 is followed within one viewport by the gate sentence and one CTA; no second CTA above
   the fold.
2. Landing shows a real, answerable demo card (tap changes state) and one real ledger row.
3. Landing has a "What North does not do" list of ≥ 5 items.
4. Pricing: ≤ 3 plans, no comparison table, every limit written as a sentence.
5. Sign-up has no password field and a step indicator whose count never changes.
6. Onboarding ≤ 5 questions, ≤ 10 min (timed in e2e), summary reads back thesis + goal + budget cap +
   team in ≤ 120 words before "Approve".
7. Budget step requires a hard cap; team step defaults every department to "Review drafts".
8. Within 60 s of approval, Home shows a promised time for the first artifact; the push arrives at
   that time, not earlier.
9. Home above the fold at 390 px: brief, ≤ 3 cards, "Nothing else needs you today" line. Nothing else.
10. Every card renders the four slots (why, cost, default, deadline) and ≥ 2 outcome-labelled options;
    no option is pre-selected; ★ marks the recommendation only.
11. Non-money K2: single tap then a 5-s "Queued · Undo" toast; the action is not dispatched until the
    toast closes.
12. Money or external-send K2: hold-to-confirm ≥ 600 ms, amount and source account inside the button;
    no swipe gesture anywhere in decision UI.
13. K1 reversible actions show "Undo · 14 min left" on their ledger row.
14. "Make rule" appears only after the third identical answer and always with a cap; Settings lists
    rules with one-tap delete.
15. Kill switch: same x/y on every screen, no confirmation dialog, state banner with timestamp within
    1 s, ledger entry within 5 s.
16. Push notifications originate only from K2/K3 cards and the two digests (assert in code).
17. Every artifact and ledger row has an evidence link; "done" without `evidence_url` fails CI.
18. Cost appears on cards (estimate) and ledger (actual) only; no persistent credit meter in nav.
19. Team page: each role card shows state chip, step n/m, $ today, last evidence; no chat bubbles.
20. Chat is reachable only from an artifact, a role or the Chief of Staff entry; it never contains
    approve/spend buttons.
21. Multi-company: a switcher in the top bar and one merged digest; the per-company brief stays
    ≤ 200 words.
22. Month view of the ledger shows spend vs. metric per channel and the count of active rules.
23. No streak counters, guilt copy or loss framing in the ritual; a missed day shows yesterday's
    defaults applied, nothing more.
24. Any waiting state shows real progress (step n/m, last tool) or nothing; no indeterminate bar
    longer than 3 s.

## Sources

- [S1] https://jobstobedone.org/the-four-forces/ — push/pull/anxiety/habit; anxiety and habit kill most switches; reduce anxiety before adding pull.
- [S2] https://journals.sagepub.com/doi/10.1518/hfes.46.1.50_30392 — Lee & See 2004: trust from performance/process/purpose; aim for calibrated reliance.
- [S3] https://www.atticusli.com/blog/posts/peak-end-rule-user-onboarding/ — peak-end applied to onboarding: design one peak and the end step.
- [S4] https://www.lennysnewsletter.com/p/what-is-a-good-activation-rate — 500+ products: SaaS median activation 30%; top fixes are simpler onboarding and earlier value.
- [S5] https://innertrends.com/data-analyses/identify-the-habit-moment-the-key-to-long-term-retention — Reforge setup/aha/habit chain, designed backwards from habit.
- [S6] https://anthropic.com/engineering/claude-code-auto-mode — 93% of permission prompts approved; classifier, "unauthorized until the user says otherwise", allow-rules.
- [S7] https://www.forrester.com/report/many-us-consumers-believe-in-agentic-commerce-but-few-trust-it-to-make-purchases/RES188737 — 24% trust agents with routine purchases; privacy and transparency.
- [S8] https://www.adn.com/alaska-life/2025/02/09/i-let-chatgpts-new-agent-manage-my-life-it-spent-31-on-a-dozen-eggs/ — Operator placed an order without the promised confirmation; OpenAI tightened confirms.
- [S9] https://growth.design/case-studies/labor-perception-bias — labor illusion (Norton), Wise transfer animation; fake progress is unethical.
- [S10] https://linear.app/pricing — four plans, light text, no urgency; closest model for restraint (it still keeps a table; North drops it).
- [S11] https://growth.design/case-studies/hey-user-onboarding — premium feels worth it when honest, personal, guided; step-count mismatch and anticlimactic end hurt.
- [S12] https://deceptive.design/articles/teaching-or-manipulating-on-the-adoption-of-bright-and-deceptive-patterns-by-duolingo — streak pressure and guilt notifications classed as deceptive.
- [S13] https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/ — 18 HAX guidelines incl. G11 why, G16 consequences, G17 global controls.
- [S14] https://www.nngroup.com/articles/confirmation-dialog/ — confirm only serious + irreversible; prefer undo; outcome-labelled buttons; no default yes; let users opt out.
- [S15] https://linear.app/developers/aig — agents disclose identity, give instant feedback, expose state, respect disengage, cannot be accountable.
- [S16] https://smashingmagazine.com/2026/02/designing-agentic-ai-practical-ux-patterns/ — Intent Preview, Autonomy Dial, audit + time-boxed undo (opinion, no cited studies).
- [S17] https://baymard.com/blog/handling-accidental-taps-on-touch-devices — three strategies; intent "is a tax levied on all users"; frequency × severity.
- [S18] https://mjtsai.com/blog/2018/01/01/pressing-the-side-button-to-confirm-payments-on-iphone-x/ — Apple Pay double-click: a physical gesture cannot be spoofed or bumped.
- [S19] https://blog.logrocket.com/ux-design/accessible-swipe-contextual-action-triggers — swipe actions fire accidentally; undo snackbar as mitigation.
- [S20] https://docs.lindy.ai/teammate/setup — "Always allow" vs "Ask for approval" per account, write/send actions only.
- [S21] https://review.firstround.com/superhuman-onboarding-playbook/ — human onboarding ~doubled activation; self-serve "Get me to zero" raised activation 40→50%; full-screen steps 30→98% completion.
- [S22] https://growth.design/case-studies/too-good-to-go-onboarding — start with why, show don't tell, one clear reason for permissions.
- [S23] https://smashingmagazine.com/2016/09/the-thumb-zone-designing-for-mobile-users — 49% one-handed; bottom placement; Spotify +30% menu taps after moving nav down.
- [S24] https://help.sunsama.com/docs/daily-shutdown — planning ritual with an explicit end step (review, reflect, close).
