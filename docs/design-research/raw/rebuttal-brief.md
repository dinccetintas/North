# Rebuttal round: four contested points. Answer each in ≤ 80 words: HOLD or CONCEDE, with the one argument that decides it.

The three reviews are at scratchpad/research/review-critic.md, review-user-advocate.md, review-engineer.md. Read the other two before answering.

Q1 STOP CONTROL. Draft: hold 600 ms. User advocate: one tap (SPEC "Tek tıkla"; "a tap that does nothing is the worst feedback in a panic"; stopping is the safe direction; accidental stop costs one tap on Resume). Engineer: hold breaks e2e `click()`. Critic: silent on stop but wants hold-to-confirm as the signature for MONEY cards.
Proposed merge: one tap stops; hold-to-confirm stays only for money/send options on cards.

Q2 TYPE. Draft: one text serif with optical sizes + a mono for data (costs, times, ids, badges). Critic: serif+mono pairing is the strongest "AI made this" tell; use ONE family with opsz + tnum (tabular lining figures) for all text and numbers; mono only for ids, hashes and code in artifacts; also swap Newsreader (AI shortlist) for a less-default text serif.
Proposed merge: one family (Source Serif 4 variable, opsz + tnum, self-hosted), mono demoted to ids/code only.

Q3 SIGNATURE. Draft: card answers, "Queued · Undo" 5 s, then flies into an answered strip. Critic: flight after the undo window is non-user-triggered, flies below the fold at 390, has no strip on the detail page → collapse-in-place into a receipt row that stays where the card was with Undo inside; hold-to-confirm on money cards is the true signature. Engineer: a client-side 5 s delay breaks DEC-2 (answer in queue ≤ 2 s) and answerCard is write-once → commit at once, worker sleeps 5 s and honours a withdraw flag; undo only for one-tap non-money cards. Advocate: the strip must not be called a ledger (ledger rows are measured metric change only); call it "Today's actions".
Proposed merge: all three combined: collapse-in-place receipt row (not a ledger row) with Undo inside for 5 s; commit immediately with worker-side withdraw window; hold-to-confirm for money with no undo; a "Today's actions" list on Home that answered cards join in place.

Q4 ACCENT AND THE WAITING CARD. Draft: needle red for waiting card + stopped + failed. Critic: red only for stopped + failed; the waiting card is loud by size and by being the only ink-filled element. Advocate: a filled recommended option reads as pre-selected to the skeptic.
Proposed merge: red = stopped + failed only. The waiting card is the largest text on Home with no hue; the recommended option is the only ink-filled control, labelled "Recommended", never focused or pre-selected; the selected state is distinct (check + label change), so fill ≠ chosen.

Also: name ONE thing in the proposed merges you would still fight, if any.
