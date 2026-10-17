# 21. Intake protocol

Purpose: how North turns a founder's idea into an `IntakeRecord`, a complexity class and (at C1) a build plan, with at most five questions and zero decision cards.

Related: `00-README.md`, `01-research-protocol.md`, `10-findings-and-verdicts.md`, `20-blueprint-overview.md`, `22-spec-and-plan-artifacts.md`, `23-architecture-and-principles.md`, `23a-repo-templates.md`, `24-team-topology-and-orchestration.md`, `25-verification-and-evidence.md`, `26-security-controls.md`.

Rulings carried: `notes/synthesis-decisions.md` §2 rows 4, 16, 27, 33; §3.1; §3.6; §4.1 intake row; §7 gaps 7, 12, 14.

Tag convention (`20-blueprint-overview.md` §0): `[LEVEL · hypothesis · lowest grade · classes · kind]`. Kinds: `invariant`, `model-limit (dated)`, `design choice (to be measured)`, `process`, `release-1 rule`.

## 1. Where intake sits

| Item | Value |
| --- | --- |
| Runs | Intake worker (deterministic) plus the planner, which drafts Q0 on `standard`; planning after classification follows the tier rule of synthesis §3.2 (`standard` at C2, `strong` at C3+). At C1 the planner is not started; the template filler of §12 runs instead (gap 14). |
| Input | The idea text (one sentence to one page) and the company record. Nothing else. |
| Outputs | `intake.json` (§9), the class sentence (§11), one assumptions digest (§8), and at C1 a `BuildPlan` (§12). |
| State | Intake is a distinct state `intake` in the task state machine. A founder reply inside intake never starts a build (RQ1 §KQ3, Cursor "answer read as go", https://forum.cursor.com/t/plan-mode-how-to-prevent-cursor-from-switching-to-agent-mode-automatically/151214). |
| Cards consumed | Zero (§6). |
| Review items consumed | One digest, which is free (synthesis §3.5). |
| Founder minutes | Recorded as `intake_minutes` (DV4). Target under 5 minutes; to be measured by H4'. |

[MUST · H4 · A for "asking beats guessing", D for "bounded beats open" · all · design choice (to be measured)]: intake asks at most five multiple-choice questions, each with a pre-selected default, and consumes zero cards (synthesis §2 row 4; RQ1 §KQ2, https://raw.githubusercontent.com/github/spec-kit/main/templates/commands/clarify.md).

## 2. Q0: the restatement (read, never asked)

The planner (C2+) or the intake worker's drafting call (C1) produces, from the idea text alone:

1. A one-paragraph press release: customer, problem, what the product does on day one (RQ1 §KQ1, https://www.aboutamazon.com/news/workplace/an-insider-look-at-amazons-culture-and-processes).
2. A breadboard: `places`, `affordances`, `connections` (RQ1 §KQ1, https://basecamp.com/shapeup/1.3-chapter-04).
3. Coverage marks for Spec Kit's ten categories (RQ1 §KQ2).
4. A drafted answer for every question Q1–Q10 with an uncertainty mark.

| # | Coverage category | Mark | Feeds |
| --- | --- | --- | --- |
| 1 | Functional scope | Clear / Partial / Missing | Q1, Q2 |
| 2 | Domain and data model | same | Q4, Q5, Q6 |
| 3 | Interaction and UX | same | Q2, Q7 |
| 4 | Non-functional requirements | same | Q7 (defaults otherwise) |
| 5 | Integrations | same | Q8 |
| 6 | Edge cases | same | Q10 |
| 7 | Constraints and tradeoffs | same | Q3, Q9 |
| 8 | Terminology | same | glossary draft |
| 9 | Completion signals | same | Q2 (spine) |
| 10 | Placeholders | same | must be empty before intake closes |

Uncertainty mark per drafted answer: `clear` = 0, `partial` = 1, `missing` = 2. The mark is a field in `intake.json`, so the selection in §4 is a computation, not a judgement.

## 3. The question table

Founder wording is final; the planner may not paraphrase it. Options list the recommended default first. "Yes" or a tap on the default accepts it.

| # | Founder wording | Options (default first) | Drives | Default if not asked | Reopen trigger | Classes |
| --- | --- | --- | --- | --- | --- | --- |
| Q1 | Who uses this, and what breaks for them today without it? (shown as a draft) | Confirm draft / Edit (two sentences max). Sub-draft: "they sign in to come back to their own things" yes / no | actor, problem, P1 journey, `auth` | Never blocks; draft stands | Founder edit at any time | all |
| Q2 | What is the one thing a first user must do end to end on day one? | Drafted spine / second drafted spine / Edit | spine path, skeleton, first acceptance suite | Drafted from Q1 | Failed skeleton walkthrough (G9) | all |
| Q3 | How big a bet: a weekend page, a few weeks for a working v1, or a real product over months? | weeks / weekend / months | `appetite`, budget ceilings only (never class) | weeks | Breaker trip at 1.5× appetite | all |
| Q4 | Just individual users, or companies and teams that each have their own private space and data? | individuals / teams | `tenancy` (C3) | individuals | First team or invite request | all |
| Q5 | Does money move? Who pays whom, one-off or subscription, and do you ever pay out to others? | none for now / customers pay me one-off / customers subscribe / I pay out to others (multi-select) | `payments` (M-PAY), `payouts` (C4) | none; waitlist | First paying customer | all |
| Q6 | Do two kinds of people both sign up on their own and transact with each other without you in the loop (buyers and sellers, hosts and guests)? | no, one kind of user / yes | `two_sided` (C3) | single population | Second population needs self-signup | all |
| Q7 | Must several people see each other's changes live, or is refresh fine? | refresh is fine / live | `realtime` (M-RT, C3) | refresh | First "they cannot see my change" report | all |
| Q8 | Where does the truth already live (spreadsheet, Shopify, Stripe, calendar, inbox)? | nowhere yet / spreadsheet / Shopify / Stripe / calendar / inbox / other (multi-select) | `integrations` (M-INT), `connect_account` cards | none | Founder names a source | all |
| Q9 | Does this handle health, financial, children's or EU-resident personal data, or anything a regulator cares about? | no / yes (pick kinds) | `regulated` (C4, M-REG) | no | Any plan row that stores such a field | all |
| Q10 | Anything this must not do in v1? (shown as a draft) | Confirm draft / Edit | no-gos, evaluator scope fence | Drafted from Q2 and Q3 | Founder edit | all |

Q6 is the rewritten form (synthesis §3.6; debate-4 §1.2). A salon founder with clients and stylists answers "no", because the stylists do not sign up on their own and the founder stays in the loop.

Never asked, always defaulted (RQ1 §KQ5, https://raw.githubusercontent.com/github/spec-kit/main/templates/commands/specify.md): auth mechanism, sessions, retention, performance targets, error handling, framework, hosting, styling, analytics. Each becomes an assumption row (§8) with the stack default from `23-architecture-and-principles.md`.

## 4. Selection rule

[MUST · H4 · A/D · all · design choice (to be measured)]: Q1, Q2 and Q3 are always shown. They confirm drafts, so they cost seconds. Two further slots go to Q4–Q9 by score. Q10 is drafted into the digest and never occupies a slot.

```
rank        = { C1: 1, C2: 2, C3: 3, C4: 4 }
baseline    = classify(defaults)                            // every Q4..Q9 at its default, Q1..Q3 as answered
impact(q)   = max over options o of ( rank[classify(defaults with q = o).effective] - rank[baseline.effective] )
              + (1 if any option o adds a module not in baseline.modules else 0)
score(q)    = impact(q) * uncertainty(q)                    // uncertainty from Q0: clear 0, partial 1, missing 2
slots       = top 2 of Q4..Q9 by score, score > 0, ties broken by lower question number
asked       = [Q1, Q2, Q3] + slots                          // length <= 5
```

Impact is computed with the classifier of §10, not judged. Worked example, base C2 (accounts, no flags): Q4 teams → C3, impact 1; Q5 payouts → C4 plus M-PAY, impact 3; Q6 yes → C3, impact 1; Q7 live → C3 plus M-RT, impact 2; Q8 any → M-INT, impact 1; Q9 yes → C4 plus M-REG, impact 3. With base C1 and Q0 marking Q5 and Q9 `missing`, the slots go to Q9 (6) and Q5 (payouts path, 8); Q5 is asked first. Appetite (Q3) never changes the selection (synthesis §3.1). Replace the formula only after H4' measures class-change rates per question.

## 5. Stop rule

The intake worker evaluates the rule after every answer, in this order. The first true clause stops the round.

| # | Clause | Mechanical check |
| --- | --- | --- |
| 1 | Coverage | Every category in §2 is `Clear`, or defaulted with a non-empty `reopen_trigger` |
| 2 | Decision | The next candidate has `score == 0`, or `classify()` (§10) returns the same class and flags for every option of that question with all other answers held at default |
| 3 | Budget | Five questions have been asked |
| 4 | Founder | The founder tapped "Build it" (visible from Q3 onwards) |

Stop is not silence: the digest (§8) and the class sentence (§11) are always emitted.

[MUST · H4 · A/D · all · design choice]: round 2 exists only after a failed skeleton walkthrough (G9 `fail`). It asks at most three questions, chosen by the same score among the unasked Q4–Q9 plus the question mapped to the failed step's category (synthesis §3.6). No per-phase mini-intake (synthesis §4.2).

## 6. Zero intake cards

[MUST · H10 · B · all · invariant]: intake opens no decision card. Reasons: the quota (3/day) is shared with every department; the studio spec rules that drafts never consume quota (synthesis §2 row 16); a question with a safe default is an assumption, not a decision.

| Unresolved item at intake close | Becomes | Quota |
| --- | --- | --- |
| Any Q4–Q9 not asked | Assumption row in the digest with default and reopen trigger | none (digest is free) |
| Q10 no-gos | Drafted list in the digest | none |
| An integration from Q8 that needs the founder's own account | `connect_account` card, opened by `gate()` at skeleton step 3, not at intake | 1 card, later |
| A fork the classifier cannot default (two options give two classes) | Assumption on the lower class; `fork` card opened by `gate()` only when the first feature that depends on it is dispatched (§13) | 1 card, later |
| Class change discovered at runtime | `fork` card phrased as a consequence (synthesis §3.7) | 1 card, later |

## 7. How the non-technical founder sees it

[MUST · H10 · C · all · design choice]: one question per screen; two to five options; the recommended option first and marked; each option carries one line of consequence in product words and, where known, a time or account cost ("adds a Stripe account and about two days"). Progress reads "2 of 5". "Build it" is visible from Q3. EARS, ADRs, class codes and gate names never appear (debate-2 §5).

Rendering rules the intake worker enforces: option text ≤ 12 words; consequence ≤ 20 words; no stack nouns (framework, hosting, auth provider) in any option; the digest renders each assumption as "We assumed X. Change" with a one-tap flip.

## 8. Assumptions digest

One digest per intake, kind `assumptions`, free of quota (synthesis §3.5). Rows:

```ts
export const Assumption = z.object({
  id: z.string().regex(/^A-\d{3}$/),
  question: z.enum(["Q4","Q5","Q6","Q7","Q8","Q9","Q10","never_asked"]),
  topic: z.string().max(40),                 // "tenancy", "auth mechanism", ...
  default_value: z.string().max(80),
  reopen_trigger: z.string().max(120),       // founder-facing sentence
  status: z.enum(["assumed","confirmed","flipped"]),
  flipped_to: z.string().max(80).nullable(),
  flipped_at: z.string().datetime().nullable(),
  features: z.array(z.string()),             // feature ids that cite this assumption
});
```

A flip is handled by the worker, never by a model: (1) write `flipped_to`; (2) set `freshness: suspect` on every feature in `features` and their `depends_on` closure (blast radius, gap 7); (3) re-run `classify()`; (4) if the class or a flag changes, open one `fork` card through `gate()` with the consequence text; otherwise the planner re-plans the suspect rows in its next session. Flips count as `assumption_flips` (DV4, DV6).

## 9. `IntakeRecord` schema

File: `packages/core/src/engineering/intake.ts`. Stored as `intake.json` in North (not in the founder's repo) and referenced from the build.

```ts
export const Appetite = z.enum(["weekend","weeks","months"]);
export const ClassCode = z.enum(["C1","C2","C3","C4"]);          // landing, app, platform, critical
export const Flag = z.enum(["payments","payouts","realtime","regulated","integrations","ai_core","batch"]);
export const Module = z.enum(["M-PAY","M-REG","M-RT","M-INT","M-AI","M-BATCH"]);
export const Mark = z.enum(["clear","partial","missing"]);
export const Provider = z.enum(["spreadsheet","shopify","stripe","calendar","inbox","other"]);

export const Answers = z.object({
  q1: z.object({ actor: z.string().max(120), problem: z.string().max(240),
                 accounts: z.boolean(), journey: z.string().max(240) }),
  q2: z.object({ spine: z.string().max(240) }),
  q3: Appetite,
  q4: z.enum(["individuals","teams"]),
  q5: z.object({ payments: z.enum(["none","one_off","subscription"]), payouts: z.boolean() }),
  q6: z.boolean(),                                                 // two_sided
  q7: z.enum(["refresh","live"]),
  q8: z.array(Provider).max(6),
  q9: z.object({ regulated: z.boolean(), kinds: z.array(z.enum(["health","financial","children","eu_personal"])) }),
  q10: z.array(z.string().max(120)).max(8),                      // no-gos
});

export const QuestionLog = z.object({
  id: z.enum(["Q1","Q2","Q3","Q4","Q5","Q6","Q7","Q8","Q9","Q10"]),
  uncertainty: z.number().int().min(0).max(2),
  asked: z.boolean(),
  drafted: z.string(),
  answered_option: z.string().nullable(),
  answered_at: z.string().datetime().nullable(),
});

export const IntakeRecord = z.object({
  version: z.literal(1),
  company_id: z.string().uuid(),
  build_id: z.string().uuid(),
  idea_text: z.string().min(1).max(8000),
  restatement: z.object({
    press_release: z.string().max(1500),
    breadboard: z.object({ places: z.array(z.string()), affordances: z.array(z.string()),
                           connections: z.array(z.string()) }),
    coverage: z.record(z.enum(["functional_scope","domain_data","interaction_ux","nfr","integrations",
                               "edge_cases","constraints","terminology","completion_signals","placeholders"]), Mark),
    ai_core: z.boolean(), batch: z.boolean(),                     // flags read from the idea, not asked
  }),
  questions: z.array(QuestionLog).length(10),
  answers: Answers,                                                // defaults filled where not asked
  classification: z.object({ base: ClassCode, effective: ClassCode,
                             flags: z.array(Flag), modules: z.array(Module), sentence: z.string().max(240) }),
  assumptions: z.array(Assumption),
  round: z.union([z.literal(1), z.literal(2)]),
  stop_reason: z.enum(["coverage","decision","budget","founder"]),
  intake_minutes: z.number().nonnegative(),
  created_at: z.string().datetime(), closed_at: z.string().datetime().nullable(),
});
```

`questions.filter(q => q.asked).length <= 5` is a `refine` on the schema. Zod rejects a record with six asked questions, so the cap holds in code and in data.

## 10. Complexity classifier

[MUST · H12 · B for the cost argument, D for effect · all · design choice (to be measured)]: `classify(answers, restatement)` is a pure function in `packages/core/src/engineering/classify.ts`, exported, Vitest-tested with the table below. No model is called.

```ts
const MIN_CLASS: Record<Flag, ClassCode> = {
  payments: "C2", payouts: "C4", realtime: "C3", regulated: "C4",
  integrations: "C1", ai_core: "C2", batch: "C2",                  // integrations never raises class
};
const MODULE_OF: Record<Flag, Module> = {
  payments: "M-PAY", payouts: "M-PAY", realtime: "M-RT", regulated: "M-REG",
  integrations: "M-INT", ai_core: "M-AI", batch: "M-BATCH",
};
export function classify(a: Answers, r: Restatement): Classification {
  const auth = a.q1.accounts;
  const tenancy = a.q4 === "teams";
  const two_sided = a.q6 === true;
  const flags: Flag[] = [];
  if (a.q5.payments !== "none" || a.q5.payouts) flags.push("payments");
  if (a.q5.payouts) flags.push("payouts");
  if (a.q7 === "live") flags.push("realtime");
  if (a.q9.regulated) flags.push("regulated");
  if (a.q8.length >= 1) flags.push("integrations");
  if (r.ai_core) flags.push("ai_core");
  if (r.batch) flags.push("batch");
  const base: ClassCode = !auth ? "C1" : (tenancy || two_sided) ? "C3" : "C2";
  const effective = max(base, ...flags.map(f => MIN_CLASS[f]));      // precedence is max()
  const modules = unique(flags.map(f => MODULE_OF[f]));
  return { base, effective, flags, modules, sentence: sentenceFor(effective, flags, a) };
}
```

Rules: precedence is `max()`; a flag never lowers a class; modules add gates to the class's gate set (`25-verification-and-evidence.md`); `payouts` implies `payments`; appetite is not an input (synthesis §3.1).

### 10.1 Test cases

| # | Idea (debate-4 §1 cases first) | accounts | q4 | q5 | q6 | q7 | q8 | q9 | ai/batch | base | flags | effective | modules |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Landing page with waitlist | no | individuals | none | no | refresh | none | no | no | C1 | none | C1 | none |
| 2 | Salon booking, clients pay by card | yes | individuals | one_off | no | refresh | calendar | no | no | C2 | payments, integrations | C2 | M-PAY, M-INT |
| 3 | B2B SaaS, teams, roles, Stripe billing | yes | teams | subscription | no | refresh | stripe | no | no | C3 | payments, integrations | C3 | M-PAY, M-INT |
| 4 | Real-time whiteboard | yes | individuals | none | no | live | none | no | no | C2 | realtime | C3 | M-RT |
| 5 | Marketplace with payouts and disputes | yes | individuals | one_off + payouts | yes | refresh | stripe | no | no | C3 | payments, payouts, integrations | C4 | M-PAY, M-INT |
| 6 | Salon founder answering rewritten Q6 "clients and stylists" | yes | individuals | one_off | no (stylists do not self-sign-up) | refresh | none | no | no | C2 | payments | C2 | M-PAY |
| 7 | Landing page that takes a deposit, no accounts | no | individuals | one_off | no | refresh | none | no | no | C1 | payments | C2 | M-PAY |
| 8 | Public health intake form, no accounts | no | individuals | none | no | refresh | none | yes | no | C1 | regulated | C4 | M-REG |
| 9 | Internal nightly report tool | yes | individuals | none | no | refresh | spreadsheet | no | batch | C2 | integrations, batch | C2 | M-INT, M-BATCH |
| 10 | Public chatbot, no accounts | no | individuals | none | no | refresh | none | no | ai | C1 | ai_core | C2 | M-AI |
| 11 | Public collaborative board, no accounts | no | individuals | none | no | live | none | no | no | C1 | realtime | C3 | M-RT |
| 12 | Months of appetite, static brochure | no | individuals | none | no | refresh | none | no | no | C1 | none | C1 | none |
| 13 | Two integrations, no accounts | no | individuals | none | no | refresh | shopify, inbox | no | no | C1 | integrations | C1 | M-INT |
| 14 | Teams but Q4 defaulted (not asked), then flipped | yes | individuals → teams | none | no | refresh | none | no | no | C2 → C3 | none | C2 → C3 | none; `fork` card on flip |

Case 14 is the flip path of §8: the second run of `classify()` differs, so a `fork` card is opened. Every row is a Vitest case named `H12 classify: <idea>`.

## 11. The class sentence

Shown once at intake close, in the digest header, and stored in `classification.sentence`. Template: "This is a `<plain name>`: `<one consequence per flag>`. We will build `<spine from Q2>` first and show it to you."

| Class | Plain name | Consequence shown |
| --- | --- | --- |
| C1 | a page people can sign up on | "one page, one form, live in about a day" |
| C2 | an app with accounts | "sign-in, your own data, built in slices you review one by one" |
| C3 | a platform with separate workspaces (or two kinds of users) | "each company (or each side) gets its own private space; we design that first" |
| C4 | a product that moves money or regulated data | "extra checks on every money or data step; you approve go-live each milestone" |

Flag consequences: `payments` "a Stripe account and test payments before any real one"; `realtime` "a second service so people see changes live"; `regulated` "an audit trail and consent screens"; `integrations` "we will ask you to connect `<providers>`".

## 12. C1 single-slice plan template

[MUST · H5 · B · C1 · design choice]: at C1 no planner runs. The template filler (worker, deterministic) emits `docs/SPEC.md` rows and a `BuildPlan` from `intake.json`. Schema in `22-spec-and-plan-artifacts.md` §3. Slots in braces come from `intake.json`.

```jsonc
{
  "version": 1, "class": "C1", "flags": [], "modules": [], "created_by": "template",
  "spec": "docs/SPEC.md", "closes": ["LND-1","LND-2","LND-3","LND-4","LND-5","LND-6"],
  "slices": [{ "id": "spine", "name": "{answers.q2.spine}", "spine": true, "order": 1 }],
  "parallel": false, "appetite_usd_build": 6,
  "features": [
    { "id": "LND-F1", "requirement": "LND-1", "slice": "spine", "category": "functional", "appetite_usd": 1.0,
      "statement": "THE system SHALL serve the landing page with the headline \"{restatement.press_release.headline}\" and one call to action.",
      "steps": ["Given the preview URL for the pushed commit", "When a visitor opens /",
                "Then the response is 200 and the page shows the headline and the call to action"],
      "evidence_required": ["E2","E3"], "depends_on": [], "writes": ["app/page.tsx","app/layout.tsx","components/**"], "assumptions": [] },
    { "id": "LND-F2", "requirement": "LND-2", "slice": "spine", "category": "functional", "appetite_usd": 1.25,
      "statement": "WHEN a visitor submits a valid email, THE system SHALL store one waitlist row and show a confirmation.",
      "steps": ["Given a fresh email {seed}@example.test", "When the visitor submits it in the waitlist form",
                "Then the page shows the confirmation text", "And the waitlist table has exactly one row for {seed}@example.test"],
      "evidence_required": ["E2","E3"], "depends_on": ["LND-F1"], "writes": ["app/actions/waitlist.ts","supabase/migrations/0001_waitlist.sql","components/WaitlistForm.tsx"], "assumptions": ["A-001"] },
    { "id": "LND-F3", "requirement": "LND-3", "slice": "spine", "category": "ux", "appetite_usd": 0.75,
      "statement": "IF the same email is submitted twice, THEN THE system SHALL keep one row and show the same confirmation.",
      "steps": ["Given {seed}@example.test is already on the waitlist", "When the visitor submits it again",
                "Then the page shows the confirmation text", "And the waitlist table still has one row for that email"],
      "evidence_required": ["E2","E3"], "depends_on": ["LND-F2"], "writes": ["app/actions/waitlist.ts"], "assumptions": [] },
    { "id": "LND-F4", "requirement": "LND-4", "slice": "spine", "category": "security", "appetite_usd": 0.75,
      "statement": "IF one client sends 30 submissions in 10 seconds, THEN THE system SHALL answer 429 to the excess.",
      "steps": ["Given the preview URL", "When a probe posts 30 submissions in 10 seconds", "Then at least one response is 429"],
      "evidence_required": ["E2","E3"], "depends_on": ["LND-F2"], "writes": ["app/actions/waitlist.ts","lib/rate-limit.ts"], "assumptions": [] },
    { "id": "LND-F5", "requirement": "LND-5", "slice": "spine", "category": "compliance", "appetite_usd": 0.75,
      "statement": "THE system SHALL show a privacy notice and record consent with every waitlist row.",
      "steps": ["Given the landing page", "When the visitor submits the form without ticking consent", "Then the form refuses and names the consent box",
                "When the visitor ticks consent and submits", "Then the stored row carries consent_at"],
      "evidence_required": ["E2","E3"], "depends_on": ["LND-F2"], "writes": ["components/WaitlistForm.tsx","app/privacy/page.tsx","supabase/migrations/0001_waitlist.sql"], "assumptions": [] },
    { "id": "LND-F6", "requirement": "LND-6", "slice": "spine", "category": "ux", "appetite_usd": 0.75,
      "statement": "THE system SHALL meet axe zero violations, Lighthouse performance >= 70 and accessibility >= 90 on /.",
      "steps": ["Given the preview URL", "When the evaluator runs axe and Lighthouse on /", "Then violations == [] and both thresholds hold"],
      "evidence_required": ["E2","E3"], "depends_on": ["LND-F1"], "writes": ["app/**","components/**"], "assumptions": [] }
  ]
}
```

Template rules: `A-001` is the assumption "waitlist rows live in your own Supabase project"; its `connect_account` card opens at skeleton step 3. A confirmation email is not in the template; it is an assumption ("on-page confirmation only") with reopen trigger "founder asks for an email". The acceptance suite for C1 is the template smoke suite (synthesis §4.1 row 3); G7 runs once per build. Thresholds come from synthesis §5 and are tuned on DV5.

## 13. Card bundling and defaults for later forks

Forks are decided after intake, by `gate()`, as `fork` cards with defaults (synthesis §2 row 33; §3.5). Intake prepares them through `assumptions` and `blocked_on`.

```ts
export const BlockedOn = z.object({
  kind: z.enum(["feature","card","integration"]),
  id: z.string(),
  default: z.string().max(80).nullable(),          // option id; null only when no safe default exists
  default_applies_at: z.string().datetime().nullable(),
});
export const ForkCard = z.object({
  kind: z.literal("fork"),
  cluster_id: z.string(),                           // forks bundled into this card
  question: z.string().max(200),                    // product consequence, no stack nouns
  options: z.array(z.object({ id: z.string(), label: z.string().max(60), consequence: z.string().max(120),
                              class_after: ClassCode, days_delta: z.number(), accounts_needed: z.array(Provider) })).min(2).max(3),
  recommended: z.string(), default: z.string(),
  default_applies_at: z.string().datetime(),        // opened_at + 24 h unless the plan sets shorter
  blast_radius: z.array(z.string()),                // feature ids that go suspect if the default flips
});
```

| Rule | Tag |
| --- | --- |
| Only `gate()` opens a `fork` card; the builder and critics have no `AskUserQuestion` (synthesis §2 row 33) | [MUST · H10 · B · all · invariant] |
| A fork cluster is one card: forks are clustered when their features share a `slice` or their `assumptions` intersect; the card carries a recommended set (debate-4 §7.7) | [MUST · H10 · B · all · invariant] |
| Every card carries `default` and `default_applies_at` (opened_at + 24 h); the worker applies the default at the deadline, writes the assumption flip, marks `blast_radius` suspect | [MUST · H10 · B · all · invariant] |
| A task that needs a second card in one day proceeds on the default at `default_applies_at`; it is parked only when `default == null` (synthesis §6 rule 19) | [MUST · H10 · B · all · invariant] |
| A card lists 2–3 options (CONTEXT.md `DecisionCard`); more options means the planner has not clustered | [MUST · H10 · C · all · process] |
| Appetite overrun is a `breaker` review item, never a card (synthesis §2 row 27) | [MUST · H13 · A · all · invariant] |

Expected card counts per build are in synthesis §5 (C1: 2; C2: ~4; C3: 6–8 bundled; C4: 8–12 bundled). `20-blueprint-overview.md` §6 carries the founder-days consequence.

## 14. What intake records for the experiments

From build one (synthesis §4.1 metrics row): `intake_questions_asked`, `intake_minutes`, `stop_reason`, `assumption_flips` per 30 days, `class_changes_at_runtime`, `fork_cards_per_build`, `defaults_applied_at_deadline`. H4' compares N ∈ {0, 3, 5, 7, uncapped} on matched prompts against T4 acceptance per founder-minute; H12' compares DV1 and DV5 by class. Until those run, every count above is a design constant.
