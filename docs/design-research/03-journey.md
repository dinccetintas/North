# 03 · Customer journey: five personas, one interface

## The frame (evidence in `09`)

- People switch when push + pull outweigh anxiety + habit; teams over-invest in pull. North's
  anxiety is specific: *agents touching my money, my inbox, my name.* Every stage below puts
  **control before capability** (Moesta's four forces).
- Trust in automation is built from performance (what it did), process (how, through what
  gate) and purpose (why, at what cost); the goal is calibrated reliance, not maximal trust
  (Lee & See 2004). Show all three on the same surface.
- Memory is peak plus end (peak-end rule): each stage gets one designed peak and an explicit
  closed state ("done for today").
- Human review has value only when rare and consequential: Claude Code users approved 93 % of
  permission prompts, so prompts became noise (Anthropic). Only 24 % of US adults trust an agent
  with routine purchases (Forrester); Operator's documented failure was a purchase that skipped
  its own confirmation. The money moment is where North wins or loses the skeptic.
- Visible work raises perceived value only when the work is real; fake progress is a known
  ethical failure (labor illusion, Buell & Norton).

## Personas

| | Goal | Fear | "Premium" means | First thing sought on landing | Cancels if |
| --- | --- | --- | --- | --- | --- |
| **Mert**, employed builder, one hour an evening | Ship without quitting | Another graveyard repo | It worked while I was at work | "What does it do without me?" | Nothing verifiably shipped by day 30 |
| **Ayşe**, solo operator, $8k MRR | Grow without hiring, protect customers | An agent emails a customer or wastes ad money | Calm control, every dollar accounted | "Can it touch my Gmail/Stripe safely?" | One unapproved action or a cost surprise |
| **Daniel**, non-technical founder | First customers, not be fooled | Jargon, hidden complexity | Plain language, a staff that explains itself | "Do I need to code?" | Artifacts he cannot read |
| **Lena**, consultant with three companies | Run them in one morning | Noise, context bleed | Speed, keyboard, one brief for all | "Multi-company?" | 3× notifications, 3× rituals |
| **Kerem**, burned by a Polsia-type tool | Prove it is not fake | False "done", credit drain, lock-in | Evidence; export; no refunds needed | "What does it NOT do?" | First unverified "done" |

## Journey map

| Stage | Thought | Must feel | Must see first | One action | Designed peak | Risk | Metric |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Landing, 5 s | Is this for me, is it real? | Serious, calm | H1, the gate sentence, one CTA | Scroll or start | A real card from a demo company, answerable on the page | Terminal theatre triggers Kerem | CTA click |
| Landing, scroll | What happens, what can't it do? | Anxiety dropping | The 30-day story in five rows; the "does not do" list; pricing without a table | Start | A real ledger row: "Ad test · $40 · +3 sign-ups" | Over-promising; feature grid | Sign-up rate |
| Sign-up | Don't make me think | Already mine | Google or magic link; honest step count | One tap | Nothing to configure | Step count changes | Completion ≥ 90 % |
| Onboarding | Does it get my idea? | Understood, in command | Idea box with a two-line example; ≤ 5 questions; goal with default; budget with hard cap; connect tools or skip | Approve the summary | The summary reads the thesis back better than the user wrote it | > 10 min; jargon | ≤ 10 min; ≤ 2 team edits |
| First 24 h | Is anything happening? | Confident waiting | Team page: per role, state, step n of m; "first results within 24 hours, the brief at 07:00" | None | Push at the promised time, not before | Silence; fake spinner | Return within 24 h |
| First artifact | Is this any good? | Proud, surprised | Report with cited claims, cost, "what changed" | Read, comment | A finding the user did not know | Generic output | Time on artifact |
| First card | I get it: this is my job | Competent in 60 s | Question, why (2 lines), cost, deadline, default, outcome-labelled options | One tap | Tap → the card collapses into its receipt row with "Sending in 5 s · Undo" | Pre-selected default; "Are you sure?" | Median answer < 60 s |
| First money card | Now it's real money | Protected, deliberate | Amount and account in the button, cap, what happens if nothing | Hold to confirm | The receipt row reads "Sent · $40 · 09:12"; the ledger shows the result when it is measured | A skipped confirmation | 0 unapproved spends |
| Daily ritual, day 5-30 | Five minutes and done | Finite, closable | Brief, the day's cards (≤ quota), "Nothing else needs you today" | Answer cards | The brief's last line names yesterday's measured result | Streak guilt; notifications beyond cards | D7/D30 ritual retention |
| Month 3 | Was it worth it? | Compounding | Ledger month view: spend vs metric; "41 decisions · 38 done with evidence · 12 sent in your name · 3 rules" ; export | Renew | The counts line | Cost with no ledger delta | Net retention |

## Where the personas meet: twelve decisions that satisfy all five

1. **Home = brief headline + cards (up to the quota, 1-5) + the "done" line**, nothing else above the fold.
2. **Every card carries why, cost, default and deadline in the same four slots**, always.
3. **Options are labelled by outcome** ("Send 5 emails", "Don't send"), never Yes/No; the
   recommended option is marked, never pre-selected or focused.
4. **Evidence link on every artifact and ledger row.** No evidence, no "done".
5. **Cost in two places only**: on the card before, in the ledger after. No credit meter in the nav.
6. **Kill switch in the same place on every screen**, confirmed by a visible state change with a
   timestamp and a ledger entry.
7. **Team page shows state, not chatter**: per role one line (task, step n of m, last evidence);
   states thinking / waiting for you / executing / done (Linear's agent guidelines). No per-task
   dollar figure on the row: one money vocabulary (`06` rule 15).
8. **Pull-only progress; push only for K2/K3 cards and the two digests.** A notification is a decision.
9. **Undo wherever reversible, confirm only where not** (below).
10. **Plain language first, detail one tap away** ("Show work": logs, prompts, diffs).
11. **Pricing: three plans, no comparison table, limits as sentences.**
12. **"What North does not do" and Export are in the footer and in Settings**, not in docs.

Where they diverge, a dial absorbs it, never a variant: technical depth (progressive
disclosure), autonomy appetite (standing rules only after three identical answers and an
explicit accept, DEC-3; a "Review drafts / Advance drafts without review" dial touches artifacts,
never actions; the tier engine sets the ceiling), several companies (a switcher in the
top bar and one merged digest; each brief stays 200 words).

## The approval layer

Frequency against severity (Baymard): demonstrate intent for rare and severe, make the
frequent reversible. Confirm only when consequences are serious and undo is impossible; vague
dialogs train click-through (NN/g).

| Case | Gesture | Recovery | Why |
| --- | --- | --- | --- |
| K0 auto, K1 notify | none | an action row in Today's actions and the Team stream; where the action is reversible (unpublish, pause an ad) the row offers Undo with its window stated; ledger rows never carry Undo | frequent; reversibility beats confirmation |
| K2, not money and not a send to real people (pursue a signal, raise a non-money setting, pick a direction) | one tap on an outcome-labelled option | committed at once (DEC-2); the receipt row holds "Sending in 5 s · Undo" and the worker honours a withdrawal inside that window | rare, moderate; one tap keeps the 60 s target |
| K2, money or a send to real people (spend from own account, raise a cap, outreach batch, go live) | pointer: hold 600 ms, amount and account inside the button ("Hold to spend $40 of ad budget from your Meta Ads account"); keyboard: select, the label becomes "Confirm: spend $40", Enter commits | none after dispatch; receipt row at once; Stop if still running | irreversible; a hold cannot be triggered by a scroll bump; Apple uses a physical gesture for the same reason |
| K3 user-only | no action in North | card links to the user's own tool, then "Mark done" with evidence | money never leaves through North |

Never swipe for decisions: swipe fires during scrolling and is the leading cause of accidental
destructive actions; it is built for low stakes and no regret.

"Make a rule" appears only after the third identical answer, after the answer, as a line under
the receipt row ("You picked this 3 times. Auto-approve outreach batches ≤ 50 emails? Make
rule"), on money cards too, always with a cap, never granted in advance by any onboarding
setting, listed in Settings with one-tap delete.

The kill switch's job is mostly to be seen: calibrated trust needs a credible way to withdraw
reliance. Always rendered, same position, one tap, no hold and no dialog before stopping (stopping is
the safe direction; SPEC: "tek tıkla"), a timestamped banner and an action row after. It belongs in the landing screenshot:
it is a selling point.

## Talking to agents

Chat is right when the user originates intent: a new goal, "research this", a comment on a
variant, "why did you choose this?" on an artifact. It opens as a bottom sheet from that artifact
or role, pre-scoped, and whatever it produces re-enters the normal path (a review item or a card).
Chat is wrong as the home screen, for approvals, for status and for anything money: approvals in
chat lose the four slots and the quota; status in chat is terminal theatre. The spec stands:
Chief of Staff chat is optional and never the only way to do anything.

The ritual is finite and guilt-free: no streaks, no loss framing; a missed day shows yesterday's
defaults applied and nothing more (Duolingo's streak pressure is classed as a deceptive pattern).
