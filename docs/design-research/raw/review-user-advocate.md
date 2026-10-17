# User-advocate review of `docs/design-research/`

## (a) Verdict

The journey and Home are right for four of five people: phone at 07:30, one headline, ≤ 3 cards, a closing line. Three things would make real users cancel or distrust: the stop control became a 600 ms hold although SPEC says "tek tıkla"; the drafts put card answers and "live" rows into the *ledger*, which by OUT-1 only records measured metric change, so Kerem sees a fabricated receipt; and money vocabulary is split three ways (`$0.40` per task, "120 runs", "$14 spent"), so Ayşe and Daniel cannot tell what they pay. Fix those, restore the connect-tools step, drop the "Autopilot" dial, and the drafts are shippable.

## (b) Walkthroughs

Quotes are from 03/04/06.

### Mert, employed builder
| Step | Looks for | 04? | Feels / leaves if |
|---|---|---|---|
| Landing | "What does it do without me?"; GitHub | Yes: "a real morning brief ... one pending card"; "your code stays in your GitHub" | Serious; leaves if the demo looks invented |
| Sign-up | Google | Yes | Fine |
| Onboarding | Connect GitHub now; cap of $0 | No: wizard is "questions → goal → budget → team → summary"; SPEC includes "araç bağlama"; can the required cap be 0? | Worries about billing before output |
| First 24 h | Something at 23:00 | "First report by 09:00": brief is 07:00, spec promises an artifact in 24 h | Confident if the push is on time |
| Cards | Deploy preview → live | Yes; but 05: keyboard answers run "at `--dur-fast`" | Deliberate on phone; see Q2 |
| 07:30 | Headline, one card | Yes | Finite |
| Stop | Visible | Yes | — |
| Month 3 | A live URL, "shipped N times" | URL on the "Website line"; no count anywhere | Leaves if nothing shipped by day 30 |

### Ayşe, solo operator
| Step | Looks for | 04? | Feels / leaves if |
|---|---|---|---|
| Landing | "Can it touch my Gmail/Stripe safely?" | Gate table is section 3; "sandbox" is jargon | Anxious until section 3 |
| Onboarding | Review-drafts default, hard cap | Yes; the "Autopilot" dial beside it scares her | In command |
| First 24 h | Did anything reach a customer? | Per-role "last evidence"; no "sent to customers: 0" | Checks repeatedly |
| First card | Why, who receives | Yes: "Send 5 emails ★ / Don't send" | Competent |
| Money card | Amount, account, cap | Yes, but "Hold to spend $40 **from Stripe**": ad spend leaves Meta Ads, Stripe is income | **Leaves** at the first sentence that gets her money wrong |
| 07:30 | What went out in my name | No: K1 "Tells you after" actions sit inside the collapsed brief | Loses her one need above the fold |
| Stop, panic | Tap, it stops | No: "Hold 600 ms with a hairline fill"; a panicked tap does nothing | Panic doubles |
| Month 3 | Every dollar vs result | Yes: "spend versus metric per channel" | Worth it |

### Daniel, non-technical
| Step | Looks for | 04? | Feels / leaves if |
|---|---|---|---|
| Landing | "Do I need to code?" | Not above the fold; "your GitHub" assumes he has one | Unsure it is for him |
| Sign-up | Email link | "No password. We email you a link." | Easy |
| Onboarding | Plain questions | Yes; budget categories (ads/tools/domain) and "persona per department" are heavy | OK if copy holds |
| First 24 h | "Is it working?" | Team rows; "step 3/7" and "$0.40" read as charges | Confused about money |
| First card | Readable options | Yes; the ONB-3 "Connect GitHub" card is unspecified | Leaves at a connect card he cannot read |
| Month 3 | First customers | Goal bar | Worth it; leaves at unreadable artifacts |

### Lena, three companies
| Step | Looks for | 04? | Feels / leaves if |
|---|---|---|---|
| 07:30 | One screen, all cards | `/companies` shows "pending count"; cards not answerable there, she switches into each company | 3 rituals: her cancel trigger |
| Cards | 1/2/3 | Yes, "instantly"; no key to focus the next card; keyboard hold for money unclear | Fast |
| Stop | A key | "keyboard hold on Enter or Space"; tab order unstated | Fine if first in tab order |
| Month 3 | Three ledgers, one export | Export per company | Mostly worth it (MULTI-1 is V2) |

### Kerem, burned before
| Step | Looks for | 04? | Feels / leaves if |
|---|---|---|---|
| Landing | "What does it NOT do?"; real ledger | Section 5 and footer: yes; "a real ledger excerpt": whose? | Smells a demo (Q5) |
| Onboarding | No autopilot, a cap | Cap yes; "Autopilot" dial is a tell | Wary |
| First card | Nothing pre-selected | 03 "never pre-selected"; 04 recommended is "the only filled control" | Reads filled as chosen |
| Money card | Hold, amount | Yes | Trusts |
| 07:30 | Clickable numbers | "2 sign-ups yesterday" has no link to its source | Suspicious |
| Stop | Logged | "a ledger entry lands within 5 s" (an action row, not ledger) | Good |
| Month 3 | Export; no false done | Export in Settings; no "done with evidence" count | **Leaves** at the first unverifiable "done" or at "Undo · 14 min left" on a sent email |

## (c) Answers

**1. Home for five minutes.** Satisfies Mert, Daniel, Kerem. Ayşe loses what went out in her name (K1 actions sit in the collapsed brief). Lena loses one screen for all cards. Kerem loses the source behind the headline numbers. Edit `04-screens.md` § Home, Order 2: replace "the answered strip: a one-line ledger of today's answers" with "**Today's actions**: one line per answered card and per 'Tells you after' action since the brief (what · to whom · cost), linking to its action row; headline numbers link to their source." Add to § Companies: "Pending cards are answered inline here."

**2. Approval layer.** On a phone the hold is welcome (Ayşe, Kerem). Lena finds it slow on a keyboard, but 05 says "Keyboard answers do the same at `--dur-fast`", which turns the hold into a 120 ms keypress that spends money. The 5 s undo is not frightening; "Undo · 14 min left" on a K1 ledger row is: a sent reply cannot be undone and `ledger_entries` are append-only (CLAUDE.md 3). "Make a rule" after the third identical answer is the right moment, but it must also appear for money cards (no toast there) and never be pre-granted by an onboarding dial (DEC-3: "Kural ancak kullanıcı kabul ederse eklenir"). Edit `05-motion.md` § The signature: replace "Keyboard answers do the same at `--dur-fast`" with "Keyboard: 1/2/3 pick an option; a money or send option then needs Enter held 600 ms, the fill running in the focused button." Edit `04` § Ledger: delete "K1 rows with an open undo window show 'Undo · 14 min left'"; undo lives on Team stream action rows, only where the action is reversible.

**3. Stop.** Wrong for Ayşe's panic: SPEC says "Tek tıkla 'tüm ajanları durdur'" and 03 says "no dialog before stopping (stopping is the safe direction)"; a hold is a dialog by another name, and a tap that does nothing is the worst feedback in a panic. Right for Lena only if the control is first in tab order. Edit `04` § The stop control: replace "Hold 600 ms with a hairline fill; keyboard hold on Enter or Space" with "One tap or one Enter stops; the control is first in tab order. No hold, no dialog: an accidental stop costs one tap on Resume."

**4. Copy, read by Daniel.** (1) "2 sign-ups yesterday. $14 spent. 1 card waiting." understands. (2) "Send 5 first-contact emails from your Gmail?" understands. (3) "No answer by Thu 18:00 → nothing is sent" → "If you don't answer by Thu 18:00, nothing is sent." (4) "Hold to spend $40 from Stripe" → "Hold to spend $40 of ad budget from your Meta Ads account." (5) "Research · Reading 12 competitors · step 3/7 · $0.40" → "Research: reading 12 competitors, step 3 of 7" (cost on tap, "included in your plan"). (6) "Runs automatically / Tells you after / Needs your decision / Only you can do this" understands; the K-badge is noise. (7) "Solo. 1 company. 120 runs a month. 84 left." → "Solo plan. 1 company. 120 agent tasks a month; 84 left until 1 Nov." (8) "Build failed on test 14. Nothing deployed..." → "The website build failed a check. Nothing went live. Trying once more; if that fails, the brief tells you." (9) "sandbox by default" → "Practice mode by default: nothing real is sent or spent until you switch a connection to live." (10) "your code stays in your GitHub" → "Your website's code lives in your own GitHub account; North creates it for you." Edit `06-voice.md` § In-app rules, add rule 16: "Money has two words that never mix: *spent* (your own accounts: cards, budget, ledger) and *tasks* (what your plan includes). Per-task model cost appears only in Settings › Usage."

**5. Landing hero.** Kerem smells a demo: a card that "plays the answer interaction and shows the ledger row" fabricates a receipt for an action that never ran. Credible: label "Demo company · nothing is sent", use the founder's own company (M6 acceptance) with its `/p/[slug]` page linked, real dates, a working Stop. Never: a ledger row, metric delta or "+3 sign-ups" that was not measured; never a name that could be a real company. Edit `04` § Landing, Order 1: replace "shows the ledger row, nothing is sent" with "shows the card's answered state and the line 'Demo company · nothing is sent · see the real ledger', linking to the founder company's public page."

**6. Violations and silent changes.**
- `04` § Stop control "Hold 600 ms": SPEC Bütçe korumaları "Tek tıkla"; contradicts `03` "no dialog before stopping".
- `04` § Onboarding omits "araç bağlama" (SPEC Ekranlar, ONB-3), adds a "team" step; `04` § Home says "Four short steps" for a five-step wizard.
- `03` dial "Review drafts / Autopilot" and "the tier engine sets the ceiling": DEC-3 allows a rule only after three identical answers and an explicit accept.
- `04` § Home "Cards (≤ 3)": quota is 1-5 (DEC-3; `04` § Settings).
- `04` § Companies "The install prompt sits here, once": `/companies` is MULTI-1 (V2); Solo users never see it, so no PWA (SPEC Mimari, M6).
- `03` "the card travels to the ledger", "The ledger row appears live"; `04` § Home "one-line ledger of today's answers"; `04` § Ledger "Undo · 14 min left": OUT-1 ledger rows are measured metric change, append-only (CLAUDE.md 3).
- `03` "K2, not money (pick a variant, approve copy, choose a channel)": SPEC K2 is money, public, new contact or go-live; those are not K2 actions. Cap-raise cards are money: hold.
- `05` "Keyboard answers do the same at `--dur-fast`": weakens hold-to-confirm.
- `04` has no Chief of Staff screen or "new goal" entry (SPEC Ekranlar, CHAT-1) and no "change goal/budget" (SPEC "Şirket paneli"): optional became absent.
- `06`/`04` "runs": SPEC BIL-2 says "iş kredisi"; `04` § Settings lacks BIL-2's usage panel ("maliyet panelde görünür").
- `06` "Hold to spend $40 from Stripe": SPEC reads Stripe ("OAuth, okuma"); spend is from the ad account.
- `04` § Onboarding "First report by 09:00": brief hour is 07:00; the spec promise is an artifact within 24 h.
Edit `03-journey.md` § The approval layer, last row: "Rules: only after the third identical answer and an explicit accept. No dial grants a rule in advance."

**7. "Worth every dollar" at month 3.** Mert: a live URL plus "shipped 6 times" (no count). Ayşe: "$312 spent, 41 sign-ups, 0 unapproved sends" ("0 unapproved" missing). Daniel: first paying customer on the goal bar (delivered). Lena: three ledgers in one morning (no inline cards on `/companies`). Kerem: "41 decisions, 41 with evidence, export downloaded" (counts missing). Only Daniel's is explicit. Edit `04` § Ledger, month summary: add "decisions answered · done tasks with evidence / all done · actions sent in your name · rules active".

## (d) The five edits I would insist on

1. **Stop is one tap** (`04` § The stop control, Q3 text).
2. **Money by keyboard still holds** (`05` § The signature, Q2 text); 1/2/3 never dispatches a spend or send.
3. **No ledger theatre**: Home strip becomes "Today's actions"; ledger rows only when measured; delete "ledger row appears live" (03) and "Undo · 14 min left" (04); the landing demo never shows a ledger row (Q5 text).
4. **Onboarding matches ONB-1/2/3**: restore a "connect tools (or skip; a card asks when needed)" step, a true step count, no "Autopilot" dial; rules only after three answers (Q6 text).
5. **One money vocabulary, PWA for Solo**: rule 16 in `06` (Q4); `04` § Home gets the install prompt on the second visit and shows ≤ quota cards; `04` § Settings gets the BIL-2 usage panel.
