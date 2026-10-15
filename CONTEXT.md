# North: domain glossary

Canonical names for the concepts in `docs/SPEC.md`. Code, database and UI use the
English `Code name`. Turkish names are the spec's wording.

| Term | Code name | Definition |
| --- | --- | --- |
| Company (Şirket) | `Company` | One venture the user runs. A user may own several. Every other record belongs to exactly one company. |
| Thesis (Tez) | `Thesis` | One-paragraph idea, target customer and why-now. Versioned. The root of every agent's context. |
| Goal (Hedef) | `Goal` | A measurable target: metric key, target value, due date. At most three active per company. |
| Budget (Bütçe) | `Budget` | Money the user authorises agents to spend, per category (ads, tools, domain, other), with a total and a daily cap. Spent from the user's own accounts. |
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
| Metric | `Metric` | A time series per company (`metric_key`, value, source, measured_at). Sources: Stripe, analytics, ad APIs, email replies. |
| Company Memory (Şirket Hafızası) | `Memory` | Thesis, personas, decisions, documents and learnings, searchable (pgvector). All agents read the same memory. |
| Artifact (Artefakt) | `Artifact` | A persistent output produced by an agent (PRD, business plan, deck, website, creative). Versioned and downloadable. |
| Brief (Brifing) | `Brief` | Morning summary per company: yesterday, metrics, pending cards, today's plan. Readable in 60 seconds. |
| Kill Switch | `KillSwitch` | "Stop all agents": freezes the queue and pauses active campaigns within 5 seconds. Present on every screen. |
| Connection (Bağlantı) | `Connection` | A user's OAuth link to an external tool (GitHub, Vercel, Stripe, Gmail, Meta Ads). Tokens encrypted at rest and read by the worker only (ADR 0008); in sandbox mode "Connect (sandbox)" records one without a token. |
| Connect Card (Bağlantı kartı) | `ConnectCard` | A K2 card with options `connected` / `skip` opened when a task needs an account the user has not connected (ONB-3). It carries no action: "connected" re-dispatches the task, "skip" (the default) marks it failed. |
| Credit | `Credit` | The unit of work included in a subscription plan; consumed by tasks. |
| Agent Run | `AgentRun` | One execution of an agent for one task: model, tokens, cost, duration, trace. |

## Relationships

- A `Company` has one current `Thesis`, up to three active `Goal`s, several `Budget` categories, one `Agent` per role, many `Plan`s.
- A `Plan` has many `Task`s; a `Task` belongs to one `Agent` and may produce many `Action`s and `Artifact`s and exactly one `Evidence` when done.
- A K2 `Action` is blocked until its `DecisionCard` is answered (or its safe default applies at the due time). A K3 `Action` has no default and never runs without an explicit answer.
- Every `Action` and `LedgerEntry` is immutable once written.
