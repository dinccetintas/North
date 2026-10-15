# ADR 0012: Signals become cards only through the gate; the weekly cap is in the database; the brief is a table row

Status: accepted (2026-10-15)

## Context

PRO-1 asks the research agent to scan its sources and turn the one signal
worth attention into a card with evidence links; PRO-3 (V2) promises at most
one "new opportunity" card per week; BRF-1 asks for a morning brief readable
in 60 seconds. Until M4 `signals` was an empty table from migration 0001 and
`briefs` had a unique `(company_id, brief_date)` key and no writer.

A signal is the first thing in North whose text comes from outside (a Reddit
post, a competitor page, an error title) and whose "should we act" verdict
comes from a model. Three ways of opening the card were on the table: let the
research agent run and request the card from inside its run; let the scan
open a card directly with `createCard`; or make conversion an action kind so
the authority engine opens the card the way it opens every other K2. The
first lets web content steer an agent that holds tools; the second creates a
card path that skips `AuthorityEngine.gate()` (non-negotiable 1). The brief
had a similar choice: an artifact written by the Chief of Staff's model, or
a deterministic row.

## Decision

**A signal is a row; it becomes a card only through the gate.** `signals`
gains `kind` (`opportunity | metric_drop | error`), `status` (`new | scored |
below_threshold | card_opened | deferred | capped | approved | declined |
converted`), `source_ref` (unique per `(company_id, source, source_ref)`: a
rescan never re-inserts a post), `title`, `url`, `excerpt`, `score`,
`rationale`, `card_week`, `converted_card_id`, `converted_task_id`. Owners
read; the worker writes. Conversion is the new action kind **`signal.pursue`**
(risk profile: no external effect, K0 base), gated by the worker with
`requestedTier: "K2"` and `origin: "worker"`, the same shape as the M4
kill-switch resume card: the gate opens the card with reason `agent_raised`,
the card counts against the daily quota, a spent quota defers it (status
`deferred`, retried by the next scan, never a second row), and the kind is in
`WORKER_ONLY_KINDS`, so an agent run cannot request it. Approve performs the
action: a `signal_research` task (research, K0) is created with the signal's
facts as data (`signalTaskInput`) and dispatched by settlement's follow-up;
the external reference is `task:<id>`. Decline, the default, marks the signal
`declined`. The card's question is `Look into "<title>"? (<source>, score
<s>)` and its facts carry the evidence URL, so the card contains evidence
links before PRO-3 ships.

**The weekly cap lives in the database (PRO-3-CAP).** At most one
`opportunity` card per company per ISO week of the owner's local day. Code
checks first (`signalCardAllowed(signals, isoWeek(localDay))`); the database
backs it: `signals.card_week` (`YYYY-Www`, set when the card opens) with a
partial unique index on `(company_id, card_week) where kind = 'opportunity'
and card_week is not null`. A unique violation becomes `SignalCapError` and
the signal is `capped` (the brief lists it as "held for next week").
`metric_drop` and `error` signals are not under the weekly cap; they are
bounded by the daily quota and by dedupe. At most `SIGNAL_CARDS_PER_SCAN = 1`
card opens per scan, so one scan cannot empty the day's quota, and `deferred`
rows are retried before any new one (oldest first: they already waited a
day).

**Scoring is one structured Haiku call, not an agent run.** The sources are
read by the worker through `SignalSource` adapters with no model; candidates
are scored in one `LlmClient.structured` call with the `classifier` alias
(`packages/core/src/models.ts` resolves it; no model id anywhere else),
output `{ scores: [{ id, score 0..1, summary, rationale }] }` validated with
Zod; ids not in the batch are dropped, scores clamped. Tests and the mock
worker use `MockLlm` (the ONB-1 pattern), keyed `signal:score`, with a
fixture record exported by `packages/agents`; on `LlmError` the heuristic
scorer (source weight, thesis keyword overlap, recency) stands in, so a scan
never fails on the model. `metric_drop` signals are scored by rule (`0.75`),
`error` signals are `1.0` and never scored. The threshold is
`SIGNAL_THRESHOLD = 0.7`.

**The brief is a `briefs` row, not an artifact, and it is not written by a
model.** One row per company and local day (`unique (company_id,
brief_date)`), `content` = core `Brief` JSON, rendered to markdown for the
email and to the `BriefPanel` on the home screen. `composeBrief(input)` in
core is deterministic: the numbers are the ledger's, the ordering is fixed
(yesterday → metrics → decisions → today → spend → signals → escalations),
and lists are trimmed by priority (`today`, `signals`, `yesterday.actions`,
`escalations`) until the brief is under `BRIEF_MAX_WORDS = 200`, 60 seconds
at a slow reading pace; pending cards are never trimmed. An artifact would
need a storage upload and a version per day; a row is queryable ("was
today's brief sent?") and cheap. The Chief of Staff still writes it in the
product sense (the role owns the template and the brief is sent in its
name); a model-written headline is M6 work once Langfuse traces exist to cost
it. The brief is K0: it reads. Push and email go through the M2 notification
channel (platform Resend / web-push, recorded in `notifications` with `kind:
brief`), never through the gate, exactly as decision notifications do. The
brief hour is fixed at 07:00 local (`BRIEF_HOUR = 7`); a per-user hour is a
settings field for M6.

## Consequences

- There is exactly one path from "something was noticed" to "the user is
  asked": `signals` row → `gateStandalone(signalPursueSpec)` → card. A scan
  that calls `createCard` directly is a bug; the gate's `WORKER_ONLY_KINDS`
  check makes an agent-origin `signal.pursue` a `blocked` row with reason
  `worker_only`.
- Signal and fix cards count against the daily quota (DEC-3). A busy day
  defers the signal rather than exceeding the quota; the deferred row is the
  retry state, so no scan opens a second card for the same post.
- The weekly cap holds even when the code path is bypassed: the partial
  unique index refuses the second opportunity card of the week at insert
  time. `metric_drop` and `error` kinds deliberately bypass it, so an outage
  is never "held for next week".
- Signal text is data everywhere: it is scored as data in the prompt, wrapped
  as data in `signalTaskInput`, and rendered as text (never HTML) in the card
  and the brief. The sandbox Reddit fixture carries a literal `<b>` so the
  web proves it.
- A scan degrades, never fails: a source that throws `NotConfiguredError` or
  a provider error contributes nothing for that scan, and a model error falls
  back to the heuristic scorer.
- Adding a source means a `SIGNAL_SOURCES` entry, a `SignalSource` adapter
  with a sandbox fixture, and a `MockLlm` score for its fixture ids. Nothing
  about cards, caps or the brief learns about it.
- The brief's content is reproducible from the ledger, the cards and the
  signals of that day; a second `brief/tick` for the same company-day returns
  the existing row. A brief for a stopped company still arrives and says so.
