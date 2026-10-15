# North: domain glossary

Canonical names for the concepts in `docs/SPEC.md`. Code, database and UI use the
English `Code name`. Turkish names are the spec's wording.

| Term | Code name | Definition |
| --- | --- | --- |
| Company (Şirket) | `Company` | One venture the user runs. A user may own several. Every other record belongs to exactly one company. |
| Thesis (Tez) | `Thesis` | One-paragraph idea, target customer and why-now. Versioned. The root of every agent's context. |
| Goal (Hedef) | `Goal` | A measurable target: metric key, target value, due date. At most three active per company. |
| Budget (Bütçe) | `Budget` | Money the user authorises agents to spend, per category (ads, tools, domain, other), with a total and a daily cap. Spent from the user's own accounts. Spent amounts are written only by the worker through `apply_budget_spend`; today's cap may be raised for the day by a cap card (`dailyExtraUsd`, reset at the day roll). A cap counts as reached once spend equals it. |
| Campaign (Kampanya) | `Campaign` | One ads campaign North started on the user's ad account: a mutable summary row per executed `ads.start` action (provider, provider campaign id, name, daily and total budget, landing URL, spent and delivery totals) with a status in `active`, `paused_cap`, `paused_kill`, `paused_user`, `ended`. Owners read it; only the worker writes it. |
| Cap Card (Limit kartı) | `CapCard` | The K2 card (`budget.cap.raise`) opened after a campaign was paused for a reached daily or total cap: "Raise today's cap by $X and resume?". Options `approve` / `decline`, recommendation and default `decline`. One per campaign per day; a raise over $500 is K3. |
| Lead (Aday müşteri) | `Lead` | One prospect a sales task may contact: name, email, company, why; `source` `upload` (CSV, ≤ 500 rows) or `research` (a K0 `lead_research` task); status `new`, `contacted`, `replied`, `bounced`, `opted_out`. Unique per company by email. |
| Outreach Batch (Erişim partisi) | `OutreachBatch` | The first-contact emails of one `outreach_batch` task, sent from the user's own mailbox: one `email.send.first_contact` action per lead sharing one `batchId`, gated by exactly one decision card. Identified by `batchId`; replies come back as the `email_replies` metric. |
| Agent (Ajan) | `Agent` | An AI employee with one role, a fixed tool list and a maximum action tier. Roles are defined in `agents/*.yaml`. |
| Chief of Staff | `ChiefOfStaff` | The agent role that turns goals into plans, dispatches tasks, measures outcomes, writes cards and the brief. Roles never hand work to each other directly; every handoff passes through it. |
| Plan | `Plan` | Chief of Staff's weekly work plan for a goal: tasks with expected metric impact and cost. |
| Task (Görev) | `Task` | One unit of work for one agent: input, output, status (`queued`, `running`, `waiting_decision`, `done`, `failed`), cost, metric key, attempts. `done` requires evidence. |
| Evidence (Kanıt) | `Evidence` | A verifiable reference that proves a task finished: URL, deploy ID, sent-message ID, test result. |
| Action (Eylem) | `Action` | One step that touches the outside world (send email, start campaign, deploy). Always classified into a tier and written to the audit log. Append-only: a status change (`pending` → `executed`/`declined`) is a new row that `supersedes` the previous one; the latest row of a chain is the action's state. |
| Tier (Katman) | `Tier` | Risk class of an action, assigned by the rule engine, never by the agent: `K0` automatic, `K1` notify, `K2` decision card, `K3` user only. An agent may raise a tier, never lower it. |
| Decision Card (Karar Kartı) | `DecisionCard` | A single decision for the user: question, 2-3 options, recommendation, safe default, due time. The only way a K2 action runs. |
| Decision Quota (Günlük kota) | `DecisionQuota` | Maximum cards per user per day (default 3, range 1-5). Never exceeded. |
| Auto Rule (Otomatik onay kuralı) | `AutoRule` | A user-accepted standing answer ("auto-approve ad tests under $50") created after the same decision is made three times the same way. |
| Signal (Sinyal) | `Signal` | An external or internal event the proactive layer captured (trend, dropped metric, error, competitor move). Scored; converts to a card above a threshold. |
| Outcome Ledger (Sonuç Defteri) | `OutcomeLedger` | Append-only record of what each task/action changed in which metric, at what cost. |
| Metric | `Metric` | A time series per company (`metric_key`, value, source, measured_at, scope). `company` scope is the company's own series (goal bar, brief), with exactly one source per mode; `channel` scope is what one campaign or batch contributed (see Metric Sample). Sources: Stripe, analytics, ad APIs, email replies. |
| Metric Sample (Metrik örneği) | `MetricSample` | One row of a metric. Scope `company`: the company's value at `measured_at`. Scope `channel`: the cumulative value attributed to one source, with `Provenance` discriminated on `channel` (`meta_ads` / `google_ads` with `campaignId`; `cold_email` with `batchId` and `messageIds`; plus `windowEnd`, `sandbox`, `raw`) and a `provenanceKey` (`meta_ads:<campaignId>`, `cold_email:<batchId>`). Written only by the worker. |
| Channel (Kanal) | `Channel` | Where a metric change came from: `meta_ads`, `google_ads`, `cold_email`, `organic`. The ledger's `channel` column and the channel report use it; `organic` carries no provenance. |
| Attribution Window (Atıf penceresi) | `AttributionWindow` | One collection interval for one source, closed at `windowEnd`. Two cumulative samples give the ledger entry (`windowDelta`: `before`, `after`, `costUsd` = spend in the window, never negative). The unique key (`company`, `metric_key`, `provenance_key`, `window_end`) makes a replayed window a no-op. |
| Company Memory (Şirket Hafızası) | `Memory` | Thesis, personas, decisions, documents and learnings, searchable (pgvector). All agents read the same memory. |
| Artifact (Artefakt) | `Artifact` | A persistent output produced by an agent (PRD, business plan, deck, website, creative). Versioned and downloadable. |
| Brief (Brifing) | `Brief` | Morning summary per company: yesterday, metrics, pending cards, today's plan. Readable in 60 seconds. |
| Kill Switch | `KillSwitch` | "Stop all agents": freezes the queue, pauses every campaign that may still deliver (`active`, and a cap or user pause the provider may not have applied) within 5 seconds, and takes no card answer until resume. Present on every screen. |
| Connection (Bağlantı) | `Connection` | A user's OAuth link to an external tool (GitHub, Vercel, Stripe, Gmail, Meta Ads). Tokens encrypted at rest and read by the worker only (ADR 0008); in sandbox mode "Connect (sandbox)" records one without a token. |
| Connect Card (Bağlantı kartı) | `ConnectCard` | A K2 card with options `connected` / `skip` opened when a task needs an account the user has not connected (ONB-3). It carries no action: "connected" re-dispatches the task, "skip" (the default) marks it failed. |
| Credit | `Credit` | The unit of work included in a subscription plan; consumed by tasks. |
| Agent Run | `AgentRun` | One execution of an agent for one task: model, tokens, cost, duration, trace. |

## Relationships

- A `Company` has one current `Thesis`, up to three active `Goal`s, several `Budget` categories, one `Agent` per role, many `Plan`s.
- A `Plan` has many `Task`s; a `Task` belongs to one `Agent` and may produce many `Action`s and `Artifact`s and exactly one `Evidence` when done.
- A K2 `Action` is blocked until its `DecisionCard` is answered (or its safe default applies at the due time). A K3 `Action` has no default and never runs without an explicit answer.
- Every `Action` and `LedgerEntry` is immutable once written.
- A `Campaign` belongs to one executed `ads.start` `Action` (`action_id` unique) and to the `Task` that proposed it; every later pause or resume is a new `Action` row, the campaign row is only the summary. A `CapCard` belongs to one `Campaign` and one day.
- A `MetricSample` with `channel` scope belongs to a `Campaign` or an `OutreachBatch` through its provenance key; a `company`-scope sample belongs to neither.
- A `LedgerEntry` references its `AttributionWindow` (the provenance with its `windowEnd`), the `Campaign` when its channel is an ads channel, and the `Action` that caused the spend. Its `before` / `after` are the source's cumulative attributed metric.
- An `OutreachBatch` is one `DecisionCard` and many `email.send.first_contact` `Action`s; each action has its own `Lead`, message id and `Evidence`. A `Lead` is contacted by at most one batch.
