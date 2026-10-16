# Continuous learning and memory for North

Research date 2026-10-16. Scope: how North's agents, departments and companies learn from
their own work, which libraries and patterns to use, and how to do it inside the user's
Supabase Postgres under RLS and the $100/month dev budget. Every claim carries a source
number from the list at the end; "unverified" marks what could not be checked.

State today: `memory_items` holds five kinds with full-text search and an unused
`vector(1536)` column; `learning` rows come only from `escalateTask` and Sentry; `planContext`
reads the last five escalations and the ledger report (PLN-2); every run gets the same
6,000-character digest; nothing records what a run used, expires, or crosses companies.

## Summary

1. No library fits North's rule that everything lives in the user's Supabase under RLS.
   Mem0 OSS can write to Supabase but owns its table, scopes tenants by a JSONB filter and
   ships RLS off [S4]; Letta's self-hosted server is deprecated [S9]; Zep Community Edition
   is unsupported and Graphiti needs Neo4j or FalkorDB [S10][S12]; LangMem's last release
   was October 2025 [S15]. Build on pgvector in `packages/db`.
2. The products that ship learning in 2026 share one shape: short records the agent writes,
   an index loaded every session, the rest fetched on demand, and an offline consolidation a
   human can review: Claude Code auto memory [S23], Managed Agents memory stores and
   "dreams" [S21][S22], Letta dreaming [S8], Mem0's "Dream" [S2]. Copy the shape, not a vendor.
3. The research on learning without weight updates agrees: Reflexion (+11 points
   HumanEval) [S38], ExpeL [S39], Voyager [S40], Agent Workflow Memory (+24.6% Mind2Web,
   +51.1% WebArena, relative) [S42], Memp [S43], ReasoningBank (failures are signal) [S44],
   ACE (+10.6% on agent benchmarks, no labels) [S45]. The mechanism: distil a short lesson
   from a trajectory plus an outcome, store it with provenance, retrieve by task, count help.
4. The failure modes are documented too: brevity bias and context collapse when a model
   rewrites its own playbook [S45], memory poisoning through ordinary queries (MINJA) [S49]
   and through under 0.1% poisoned records at over 80% success (AgentPoison) [S50], a 30%
   accuracy loss on long-horizon memory (LongMemEval) [S48]. Anthropic mounts untrusted
   memory read-only and treats stored memory as data [S21][S20].
5. The lesson, not the transcript, is the unit of learning: an evidence reference North
   already has (critique, review answer, ledger window, escalation, chat message), a
   code-computed confidence, a scope, an expiry, and helpful and harmful counts [S45][S39].
6. Retrieval under a token budget is solved on Supabase: a generated `tsvector` with GIN,
   an HNSW index and a `hybrid_search` function with reciprocal rank fusion [S29]; embeddings
   from `gte-small` in Edge Functions at no vendor cost, queued through pgmq, pg_cron and
   pg_net [S30][S31][S32]; Voyage `voyage-4-lite` ($0.02 per million tokens) as the upgrade [S35].
7. Prompt optimisers are offline tools: GEPA beats GRPO by about 6% with up to 35x fewer
   rollouts and MIPROv2 by over 10% [S51]; Anthropic's skill-creator runs with-and-without
   evals with a human review each iteration [S27]. Use them monthly on North skills and
   persona briefs through a PR, never inside a company's run.
8. Cross-company learning is legally ordinary when aggregated, de-identified and opt-in: the
   Common Paper clause permits training on "aggregated, de-identified data" and 14% of 2026
   contracts prohibit AI training [S58]; the EDPB requires identification to be "very
   unlikely" [S57]; Anthropic "may not train models on Customer Content" [S55]. North
   playbooks hold patterns and counts, never names, leads or provider data.
9. Learning must be measured: capability evals that start low and regression evals near
   100% [S26], with-and-without-lessons runs on the golden tasks the studio spec plans, a
   lesson hit rate from `lesson_applications`, automatic retirement when harm exceeds help.
10. Cost fits: weekly department retros on the Haiku tier (about 24 runs a month, under $2),
    embeddings at $0, eval doubling inside the nightly line: about $7-10 a month on top of
    the spec's $72 [S61].

## Findings

### 1. Memory libraries and services in 2026

**Mem0** (Apache-2.0, 67.3k stars; PyPI 2.2.1 and npm 3.3.1, 2026-09-25) [S1]. The paper
extracts candidate facts from the latest exchange plus a rolling summary, retrieves the
top-10 similar memories and lets the LLM pick ADD, UPDATE, DELETE or NOOP; on LOCOMO it
scores 66.9 against 72.9 for full context at 1,800 instead of 26,000 tokens per query [S5].
The docs now say both OSS and Platform are ADD-only with `expiration_date`, scoped by
`user_id`, `agent_id`, `run_id`, `app_id` and metadata [S1][S3]. The Supabase store creates
its own `memories` table, ships RLS off, scopes tenants by metadata filter and truncates
above PostgREST's 1,000 rows [S4]. Platform: Hobby free, Starter $19, Pro $249 with graph
memory and "Dream" consolidation, Enterprise on-prem [S2]. Verdict: read the prompts,
reject the storage.

**Letta (MemGPT)** (Apache-2.0, 25.2k stars; source moved to `letta-ai/letta-code`; PyPI
0.34.12, 2026-10-12) [S6]. Memory blocks (label, description, value, limit, `read_only`,
shareable) sit in every prompt; MemFS is git-tracked; "dreaming" runs background subagents
after N steps or at compaction, optionally reviewed by a second agent [S7][S8]. The Docker
self-host is "no longer an actively maintained or supported Letta product surface" [S9].
Verdict: borrow blocks and review-before-apply; not the runtime.

**Zep and Graphiti**. Zep Community Edition is deprecated; the product is Zep Cloud (Free,
Flex $125, Flex Plus $375, Enterprise with BYOC; SOC 2 Type II; DPA only on Enterprise)
[S12][S13]. Graphiti (Apache-2.0, 31.8k stars, `graphiti-core` 0.31.1 on 2026-10-15) keeps
a bi-temporal graph with validity windows on Neo4j, FalkorDB or Neptune; tenants are
`group_id` namespaces, which "do not replace application authorization" [S10][S11]; the
paper reports 94.8% on DMR against MemGPT's 93.4% [S14]. Verdict: borrow the validity
windows, not the database.

**LangMem** (MIT, 1.7k stars; last release 0.0.30 on 2025-10-27) [S15] has the clearest
taxonomy: semantic (facts, as collection or profile), episodic (past successes with
reasoning), procedural (how to behave, refined from feedback), formed on the hot path or in
the background, with a metaprompt optimizer [S16]. Verdict: adopt the taxonomy only.

**Cognee** (Apache-2.0, 32.4k stars; 1.6.4 on 2026-10-13) is a document-ingestion engine
with multi-tenant datasets, pgvector support and Postgres-as-graph "as a demo feature"
[S17]. **Supermemory** (MIT repo, npm 5.0.2 on 2026-10-13, 31.3k stars) is a hosted memory
API with a local binary, $0 to $399 plus Enterprise, no training statement [S18][S19].
Verdict for both: not North's problem or not North's database.

**Anthropic memory tool** (`memory_20250818`, all Claude 4+ models, no beta header): the
model issues six file commands under `/memories` and the client executes them against its
own storage; the docs require path validation and suggest stripping sensitive data, capping
sizes and expiring unused files; the TypeScript SDK ships `betaMemoryTool`; ZDR-eligible
[S20][S56]. Verdict: an optional write path for an agent's own notes onto a company table.

**Claude Managed Agents memory stores** (beta): workspace-scoped files at
`/mnt/memory/<store>`, 100 kB per memory, 10,000 per store, 8 stores per session,
`read_only` or `read_write`, immutable versions with redaction; an injection into a
read-write store "is read as trusted memory" later [S21]. **Dreams** (research preview)
read a store plus 1-100 transcripts and write a new deduplicated store without touching the
input [S22]. Verdict: Anthropic-hosted, so out, but the reference design.

**Claude Code auto memory and CLAUDE.md**: four note types (`user`, `feedback`, `project`,
`reference`), skips what the code shows, a `MEMORY.md` index of which only the first 200
lines or 25 KB load, topic files on demand, per-repository and machine-local, disabled by
`CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` (SEC-2); CLAUDE.md under 200 lines, context not
enforcement [S23]. Verdict: `feedback` is North's founder-correction lesson.

**pgvector and Supabase**. pgvector 0.8.7 adds iterative scans for filtered queries,
`halfvec`, list partitioning for tenants, and RRF or a cross-encoder for hybrid search
[S28]. Supabase's recipe: a generated `tsvector` with GIN, `embedding` with HNSW, and
`hybrid_search(query_text, query_embedding, match_count, full_text_weight, semantic_weight,
rrf_k)` scoring `1/(k+rank)` per list [S29]. Automatic embeddings: triggers enqueue into
pgmq, pg_cron runs every 10 seconds, pg_net calls an Edge Function, retries through the
visibility timeout [S30][S32]; the Edge Runtime embeds with `gte-small` and no external API
[S31]. `pg_search` (ParadeDB BM25) is AGPL-3.0 and not in Supabase's catalogue; Supabase
offers `pgroonga` without BM25 ranking [S34][S33]. Rerankers: Voyage `rerank-2.5-lite` $0.02
per million tokens [S35]; Cohere about $2 per 1,000 searches (third-party) [S37].
Embeddings: Voyage `voyage-4-lite` $0.02, `voyage-4` $0.06, `voyage-4-large` $0.12 per
million, 200 million free [S35]; OpenAI `text-embedding-3-small` about $0.02 (aggregators;
official page 403) [S36].

### 2. Self-improving agents: what the evidence supports

- Reflexion stores verbal self-reflections in an episodic buffer: HumanEval pass@1 80% to
  91% [S38]. ExpeL extracts insights by comparing failed and successful trajectories [S39].
  Voyager stores executable skills only after verification [S40]. AWM induces reusable
  workflows [S42]. Memp keeps procedures that are updated, corrected and deprecated; a
  stronger model's memory helps a weaker one [S43]. ReasoningBank distils strategies from
  successes and failures and beats success-only memories [S44].
- ACE separates generator, reflector and curator, applies incremental deltas to a playbook,
  and shows whole-context rewrites cause brevity bias and context collapse [S45]; an
  Apache-2.0 Python implementation (`ace-framework`, 2.6k stars, embedding deduplication)
  exists, no maintained TypeScript port [S46]. Dynamic Cheatsheet moves GPT-4o on Game of
  24 from 10% to 99% and reports no failure analysis [S47]. Generative Agents score memories
  by recency (0.995 decay), LM-rated importance (1-10) and relevance, and reflect when
  summed importance passes 150, producing insights that cite their sources [S41].
- Anthropic: keep "the smallest set of high-signal tokens", load an index and fetch the rest
  just in time, keep notes outside the window [S24]; persist a progress file and a feature
  list the agent may only flip, never edit tests, verify end to end [S25]; build 20-50 eval
  tasks from real failures, graduate capability evals into regression suites, prefer code
  graders [S26]. `skill-creator` improves a skill offline: with-and-without runs, grader
  subagents, a human review every iteration, descriptions chosen by held-out score [S27].
  Nothing from Anthropic has an agent rewriting its own SKILL.md unsupervised.
- OpenAI's Agents SDK "sessions" are conversation history with compaction; no fact
  extraction or procedural memory [S54].
- GEPA reflects on trajectories in natural language over a Pareto frontier: about +6% over
  GRPO with up to 35x fewer rollouts, over +10% over MIPROv2 [S51]; DSPy 3.4.1 and `gepa`
  0.1.4 are MIT and current [S52]; promptfoo (MIT, 26.1k stars, 0.124.1 on 2026-10-08) runs
  rubric and model-graded evals in CI with Anthropic providers [S53].
- Failure modes: MINJA injects records through query-only interaction [S49]; AgentPoison
  backdoors memory with under 0.1% poisoned records at over 80% success [S50]; LongMemEval
  shows about 30% loss across sessions [S48]; OWASP lists cross-tenant leakage and
  vector-store poisoning as LLM08:2025 (page not fetchable here) [S60].

For a production product: lessons are short, typed, evidence-linked, versioned and scoped; a
separate persona extracts them in a fresh context; behaviour changes go through review; memory
is injected as data; retrieval is bounded; outcomes are counted; consolidation can be dropped.

### 3. Learning signals North has or can add

| Signal (status) | Table | Lesson kind | Evidence ref | Confidence rule (code) |
| --- | --- | --- | --- | --- |
| Critique scores, hard-gate failures (M8) | `critiques` | `anti_pattern`, `tactic` | critique id | same criterion fails >= 3 in 30 days |
| Variant pick, rejected drafts (M8) | `review_items` | `preference`, `tactic` | review item id | 1 answer 0.4; 3 consistent 0.8 |
| Founder comments (M8) | `artifact_comments` | `preference`, `rule` | comment id | founder-authored: active at once |
| Card answers, auto rules (M0-M6) | `decision_cards`, `auto_rules` | `rule` | card id | consistent answers >= 2 |
| Ledger windows (M3+) | `ledger_entries` | `tactic` with delta and cost | entry ids | `channelReport` verdict needs >= 2 entries |
| Failures, escalations (exists) | `tasks`, `memory_items` | `anti_pattern` | task id | two failed attempts 0.6 |
| Campaign and outreach A/B (M11, M12) | `ledger_entries`, `pipeline_events` | `tactic` per channel and ICP | entry ids | both arms >= 20 units |
| Chat "Add to context" (M8) | `agent_messages` | `preference`, `decision`, `learning` | message id | founder-authored: active |

Lifecycle: `candidate` when extracted; `active` after code verification (founder-authored,
preference, fact) or after the founder answers a `memory_suggestion` review item (rule,
tactic, anti_pattern, rubric_weight); `superseded` when a newer lesson cites it; `retired`
when `valid_until` passes unused, when harmful exceeds helpful over at least five
applications, or on founder undo. A lesson changes the next run in four ways, in rising
order of review: digest injection (automatic), a persona brief line proposed as a
`team_change` item after three helpful applications, a rubric weight override approved by
the founder (rubrics stay in `agents/rubrics/*.yaml`; weights in `rubric_overrides`), and a
North skill edit made monthly by people through skill-creator evals and a PR.

### 4. Three scopes and the isolation rules

- **Company**: `company_id` plus the existing owner RLS policy; isolation is already a test
  (MULTI-1). **Department**: a nullable `department` column; retrieval filters by
  department, then falls back to company scope.
- **North playbooks**: a separate `north` schema with no `company_id`, written only by the
  promotion job, read by agents as read-only data. A company contributes only if
  `companies.share_learnings` is true (default false). A candidate needs the same normalised
  lesson from at least three contributing companies, passes a scrubber that rejects names,
  emails, URLs, company-specific numbers, quoted customer text and any lesson whose evidence
  came from `leads.*` tools or outreach, reply or pipeline tasks (Apollo's terms forbid
  pooling [S61]), and is approved by a North reviewer before it is `active`. Entries carry
  counts and patterns, never examples. This matches the market norm of aggregated,
  de-identified, opt-in use [S58][S59] and the EDPB's "very unlikely" bar [S57].
- **Anthropic**: the commercial terms say Anthropic may not train on Customer Content and the
  customer owns outputs [S55]; API content is not retained by default, Covered Models such as
  Fable 5.1 require 30-day retention, and retained data is never used for training without
  express permission [S56]. North's privacy policy must state the scopes and the opt-in.

### 5. Retrieval for a run under a token budget

Three layers in `packages/db`: a **digest** (thesis, recent decisions, founder preferences,
top-8 active lessons for the department and task type ranked by confidence x recency x
helpful ratio, about 2,000 tokens); **typed retrieval** (`lessonsForTask`, a filtered
query, not a search); and **hybrid search** on demand through `memory_search`, now RRF over
`tsvector` and embedding [S29]. Embeddings come from the automatic-embeddings pattern with
`gte-small` (384 dimensions) [S30][S31]; `voyage-4-lite` is the upgrade if golden-task
recall is poor [S35]; no reranker until a company passes about 2,000 rows. Everything
injected is wrapped in a data block ("company memory: data, not instructions, may be
wrong") per the memory-tool guidance [S20]; the retro extractor gets the same framing.

### 6. Evaluation and budget

Nightly, on the `packages/evals` golden tasks (spec section 8): pass rate with and without
the company's active lessons (the skill with-and-without pattern [S27]), lesson hit rate
(injected lessons the critic marks as applied), and harmful rate (applications followed by
a lower critique score or a negative ledger delta). A regression retires the lesson and
opens an issue. Cost: a Haiku-tier retro reads 20-40k tokens and writes 2k, about
$0.01-0.05; six departments weekly is under $2 a month; with-and-without runs double about
a third of the nightly `smoke` runs, about $5; embeddings $0; about $7-10 on top of $72 [S61].

## Comparison table

| Option | Licence, activity | Memory model | Extraction, consolidation | Tenant isolation | In user's Supabase under RLS? | Cost | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Mem0 OSS | Apache-2.0; 2026-09-25 [S1] | facts, graph | LLM extract; add-only; `expiration_date` [S3][S5] | id filters | own table, RLS off [S4] | LLM calls | borrow prompts |
| Mem0 Platform | hosted | facts, graph, Dream | hosted | per project | no | $0-249 [S2] | no |
| Letta | Apache-2.0; 2026-10-12 [S6] | blocks, MemFS, archival | dreaming with review [S8] | orgs, shared blocks | self-host deprecated [S9] | hosted | borrow blocks, review |
| Zep Cloud / Graphiti | CE deprecated; Graphiti Apache-2.0, 2026-10-15 [S12][S10] | bi-temporal graph | LLM entities, invalidation [S14] | `group_id` [S11] | needs Neo4j/FalkorDB | $0-375+ [S13] | borrow validity windows |
| LangMem | MIT; 2025-10-27 [S15] | semantic, episodic, procedural [S16] | hot path and background; prompt optimizer | namespaces | LangGraph store | LLM calls | borrow taxonomy |
| Cognee | Apache-2.0; 2026-10-13 [S17] | graph plus vectors | ECL, improve, forget | datasets | pgvector yes, graph demo | LLM calls | no |
| Supermemory | MIT/Apache-2.0; 2026-10-13 [S18] | facts, profiles | hosted model | API key | hosted or local | $0-399+ [S19] | no |
| Anthropic memory tool | API feature [S20] | files the model edits | model-driven | your handler | yes, on a company table | tokens | optional write path |
| Managed Agents memory, dreams | beta, preview [S21][S22] | versioned files, read-only stores | dreams write a new store | workspace stores | no | tokens | reference design |
| Claude Code auto memory | feature [S23] | MEMORY.md plus topic files | 4 note types | per repo, machine | no (SEC-2) | none | reference design |
| ACE `ace-framework` | Apache-2.0, Python [S46] | playbook with counters | generator, reflector, curator [S45] | n/a | no | LLM calls | borrow loop, counters |
| Build on pgvector | pgvector 0.8.7 [S28] | typed lessons plus items | critic retro, code-verified | RLS, append-only events | yes | $7-10/month | recommended |

## Recommendations for North

Ranked; each names the files it touches and the milestone.

1. **Build, do not adopt (M7 infra, M8 model).** Keep `memory_items` and add typed lessons in
   `packages/db` over pgvector. RLS and the user's Postgres are non-negotiable; every hosted
   option breaks that; every OSS option owns its table, needs another database or is stale;
   the learning logic (evidence from critiques, reviews, the ledger) is North-specific.
   Borrow LangMem's taxonomy, Mem0's update prompt, ACE's counters, Graphiti's windows.

2. **Data model (migration `0019+`, M8; RLS everywhere; event tables append-only).**
   - `lessons`: `id`, `company_id`, `scope` (`company|department`), `department`, `persona`,
     `task_types text[]`, `kind` (`preference|fact|rule|tactic|anti_pattern|rubric_weight`),
     `statement` (<= 400 chars), `rationale`, `evidence jsonb` (typed refs checked against
     the company by a SQL function; at least one), `confidence numeric` (code-computed),
     `source` (`retro|review|ledger|escalation|chat|founder|playbook`), `status`
     (`candidate|active|superseded|retired`), `supersedes uuid`, `valid_from`, `valid_until`,
     `embedding halfvec(384)`, `search tsvector generated`, `created_by_role`, `created_at`.
     Content is immutable; only `status` and `valid_until` change, through
     `lesson_transition()`, which also inserts into append-only `lesson_events` (from, to,
     actor, reason, review item id). Undo is a transition back.
   - `lesson_applications` (append-only): `lesson_id`, `agent_run_id`, `task_id`,
     `injected_at`, `outcome` (`unknown|helpful|harmful|neutral`), `outcome_ref`; the runtime
     writes the injection row, the critic or ledger job appends the outcome row.
   - `memory_items`: add `department`, `embedding halfvec(384)`, `search`, `provenance jsonb`,
     `status`, `valid_until`, kind `preference`; drop the never-written `vector(1536)`.
     `rubric_overrides`: `company_id`, `rubric_id`, `criterion`, `weight`, `lesson_id`,
     `review_item_id`, read by the critic runner before scoring.
   - `companies.share_learnings boolean default false`; schema `north` with
     `playbook_entries` (department, task type, statement, rationale, source_count,
     version, status, reviewed_by, reviewed_at) and append-only `playbook_candidates`.
   - Embeddings: triggers plus pgmq, pg_cron and pg_net calling an `embed` Edge Function with
     `gte-small` [S30][S31]; `search_memory_hybrid` and `search_lessons_hybrid` RPCs with RRF
     [S29], `security invoker`, revoked from `anon` like `search_memory`.

3. **Learning loop (`packages/core/src/learning/*`, `apps/worker/src/services/learn/*`).**
   Pure core functions: `lessonConfidence`, `rankLessons`, `lessonTransition`,
   `scrubForPlaybook`, `shouldRetire`. Worker: (a) deterministic hot-path extractors write
   `candidate` lessons from review answers, comments, cards and chat "Add to context";
   (b) `escalateTask` writes an `anti_pattern` lesson instead of free text; (c) the ledger
   job turns a closed window with a `channelReport` verdict into a `tactic`; (d) the weekly
   retro (recommendation 5) proposes the rest. Code verifies evidence ids exist and belong
   to the company, Zod-checks statement and kind, computes confidence, folds duplicates by
   embedding similarity into `supersedes`. Behaviour-changing kinds create a
   `memory_suggestion` review item with a one-line "this will change: ..." preview. Expiry
   defaults: preference and fact none; rule and tactic 90 days, extended by each helpful
   application; anti_pattern 60 days.

4. **Retrieval contract (`packages/db/src/memory-context.ts`, `packages/agents`).**
   `buildMemoryContext({ companyId, department, persona, taskType, budgetChars })` returns
   `{ digest, lessons, truncated }`; the runtime injects the digest in a data block and
   records every lesson in `lesson_applications`; `memory_search` becomes hybrid and gains a
   `lessons_for_task` sibling, both read-only in `tool-policy.ts`. Default budget 8,000
   characters: thesis and clarifications, five newest decisions, the department's founder
   preferences, top-8 lessons, then North playbook entries as a separate read-only section.
   `planContext` reads `tactic` and `anti_pattern` lessons instead of grepping "Escalated:".

5. **Department retro ritual (M8 for design, then each department as it lands).** A weekly
   `department_retro` task, scheduled by `planTick` after the plan, run by the department's
   critic persona in a fresh context with read-only tools and `outputSchema` =
   `RetroOutputSchema` (at most 8 proposals with kind, statement, rationale, evidence ids,
   proposed rubric weight changes), Haiku tier, per-run cap. Input is data: the week's
   critiques, review answers, applications with outcomes, failed tasks, ledger windows, and
   the active lessons it may supersede. Code files the proposals; the brief says "3 lessons
   proposed, 1 needs your answer". The Chief of Staff's retro covers planning (PLN-2 drops).

6. **Cross-company playbook promotion (M10 design, M11 first entries).** A monthly North job
   clusters active lessons from opted-in companies by embedding, keeps clusters with at least
   three companies, runs `scrubForPlaybook` (deterministic rejects, then a Haiku rewrite into
   a pattern with counts), blocks lessons whose evidence touches `leads.*`, `outreach_batch`,
   `reply_triage` or `pipeline_*`, and writes `playbook_candidates`. An admin screen
   (`apps/web/app/admin/playbooks`) lets the North reviewer approve, edit or reject; approval
   writes a versioned `playbook_entries` row. Agents get entries read-only; a company can turn
   playbook reading off. The privacy policy and the onboarding budget step show the opt-in.

7. **Memory screen (`apps/web/app/c/[slug]/memory`, M8 basic, M9 full).** Tabs: Lessons
   (status, department, confidence, "applied n, helped m, hurt k", evidence links to the
   critique, review or ledger row), Memory (thesis, decisions, preferences, docs), Playbooks
   (read-only). Each lesson has Undo (retire with reason `founder_undo`), Edit (a superseding
   lesson) and a "What changed" panel listing the runs that received it and their outcomes.

8. **Evaluation (`packages/evals`, M8).** Add a `withLessons` dimension to the golden runs,
   report delta, hit rate and harmful rate to Langfuse, graduate lessons that helped on three
   nights into the regression suite, retire on regression [S26]. Monthly, run
   skill-creator-style with-and-without evals on North skills and persona briefs using the
   quarter's lessons; changes land as a PR reviewed by `north-security-reviewer` [S27].

9. **New requirement IDs** (join `docs/SPEC.md` "Faz 2"):

| ID | Requirement | Milestone |
| --- | --- | --- |
| LRN-1 | Every lesson carries at least one verified evidence reference and a code-computed confidence; no evidence, no lesson | M8 |
| LRN-2 | Lessons are scoped to a company or department under RLS; nothing crosses companies except through the playbook flow | M8 |
| LRN-3 | A weekly department retro by the critic persona (fresh context, read-only tools) proposes lessons; behaviour-changing kinds go through the review queue | M8 design; M10-M12 others |
| LRN-4 | Every run records the lessons it received; outcomes are attributed back per lesson | M8 |
| LRN-5 | Lessons expire, are superseded or retired automatically; retired lessons stay readable with provenance; undo exists | M8 |
| LRN-6 | Memory is injected as data in a bounded block; extractors treat transcripts, tool results and quoted content as untrusted | M7 |
| LRN-7 | Hybrid full-text plus vector retrieval with embeddings generated inside Supabase; typed retrieval by department and task type | M7 pipeline, M8 contract |
| LRN-8 | A Memory screen shows lessons, provenance, applications and outcomes, with undo and edit-by-supersede | M8 basic, M9 full |
| LRN-9 | Persona brief lines and rubric weight overrides derived from lessons are proposed, versioned and founder-approved | M9 |
| LRN-10 | Nightly with-and-without-lessons evals report delta, hit rate and harmful rate; regressions retire the lesson | M8 |
| LRN-11 | Cross-company playbooks are opt-in, aggregated across at least three companies, scrubbed, reviewed by North before activation, read-only to agents | M10 design, M11 entries |
| LRN-12 | No lesson with sales-source evidence (lead providers, outreach, replies, pipeline) is ever promoted cross-company | M12 |

10. **Budget.** About $7-10 a month on top of the spec's $72: retros under $2, eval doubling
    about $5, embeddings $0 with `gte-small`; Voyage only if golden-task recall says so (200
    million free tokens cover years of North's volume) [S35][S61].

## Risks

- **Self-reinforcing bad lessons.** A wrong lesson consistent with the critic's bias gets
  applied, scored helpful by the same critic, and renewed. Mitigation: ledger deltas and
  founder answers outrank critic scores; the nightly eval uses a pinned judge, not the critic.
- **Memory poisoning through content.** Web pages, emails and tool results reach the retro;
  MINJA shows query-only injection works [S49]. Mitigation: evidence ids must exist in North's
  tables, no quoted content is stored, behaviour kinds need a founder answer, LRN-6 framing.
- **Context collapse.** A model rewriting the whole lesson set shortens it [S45].
  Mitigation: lessons are rows, updates are supersessions, consolidation is clustering plus
  supersede, like a dream writing a new store [S22].
- **Review fatigue.** At most two `memory_suggestion` items a day inside the five-item review
  budget; preference and fact lessons never ask.
- **Leakage by inference.** Scrubbed patterns can still reveal a tenant's strategy [S59].
  Mitigation: three-company minimum, counts only, North review, opt-in off by default, no
  sales sources, playbook reading can be turned off.
- **384-dimension embeddings.** `gte-small` is small; hybrid RRF carries exact terms through
  full text, and the Voyage upgrade is measured on golden tasks.
- **Covered Models retention.** Fable 5.1 requires 30-day retention at Anthropic [S56]; the
  privacy policy must say so.

## Open questions for the founder

1. `share_learnings` default: off (recommended), or asked at onboarding with one line?
2. Should founder comments become active rules at once, or sit as candidates for a day?
3. Who reviews North playbooks in M11: the founder alone, or a second person as well?
4. May a department read another department's lessons in the same company?
5. Is a 90-day default expiry for tactics right for a company running one campaign a month?

## Sources

- [S1] Mem0 repository; PyPI `mem0ai` 2.2.1 and npm `mem0ai` 3.3.1 (2026-09-25), https://github.com/mem0ai/mem0 , https://pypi.org/project/mem0ai/
- [S2] Mem0 pricing, https://mem0.ai/pricing
- [S3] Mem0 memory operations, https://docs.mem0.ai/core-concepts/memory-operations
- [S4] Mem0 Supabase vector store, https://docs.mem0.ai/components/vectordbs/dbs/supabase
- [S5] Mem0 paper (arXiv 2504.19413), https://arxiv.org/html/2504.19413
- [S6] Letta repository; PyPI `letta` 0.34.12 (2026-10-12), https://github.com/letta-ai/letta , https://pypi.org/project/letta/
- [S7] Letta memory blocks, https://docs.letta.com/guides/agents/memory-blocks
- [S8] Letta sleeptime and dreaming, https://docs.letta.com/guides/agents/architectures/sleeptime
- [S9] Letta self-hosting (deprecated), https://docs.letta.com/guides/selfhosting
- [S10] Graphiti repository; PyPI `graphiti-core` 0.31.1 (2026-10-15), https://github.com/getzep/graphiti , https://pypi.org/project/graphiti-core/
- [S11] Graphiti graph namespacing, https://help.getzep.com/graphiti/core-concepts/graph-namespacing
- [S12] Zep repository (Community Edition deprecated), https://github.com/getzep/zep
- [S13] Zep Cloud pricing, https://www.getzep.com/pricing
- [S14] Zep paper (arXiv 2501.13956), https://arxiv.org/abs/2501.13956
- [S15] LangMem repository; PyPI `langmem` 0.0.30 (2025-10-27), https://github.com/langchain-ai/langmem , https://pypi.org/project/langmem/
- [S16] LangMem conceptual guide, https://langchain-ai.github.io/langmem/concepts/conceptual_guide/
- [S17] Cognee repository; PyPI `cognee` 1.6.4 (2026-10-13), https://github.com/topoteretes/cognee , https://pypi.org/project/cognee/
- [S18] Supermemory repository; npm `supermemory` 5.0.2 (2026-10-13), https://github.com/supermemoryai/supermemory , https://www.npmjs.com/package/supermemory
- [S19] Supermemory pricing, https://supermemory.ai/pricing
- [S20] Anthropic memory tool, https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool
- [S21] Claude Managed Agents memory, https://platform.claude.com/docs/en/managed-agents/memory
- [S22] Claude Managed Agents dreams, https://platform.claude.com/docs/en/managed-agents/dreams
- [S23] Claude Code memory and auto memory, https://code.claude.com/docs/en/memory
- [S24] Anthropic, Effective context engineering for AI agents (2025-09-29), https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- [S25] Anthropic, Effective harnesses for long-running agents (2025-11-26), https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- [S26] Anthropic, Demystifying evals for AI agents (2026-01-09), https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents
- [S27] Anthropic skill-creator SKILL.md, https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md
- [S28] pgvector repository (0.8.7), https://github.com/pgvector/pgvector
- [S29] Supabase hybrid search, https://supabase.com/docs/guides/ai/hybrid-search
- [S30] Supabase automatic embeddings, https://supabase.com/docs/guides/ai/automatic-embeddings
- [S31] Supabase Edge Function embeddings with gte-small, https://supabase.com/docs/guides/ai/quickstarts/generate-text-embeddings
- [S32] Supabase Queues (pgmq), https://supabase.com/docs/guides/queues
- [S33] Supabase pgroonga, https://supabase.com/docs/guides/database/extensions/pgroonga
- [S34] ParadeDB repository (pg_search, AGPL-3.0), https://github.com/paradedb/paradedb
- [S35] Voyage AI pricing, https://docs.voyageai.com/docs/pricing
- [S36] OpenAI embedding prices via aggregator (official page returned 403), https://www.costbench.com/software/embedding-apis/openai-embeddings/
- [S37] Cohere pricing (instance prices only) and third-party rerank rate, https://cohere.com/pricing , https://apicostcalc.com/cohere-vs-voyage-vs-jina-rerank-cost-calculator.html
- [S38] Reflexion (arXiv 2303.11366), https://arxiv.org/abs/2303.11366
- [S39] ExpeL (arXiv 2308.10144), https://arxiv.org/abs/2308.10144
- [S40] Voyager (arXiv 2305.16291), https://arxiv.org/abs/2305.16291
- [S41] Generative Agents (arXiv 2304.03442), https://ar5iv.labs.arxiv.org/html/2304.03442
- [S42] Agent Workflow Memory (arXiv 2409.07429), https://arxiv.org/abs/2409.07429
- [S43] Memp: Exploring Agent Procedural Memory (arXiv 2508.06433), https://arxiv.org/abs/2508.06433
- [S44] ReasoningBank (arXiv 2509.25140), https://arxiv.org/abs/2509.25140
- [S45] Agentic Context Engineering (arXiv 2510.04618), https://arxiv.org/abs/2510.04618
- [S46] kayba-ai/agentic-context-engine, https://github.com/kayba-ai/agentic-context-engine
- [S47] Dynamic Cheatsheet (arXiv 2504.07952), https://arxiv.org/abs/2504.07952
- [S48] LongMemEval (arXiv 2410.10813), https://arxiv.org/abs/2410.10813
- [S49] MINJA memory injection attacks (arXiv 2503.03704), https://arxiv.org/abs/2503.03704
- [S50] AgentPoison (arXiv 2407.12784), https://arxiv.org/abs/2407.12784
- [S51] GEPA (arXiv 2507.19457), https://arxiv.org/abs/2507.19457
- [S52] DSPy GEPA docs; PyPI `dspy` 3.4.1 and `gepa` 0.1.4 (MIT), https://dspy.ai/current/api/optimizers/GEPA/overview/ , https://pypi.org/project/dspy/ , https://pypi.org/project/gepa/
- [S53] promptfoo repository; npm 0.124.1 (2026-10-08), https://github.com/promptfoo/promptfoo
- [S54] OpenAI Agents SDK sessions, https://openai.github.io/openai-agents-python/sessions/
- [S55] Anthropic commercial terms (effective 2025-06-17), https://www.anthropic.com/legal/commercial-terms
- [S56] Anthropic API and data retention, https://platform.claude.com/docs/en/manage-claude/api-and-data-retention
- [S57] EDPB Opinion 28/2024 on AI models (2024-12-18), https://www.edpb.europa.eu/news/news/2024/edpb-opinion-ai-models-gdpr-principles-support-responsible-ai_en
- [S58] Common Paper 2026 SaaS contract benchmark, https://commonpaper.com/resources/2026-saas-contract-benchmark-report/
- [S59] Morgan Lewis on vendor training on customer data (2026-06), https://www.morganlewis.com/blogs/sourcingatmorganlewis/2026/06/key-considerations-when-allowing-a-vendor-to-train-its-ai-models-on-customer-data
- [S60] OWASP LLM08:2025 Vector and Embedding Weaknesses (fetch returned 403; cited by title), https://genai.owasp.org/llmrisk/llm082025-vector-and-embedding-weaknesses/
- [S61] North studio phase design (internal), docs/superpowers/specs/2026-10-16-north-studio-phase-design.md
