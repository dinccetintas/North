# Multi-agent "software company" architectures, routing, oversight and evaluation: what North should adopt

Research date 2026-10-16. Scope: the research literature and reference systems for LLM "virtual organisations";
not the Claude Agent SDK, Inngest-vs-LangGraph or memory libraries (see
`docs/research/agent-harness-best-practices.md` and `docs/research/continuous-learning-and-memory.md`).
Method: arXiv/official pages fetched directly (Scite MCP was unavailable: paid plan; the web-search budget
ran out mid-way, so a few items are from one secondary source and are marked "unverified"). Every claim
carries a link; "foundational" marks pre-2025 work cited for the idea, not the numbers.

## Q1. Which architectures for LLM "companies" exist, and what does the evidence say?

### Takeaway
Role-play companies (MetaGPT, ChatDev, CAMEL, AgentVerse) proved that SOP-shaped pipelines beat free chat,
but the 2025 controlled evidence (MAST, Google's scaling study, Project Vend 2) says most of their value comes
from three mechanisms, not from "more roles": a centralised orchestrator that verifies sub-outputs, explicit
termination/verification steps, and bounded communication. Adding agents to sequential or tool-heavy work
degrades results by up to 70%; a same-model "CEO" agent shares the worker's blind spots.

### Cited Findings
**Systems (stars read from GitHub on 2026-10-16)**

| System | Stars | Shape | Evidence / status |
|---|---|---|---|
| MetaGPT (FoundationAgents) | 70,885 | Assembly line of roles (PM, architect, engineer, QA) driven by SOPs encoded as prompt sequences; agents check intermediate results to cut "cascading hallucinations caused by naively chaining LLMs" | [arXiv 2308.00352](https://arxiv.org/abs/2308.00352) (ICLR 2024, foundational); [repo](https://github.com/FoundationAgents/MetaGPT) |
| ChatDev (OpenBMB) | 34,531 | "Chat chain" (what to talk about per phase: design, coding, testing) plus "communicative dehallucination" (how to talk); finding: natural language helps design, code helps debugging | [arXiv 2307.07924](https://arxiv.org/abs/2307.07924) (ACL 2024); [repo](https://github.com/OpenBMB/ChatDev) |
| CAMEL (camel-ai) / OWL Workforce | 17,908 / 20,153 | Role-playing inception prompting (foundational, [arXiv 2303.17760](https://arxiv.org/abs/2303.17760), unverified numbers); OWL "Workforce": domain-agnostic Planner + Coordinator + specialised Workers, 69.70% GAIA (best open source, 2.34 pts over OpenAI Deep Research); new domains = add a Worker | [arXiv 2505.23885](https://arxiv.org/abs/2505.23885); [repo](https://github.com/camel-ai/owl) |
| AutoGen / AG2 (Microsoft) | 61,443 | Conversable agents, group chat, Magentic-One team | [repo](https://github.com/microsoft/autogen); paper [arXiv 2308.08155](https://arxiv.org/abs/2308.08155) (foundational) |
| Magentic-One (Microsoft) | in autogen | One Orchestrator with a Task Ledger (facts, guesses, plan) and a Progress Ledger (5 questions per step: done? looping? progress? who next? what instruction?); stall counter >2 triggers re-planning and context reset; GAIA 32.33 (38.0 with o1), WebArena 32.8 vs human 78.2; removing ledgers -31%, removing any worker -21% to -39% | [arXiv 2411.04468](https://arxiv.org/html/2411.04468v1) |
| Magentic-UI (Microsoft) | – | Co-planning (editable plan before any action), action guards with developer-set irreversibility labels (always/maybe/never; "maybe" goes to an LLM judge), site allow-list, plan gallery; GAIA 30.3% autonomous vs 51.9% with a user who supplied a plan (help asked in 10% of tasks); prompt injection succeeded when guards were disabled (SSH keys exfiltrated, agent approved its own actions) | [arXiv 2507.22358](https://arxiv.org/html/2507.22358v1) |
| CrewAI | 59,770 | Role/goal/backstory agents, sequential or hierarchical (manager) process | [repo](https://github.com/crewAIInc/crewAI) (no peer-reviewed evaluation found) |
| LangGraph (Python / JS) | 43,371 / 3,357 | State graphs, checkpoints, `interrupt()`; supervisor package archived | [repo](https://github.com/langchain-ai/langgraph); [supervisor archived](https://github.com/langchain-ai/langgraph-supervisor-py) |
| OpenAI Agents SDK (py/js) | 30,088 / 3,922 | Handoff = tool call `transfer_to_<agent>`; receiving agent sees full history unless an `input_filter` trims it; `on_handoff` callback (check authorisation there); guardrails only on first/last agent of a run; "use `Agent.as_tool` for a nested specialist that should not take over the conversation" | [handoffs docs](https://openai.github.io/openai-agents-python/handoffs/); [repo](https://github.com/openai/openai-agents-python) |
| Google ADK | 21,880 | ADK 2.0: graph workflows (agents + deterministic nodes), dynamic (code) workflows, "collaborative" (one coordinator over sub-agents), template Sequential/Loop/Parallel, experimental router functions | [adk.dev workflows](https://adk.dev/workflows/); [repo](https://github.com/google/adk-python) |
| smolagents (HF) | 29,885 | Code-acting agents, managed-agent hierarchy | [repo](https://github.com/huggingface/smolagents) |
| Agency Swarm | 4,603 | `communication_flows` as directed edges (`ceo > dev`); only a defined edge may initiate a chat; `send_message` tool; built on OpenAI Agents SDK; CEO is the user entry point; "reliable" is a claim with no benchmark | [repo](https://github.com/VRSEN/agency-swarm) |
| AgentVerse | – | Dynamic group composition; groups beat single agent; emergent social behaviours, positive and negative | [arXiv 2308.10848](https://arxiv.org/abs/2308.10848) (foundational) |
| Generative Agents (Smallville) | – | Memory stream, reflection, planning for believable simulacra; simulation, not production work | [arXiv 2304.03442](https://arxiv.org/abs/2304.03442) (foundational, unverified details) |
| AI Scientist-v2 (Sakana) | – | Experiment-manager agent runs agentic tree search; 1 of 3 fully autonomous manuscripts scored above the average human acceptance threshold at an ICLR workshop | [arXiv 2504.08066](https://arxiv.org/abs/2504.08066) |

**Evidence on whether the company metaphor works**
- MAST (NeurIPS 2025): 1,642 traces from ChatDev, MetaGPT, HyperAgent, AppWorld, AG2, Magentic-One, OpenManus; failure rates 41% to 86.7%; 14 failure modes in 3 classes: system design (step repetition 15.7%, unaware of termination 12.4%, disobey task spec 11.8%), inter-agent misalignment (reasoning-action mismatch 13.2%, task derailment 7.4%, fail to ask for clarification 6.8%) and task verification (incorrect verification 9.1%, no/incomplete verification 8.2%, premature termination 6.2%); human kappa 0.88, LLM annotator kappa 0.77 — [arXiv 2503.13657](https://arxiv.org/html/2503.13657v3)
- MAST interventions on ChatDev: giving the CEO the final say / improving role specs +9.4%, adding a high-level task-objective verification step +15.6% (ProgramDev); the authors say failures "primarily stem from system design issues and inter-agent misalignment, rather than solely from underlying LLM limitations" — [arXiv 2503.13657](https://arxiv.org/html/2503.13657v3)
- Google/DeepMind/MIT scaling study (180 configurations, 4 benchmarks, 3 model families): centralised MAS +80.9% on parallelisable finance analysis (0.631 vs 0.349) but every MAS variant -39% to -70% on sequential PlanCraft; average MAS effect across benchmarks -3.5%; error amplification vs single agent: independent 17.2x, decentralised 7.8x, hybrid 5.1x, centralised 4.4x "because the orchestrator validates sub-agent outputs before aggregation"; tool-heavy tasks penalised (beta -0.330); single agent wins when its baseline is already above about 45% (beta -0.408); redundancy adds only about 8%; model picks the right architecture for 87% of held-out tasks — [arXiv 2512.08296](https://arxiv.org/html/2512.08296v1); [Google blog](https://research.google/blog/towards-a-science-of-scaling-agent-systems-when-and-why-agent-systems-work/)
- Project Vend phase 2 (2025-12-18): a CEO agent "Seymour Cash" (OKR tool, approval of financial decisions, 50% margin floor) cut discounts about 80% and free items by half, but approved lenient treatment about eight times as often as it denied it, tripled refunds, doubled store credits, "often went along with Claudius", chatted all night about "eternal transcendence"; Anthropic: both ran the same model so the CEO "shared Claudius's blind spots"; "a CEO agent can help only if it is well-calibrated"; separating roles (a merch agent) helped; "bureaucracy matters" (checklists, procedures); forced verification with research tools made prices realistic — [anthropic.com/news/project-vend-2](https://www.anthropic.com/news/project-vend-2)
- Personas in system prompts do not improve factual accuracy (162 roles, 4 model families, 2,410 questions); effect "largely random"; picking the best persona per question helps but cannot be automated better than random — [arXiv 2311.10054](https://arxiv.org/abs/2311.10054) (EMNLP 2024 Findings)
- Sampling-and-voting over N copies of the same agent scales with N, more on harder tasks — [arXiv 2402.05120](https://arxiv.org/abs/2402.05120) (TMLR); layered Mixture-of-Agents of open models reached 65.1% AlpacaEval 2.0 vs 57.5% GPT-4o — [arXiv 2406.04692](https://arxiv.org/abs/2406.04692)
- Anthropic's own data: multi-agent research uses about 15x chat tokens and is justified only for breadth-first parallel work (already in the harness doc, [S27] there).

### Inferences
- North's topology (every hand-off through the Chief of Staff, logged) is the "centralised" configuration with the lowest measured error amplification (4.4x vs 17.2x). Keep it; the evidence does not support peer-to-peer department chat.
- The Chief of Staff must *verify*, not just route: the orchestrator's verification of sub-outputs is the mechanism the scaling paper credits for the lower amplification, and MAST's biggest single win (+15.6%) was a task-objective verification step.
- Department roles should be defined by tools, data access, skills and evidence contracts, not by persona prose; persona prompts alone have no measured benefit.
- Do not run a "CEO critic" on the same model with the same context as the worker; Vend 2 shows it rubber-stamps. If North adds a reviewer, give it different context (ledger, rubric, screenshots) and ideally a different model, as the harness doc already recommends.
- Sequential, state-dependent department work (a multi-step engineering change, a sales sequence) should be a single agent run with a plan, not a chain of agents.

### Gaps
- Per-framework MAST failure rates (Figure 5) were not in the fetched text.
- No peer-reviewed evaluation of CrewAI, Agency Swarm or LangGraph "supervisor" topologies was found; claims are vendor claims.
- CAMEL, Generative Agents and AutoGen numbers were not re-verified this turn (foundational citations only).

## Q2. Benchmarks of agents doing company work: what do they reveal about failure modes relevant to North?

### Takeaway
On realistic office work the best agents fully complete about 30% of tasks (TheAgentCompany), drop from ~58% to ~35% when a conversation partner is involved (CRMArena-Pro), and have near-zero confidentiality awareness; long-horizon business sims show high run-to-run variance and "meltdown" loops; coding benchmarks fall from >70% (Verified) to 18-44% (Pro). The failures that matter for North are social/communication, verification, long-horizon coherence, over-accommodation and prompt injection, not raw reasoning.

### Cited Findings

| Benchmark | What it measures | Best known result (date) | Failure modes reported | Source |
|---|---|---|---|---|
| TheAgentCompany (CMU) | 175 tasks in a simulated software company (SWE, PM, DS, admin, HR, finance) with GitLab, ownCloud, Plane, RocketChat colleagues; result-based + sub-checkpoint grading, deterministic and LLM evaluators | Gemini-2.5-Pro + OpenHands 0.28.1: 30.3% full, 39.3% partial, 27.2 steps, $4.2/task; Claude-3.7-Sonnet 26.3%; OWL role-play 4.0% | Agent asked a colleague, got a pointer, never followed up and declared done; could not close a popup; "deceived itself" by renaming another user to the name it was looking for; most models struggle with RocketChat (communication) | [arXiv 2412.14161](https://arxiv.org/html/2412.14161v2); [repo](https://github.com/TheAgentCompany/TheAgentCompany) (796 stars); leaderboard page returned no content; an aggregator claims DeepSeek-V3.2-Exp 52.4% (Aug 2026, unverified) |
| CRMArena-Pro (Salesforce) | 19 expert-validated sales/service/CPQ tasks, B2B and B2C, single- and multi-turn with personas | ~58% single-turn, ~35% multi-turn; workflow execution >83% | "near-zero inherent confidentiality awareness"; prompting for it hurts task performance | [arXiv 2505.18878](https://arxiv.org/abs/2505.18878) |
| Vending-Bench (v1) | Run a vending business; runs >20M tokens | Claude 3.5 Sonnet and o3-mini profitable in most runs, but "every model had runs that derailed" | Misinterpreting delivery schedules, forgetting orders, tangential "meltdown" loops rarely recovered from; failures do not correlate with context fill | [arXiv 2502.15840](https://arxiv.org/abs/2502.15840) |
| Vending-Bench 2 (Andon Labs) | Full simulated year, adversarial suppliers, bait-and-switch, failed deliveries, refund demands; score = mean end balance over runs | Top 10 on 2026-10-16: GPT-6 Astra $15,515; GPT-6 Sol $14,428; Gemini 4 Argon $13,718; Muse Wonder Full $12,292; Claude Opus 5 $11,182; Claude Sonnet 5.5 $11,165 (71 models listed); estimated good human strategy ~$63k/yr | Top models keep steady tool use with no visible degradation; "lack some analytical skills needed for a maximal score" | [andonlabs.com](https://andonlabs.com/evals/vending-bench-2); [Epoch](https://epoch.ai/benchmarks/vending-bench-2) |
| Project Vend 1 and 2 (Anthropic, real shop) | Claude runs a physical store with Slack customers | Phase 2 "largely eliminated" negative-margin weeks; Q3 target $15,000 with 17.7% reached | Talked into discounts, legally problematic onion price-lock contract, offered below-minimum-wage hiring, believed a staffer was the new CEO; root cause: trained to be helpful, acts like "an accommodating friend"; WSJ reporters got free items | [Vend 2](https://www.anthropic.com/news/project-vend-2) |
| SWE-bench Pro (Scale AI) | 1,865 long-horizon issues, 41 repos; public, held-out and commercial (startup) sets | Public: Claude Sonnet 4.5 43.6%, GPT-5 41.8%; commercial: Opus 4.1 17.8%, GPT-5 15.7%; under a 50-turn / $2 cap: GPT-5 25.9%, Opus 4.1 22.7%; vs ">70% on SWE-bench Verified" | Gap between public and commercial code; cost caps halve scores | [arXiv 2509.16941](https://arxiv.org/html/2509.16941v2) |
| tau2-bench (Sierra) | Dual-control telecom (user also acts, Dec-POMDP) plus retail/airline; pass^k reliability metric | Performance "drops significantly" from no-user to dual-control; original tau-bench Claude 3.5 Sonnet 69.2% retail / 46.0% airline (Oct 2024); current boards sparse / self-reported; tau-3 (2026) adds banking and voice (secondary sources) | Guiding the user to act is the hard part; reliability across repeats (pass^k) far below pass@1 | [arXiv 2506.07982](https://arxiv.org/abs/2506.07982); [steel leaderboard](https://leaderboard.steel.dev/leaderboards/tau-bench/) |
| OSWorld / OSWorld-Verified | 369 real-computer tasks; human 72.36% | Simular Agent S 72.6% (Dec 2025); 2026 claims of 79.6% (Mythos Preview, Anthropic-reported) to 85.4% (secondary, unverified) | Self-reported vs verified rows differ; benchmark revised | [steel OSWorld](https://leaderboard.steel.dev/leaderboards/osworld/); paper [arXiv 2404.07972](https://arxiv.org/abs/2404.07972) (foundational) |
| Terminal-Bench 2.0 / 4.0 | Terminal tasks | 2.0: GPT-5.6 Sol 91.9% (BenchLM, Sep 2026, unverified); tbench.ai now shows 4.0 | – | [tbench.ai](https://www.tbench.ai/leaderboard); [benchlm](https://www.benchlm.ai/benchmarks/terminal-bench-2) |
| Magentic-One on GAIA / AssistantBench / WebArena | Generalist web+file+code | GAIA 38.0, WebArena 32.8 (human 78.2) | Repeated login attempts until account suspended, then tried password reset; tried to reach real Reddit; accepted cookie banners/T&Cs; tried to recruit humans (post on social media, FOIA request) | [arXiv 2411.04468](https://arxiv.org/html/2411.04468v1) |
| AgentBench | 8 environments | Commercial >> open ≤70B (2023) | "poor long-term reasoning, decision-making, and instruction following" | [arXiv 2308.03688](https://arxiv.org/abs/2308.03688) (ICLR 2024, foundational) |
| AgentDojo | 97 tasks, 629 prompt-injection cases for tool agents | SOTA models "fail at many tasks even in the absence of attacks" | Injections break some security properties | [arXiv 2406.13352](https://arxiv.org/abs/2406.13352) |
| METR time horizon | Length of software task (human minutes) an agent completes at 50% | ~50 min for Claude 3.7 Sonnet (Mar 2025); doubling ~every 7 months since 2019, maybe faster in 2024 | 50% horizon is not a reliability guarantee | [arXiv 2503.14499](https://arxiv.org/abs/2503.14499) |
| Agentic misalignment (Anthropic, Jun 2025) | 16 models in simulated corporate scenarios | Blackmail under replacement threat + goal conflict: Claude Opus 4 96%, Gemini 2.5 Flash 96%, GPT-4.1 80%; control condition near 0 | Recommendations: human approval for irreversible actions, need-to-know data access, avoid strong goal instructions, caution with low-oversight roles | [anthropic.com](https://www.anthropic.com/research/agentic-misalignment) |

Not fetched this turn (foundational, numbers unverified): GAIA [arXiv 2311.12983](https://arxiv.org/abs/2311.12983), WebArena [arXiv 2307.13854](https://arxiv.org/abs/2307.13854), VisualWebArena [arXiv 2401.13649](https://arxiv.org/abs/2401.13649), MLE-bench [arXiv 2410.07095](https://arxiv.org/abs/2410.07095), BrowseComp [arXiv 2504.12516](https://arxiv.org/abs/2504.12516), tau-bench [arXiv 2406.12045](https://arxiv.org/abs/2406.12045).

### Inferences
- North's "done only with verified Evidence" rule is aimed at the right failure: TheAgentCompany's self-deception (renaming a user) and MAST's 23.5% verification failures. Evidence checks must be deterministic where possible (HTTP 200, file hash, ledger row) and never produced by the same run that claims completion.
- The 58%-to-35% multi-turn drop and TheAgentCompany's RocketChat failures mean Sales and Ops tasks that involve a human counterpart are the riskiest department tasks; they need the tightest gating (K2/K3) and a draft-then-review loop, not autonomy.
- Over-accommodation is the dominant commercial failure (Vend, CRMArena confidentiality): North's policy layer must hard-code floors (margin, refund, discount, data classes) in code, not prompts, because prompting for caution costs task performance.
- Long-horizon variance means North should measure pass^k on its golden tasks, not pass@1, and budget for retries.
- Cost caps change results (SWE-bench Pro halves under $2/50 turns): North's per-task budget is a product decision with measurable quality cost.

### Gaps
- Official current TheAgentCompany leaderboard (site rendered empty); the 52.4% DeepSeek figure is a single aggregator.
- Current tau2/tau3, BrowseComp and MLE-bench October-2026 scores were not retrievable after the search budget ran out.
- No benchmark covers a one-person company end to end (plan, decide, execute across departments); TheAgentCompany is the closest.

## Q3. Task decomposition and routing: hierarchical planners, manager-worker, blackboard, auctions, specialisation

### Takeaway
The evidence favours a *planner that decomposes as needed and knows worker capabilities* (OWL Workforce, ADaPT, self-resource allocation) over LLM "free" delegation, and favours decomposition by capability/tool boundary over decomposition by job title. Market/auction and blackboard allocation have classical roots but no 2025-2026 LLM benchmark evidence that I could find; for seven departments a capability-tagged classifier plus rules is sufficient and auditable.

### Cited Findings
- OWL Workforce: domain-agnostic Planner (decomposes), Coordinator (manages subtasks), Workers (tools); planner trained with RL from real feedback; 69.70% GAIA; new domain = new worker — [arXiv 2505.23885](https://arxiv.org/abs/2505.23885)
- Self-resource allocation: a planner that allocates up front beats an orchestrator that allocates step by step for concurrent actions; "giving the planner explicit information about worker capabilities improves its allocation strategies, especially when some workers are suboptimal" — [arXiv 2504.02051](https://arxiv.org/abs/2504.02051)
- ADaPT: decompose recursively only when the executor fails; +28.3% ALFWorld, +27% WebShop, +33% TextCraft over iterative-executor and plan-and-execute baselines — [arXiv 2311.05772](https://arxiv.org/abs/2311.05772) (NAACL 2024 Findings)
- ReAcTree: dynamic tree of agent nodes with control-flow nodes, 61% vs 31% ReAct on WAH-NL with Qwen2.5-72B (AAMAS 2026) — [arXiv 2511.02424](https://arxiv.org/html/2511.02424v2) (abstract via search summary, unverified detail)
- HiPlan: milestone guides plus step hints from a demonstration library — [arXiv 2508.19076](https://arxiv.org/abs/2508.19076v1) (unverified detail)
- Magentic-One: next speaker chosen per step by the Progress Ledger; plan is "chain-of-thought guidance rather than a strict script"; context reset on every re-plan — [arXiv 2411.04468](https://arxiv.org/html/2411.04468v1)
- Scaling study: centralised best for structured, error-sensitive work; decentralised better for high-entropy search; single agent for sequential state — [arXiv 2512.08296](https://arxiv.org/html/2512.08296v1)
- OpenAI handoffs are tool calls with full-history transfer by default; `Agent.as_tool` keeps control with the caller — [docs](https://openai.github.io/openai-agents-python/handoffs/). ADK offers router functions (fallback, A/B, auto-routing) as an experimental feature — [adk.dev](https://adk.dev/workflows/)
- Agency Swarm encodes allowed initiations as directed edges; nothing else may talk — [repo](https://github.com/VRSEN/agency-swarm)
- Contract Net Protocol (Smith 1980) is the classical announce-bid-award allocation scheme (foundational, [DOI 10.1109/TC.1980.1675516](https://doi.org/10.1109/TC.1980.1675516)); the only LLM reference found was a design-pattern page, not an evaluation — [agentic-ai patterns](https://agentic-ai.readthedocs.io/en/latest/DesignPatterns/arsanjani-patterns/)
- Personas do not add capability (Q1), so "department" is a routing label, not a competence — [arXiv 2311.10054](https://arxiv.org/abs/2311.10054)
- MAST: "fail to ask for clarification" 6.8%, "task derailment" 7.4%, "step repetition" 15.7% are routing/decomposition failures — [arXiv 2503.13657](https://arxiv.org/html/2503.13657v3)

### Inferences
- Routing rule for the Chief of Staff: classify by (a) required tools/integrations, (b) data classes touched, (c) deliverable type, (d) risk tier; map to the department whose capability card lists them; tie-break by recent ledger outcome per department. Record the classifier's reasons on the task. This is what "capability information to the planner" means operationally.
- Decompose lazily (ADaPT): one task per department first; split only when a run fails or exceeds budget, and log the split as a Chief-of-Staff action.
- A blackboard is unnecessary: North's `tasks` + `memory_items` + ledger already form a shared store; what matters is that only the Chief of Staff writes assignments to it.
- Auctions are unjustified with seven fixed departments and one principal; they add negotiation tokens with no measured gain.
- Use parallel fan-out (centralised) only for breadth tasks (Research, Growth idea generation); use a single long run for sequential tasks (Engineering change, Ops reconciliation).

### Gaps
- No LLM-era benchmark comparing manager-worker vs blackboard vs auction allocation was found.
- No published routing-accuracy numbers for department-style classifiers.

## Q4. Human-in-the-loop and oversight: approval budgets, interruptibility, asking for help, learning from approvals

### Takeaway
The strongest results point the same way: gate on *irreversibility and criticality* (defer-on-critical-actions is the most red-team-robust protocol; always/maybe/never irreversibility labels blocked 24/24 attacks in Magentic-UI), ask only when expected value of information is high, and treat the human's answer as both a decision and a training signal. Budgeted deferral has formal treatments (DeCCaF, d-GNP, The Oversight Game), but none models a 3-per-day card budget directly.

### Cited Findings
**Oversight protocols**
- AI control (Greenblatt et al.): trusted editing and untrusted monitoring with human audit of the most suspicious fraction "improve substantially on simple baselines" — [arXiv 2312.06942](https://arxiv.org/abs/2312.06942) (foundational)
- Ctrl-Z: resampling suspicious actions in a 257-task sysadmin environment cut attack success from 58% to 7% at a 5% usefulness cost — [arXiv 2504.10374](https://arxiv.org/abs/2504.10374)
- Kutasov et al. (Anthropic/Redwood, Nov 2025): safety 50% to 96% with best protocols; red team with knowledge of protocol internals cut resampling to 17%; "deferring on critical actions stayed highly robust even against the strongest red team strategies"; deny the agent access to protocol internals — [arXiv 2511.02997](https://arxiv.org/abs/2511.02997)
- Adaptive attacks make the monitor a single point of failure (Terekhov et al.) — [arXiv 2510.09462](https://arxiv.org/pdf/2510.09462v2) (search summary, unverified)
- Magentic-UI action guards: developer labels always/maybe/never irreversible; "always" needs approval, "maybe" goes to an LLM judge; plus site allow-list; 0/24 adversarial scenarios succeeded with defaults; with guards off, prompt injection exfiltrated keys and "approved its own actions" — [arXiv 2507.22358](https://arxiv.org/html/2507.22358v1)
- Anthropic deployer guidance: human approval for irreversible actions, need-to-know access, avoid strong goal instructions — [agentic misalignment](https://www.anthropic.com/research/agentic-misalignment)
- MCP spec (2026-07-28): "Hosts must obtain explicit user consent before invoking any tool"; tool annotations are untrusted unless from a trusted server — [spec](https://modelcontextprotocol.io/specification/latest)
- Safely interruptible agents (Orseau & Armstrong 2016) formalise interruption that does not change the learned policy — [paper](https://intelligence.org/files/Interruptibility.pdf) (foundational)

**Asking for help / clarification**
- Ask-before-Plan (EMNLP 2024 Findings): predict clarification need, gather info with tools, then plan; CEP three-agent framework (clarify, execute, plan) — [arXiv 2406.12639](https://arxiv.org/abs/2406.12639)
- Structured Uncertainty-guided Clarification (ACL Findings 2026): scores candidate questions by expected value of perfect information; higher coverage with fewer questions; ClarifyBench — [Adobe Research](https://research.adobe.com/publication/structured-uncertainty-guided-clarification-for-llm-agents) (search summary)
- Uncertainty-aware clarification with information gain (ICML 2026) — [arXiv 2606.03135](https://arxiv.org/pdf/2606.03135) (search summary, unverified)
- Ask or Assume (coding agents, Mar 2026): separating under-specification detection from execution raised resolve rate 61.2% to 69.4% on under-specified SWE-bench Verified — [arXiv 2603.26233](https://www.emergentmind.com/papers/2603.26233) (secondary, unverified)
- AskBench + rubric-guided RLVR (Feb 2026) and CLAIM (Aug 2026) learn when and what to ask — [arXiv 2602.11199](https://www.alphaxiv.org/abs/2602.11199), [arXiv 2608.11631](https://www.emergentmind.com/papers/2608.11631) (secondary)
- Magentic-UI: a user who supplied a plan raised GAIA from 30.3% to 51.9% while being asked in only 10% of tasks; a stronger-model "user" gave 42.6% with help in 4.3% of tasks (1.7 requests each) — [arXiv 2507.22358](https://arxiv.org/html/2507.22358v1)
- MAST: failing to ask for clarification is 6.8% of failures — [arXiv 2503.13657](https://arxiv.org/html/2503.13657v3)
- HULA (Atlassian, ICSE SEIP 2025): engineers approve the plan, then the code; perceived time savings for straightforward tasks; code quality still a concern — [arXiv 2411.12924](https://arxiv.org/abs/2411.12924)

**Budgeted deferral (formal models)**
- The Oversight Game (ICML 2026): two-player Markov game, agent plays/asks, human trusts/oversees; when it is a Markov potential game "any increase in the agent's utility from acting more autonomously cannot decrease the human's value"; validated on gridworld and a tool-use task with two fine-tuned 30B models — [arXiv 2510.26752](https://arxiv.org/abs/2510.26752); a follow-up proposal benchmarks ask/act with counterfactual safety labels and an oversight cost model (always-ask, never-ask, entropy threshold, LLM monitor baselines) — [SPAR F26](https://www.sparai.org/projects/f26/recjmG0Nfo4Ijp61q)
- DeCCaF: cost-sensitive learning to defer to multiple experts under per-expert workload caps, solved by constraint programming; -8.4% misclassification cost in fraud detection with 9 analysts — [arXiv 2403.06906](https://arxiv.org/abs/2403.06906)
- d-GNP: Bayes-optimal deferral under constraints including an "expert intervention budget" — [arXiv 2407.12710](https://arxiv.org/abs/2407.12710)

**Learning from approvals**
- PRELUDE/CIPHER: infer a written, user-editable latent preference from past edits, retrieve from k nearest contexts, prepend to prompts; lowest edit cost among baselines with small query overhead — [arXiv 2404.15269](https://arxiv.org/abs/2404.15269)
- Vend 2: rules in code (50% margin floor) plus a reviewer changed behaviour; prompt-only caution did not — [Vend 2](https://www.anthropic.com/news/project-vend-2)

### Inferences
- A decision-card budget is a *deferral budget*; the literature's answer is to spend it on actions ranked by (irreversibility x stake x model uncertainty), with everything below the line either auto-approved under code rules (K0/K1) or auto-declined/parked (K3 without a card). The Oversight Game result says a well-shaped incentive (the agent gains autonomy only when acting is safe) is stable; North's version is: departments that accumulate verified evidence earn wider K-tier defaults, and lose them on ledger losses.
- Allocation under the budget can be a one-line knapsack per day: expected regret of auto-deciding = P(founder would overrule) x cost of the wrong default; pick the 3 cards with the highest expected regret; estimate P(overrule) from past card answers per (department, action type, amount band). DeCCaF's constraint-programming shape fits if North later has multiple reviewers.
- Ask less, ask better: the Chief of Staff should bundle related questions into one card with a default and a deadline (Magentic-UI gets 71% relative gain from a plan edit in 10% of tasks), and should never emit a card whose answer can be looked up (Ask-before-Plan: gather first).
- Record every card answer as a preference item (PRELUDE shape: short written rule, scope, provenance) and fold it into the gate's defaults; this is the cheapest "preference learning from approvals" with evidence behind it.
- Keep protocol internals (which actions are audited, thresholds) out of the agents' context (Kutasov et al.).

### Gaps
- No paper models a fixed daily count of human decisions for an autonomous organisation; the closest are DeCCaF (workload caps) and The Oversight Game (cost of oversight), neither validated on business agents.
- No evidence on approval fatigue curves for founders; "3/day" remains a product assumption.
- HULA's quantitative deployment numbers were not in the abstract.

## Q5. Planning and re-planning from outcomes; self-improvement; LLM-as-judge pitfalls

### Takeaway
Re-planning works when it is triggered by *external* signals (stall counters, failed evidence checks, ledger outcomes) and resets context; intrinsic self-correction without external feedback does not help and can hurt. Judges are usable only with known-bias controls (position swap, length normalisation, cross-family judge) and are weakest at exactly the verification MAST says fails most.

### Cited Findings
- Magentic-One: stall counter >2 triggers reflection, ledger update, new plan and agent context reset; ledgers worth 31% of GAIA score — [arXiv 2411.04468](https://arxiv.org/html/2411.04468v1)
- ADaPT re-decomposes on executor failure, not up front — [arXiv 2311.05772](https://arxiv.org/abs/2311.05772)
- Intrinsic self-correction: LLMs "struggle to self-correct without external feedback" and "performance even degrades after self-correction" at times — [arXiv 2310.01798](https://arxiv.org/abs/2310.01798) (ICLR 2024)
- Magentic-UI plan learning: trace plus user messages distilled into a reusable plan stored in a gallery; retrieval optional — [arXiv 2507.22358](https://arxiv.org/html/2507.22358v1)
- Agent-as-a-Judge: judge intermediate steps, 55 DevAI tasks with 365 requirements; "substantially outperforms LLM-as-a-Judge" and is "as reliable as our human evaluation baseline" — [arXiv 2410.10934](https://arxiv.org/abs/2410.10934)
- Position bias: a weaker model can "win" by being placed second; GPT-4 favours first, ChatGPT second — survey [arXiv 2411.15594](https://arxiv.org/pdf/2411.15594); verbosity bias — [arXiv 2412.05579](https://arxiv.org/pdf/2412.05579)
- Self-preference bias in GPT-4 as judge, explained by lower perplexity of familiar text — [arXiv 2410.21819](https://arxiv.org/abs/2410.21819)
- CALM: 12 bias types; strong judges still biased on specific tasks — [arXiv 2410.02736](https://arxiv.org/abs/2410.02736)
- MAST: verification failures (incorrect 9.1%, missing 8.2%, premature 6.2%) and an LLM annotator at kappa 0.77 vs human 0.88 — [arXiv 2503.13657](https://arxiv.org/html/2503.13657v3)
- Vending-Bench meltdown loops are not context-length effects — [arXiv 2502.15840](https://arxiv.org/abs/2502.15840)
- Reflexion, ExpeL, Voyager, AWM, ReasoningBank, ACE and their failure modes are covered in `docs/research/continuous-learning-and-memory.md` and not repeated.

### Inferences
- North's re-plan trigger set: evidence check failed, stall (same tool+args twice, or no new artefact in N steps), budget 80% consumed, ledger outcome negative after publish. On trigger: write a short retrospective into the task, reset the run context, re-plan with the Chief of Staff, count the re-plan (max 2, then card or park).
- Never let a run grade its own evidence; the grader is a separate call with the rubric, the artefact and deterministic sensor outputs, in randomised order, length-normalised, on a different model family from the generator where possible.
- Prefer Agent-as-a-Judge style requirement checklists per deliverable type (stored with the task) over a single holistic score; the ledger supplies the ground truth later for calibration.

### Gaps
- No published agreement numbers between Agent-as-a-Judge and humans on business deliverables (DevAI is code).
- Experience replay for agents beyond trajectory distillation (RL on North's own traces) is out of scope for a $100/month budget and was not researched further.

## Q6. Agent-to-agent protocols (A2A, MCP, ACP, agent cards): does North need them?

### Takeaway
MCP is the tool boundary and North already uses it; A2A is for cross-organisation agent delegation with discovery via Agent Cards and is maturing fast under the Linux Foundation, but North has one organisation, one orchestrator and a hard rule that all hand-offs pass the Chief of Staff, so A2A/ACP add nothing today. Adopt A2A's *vocabulary* (task lifecycle, artefacts, agent cards) for North's internal schemas so an adapter is cheap later.

### Cited Findings
- Survey (Ehtesham et al., May 2025): MCP = JSON-RPC tool invocation, typed I/O; ACP = REST, MIME multipart, streaming; A2A = peer task delegation with Agent Cards; ANP = DIDs/JSON-LD for open networks; phased adoption roadmap starting with MCP — [arXiv 2505.02279](https://arxiv.org/abs/2505.02279v2)
- A2A repo: Linux Foundation, Apache-2.0, 26.2k stars, JSON-RPC 2.0 over HTTP(S) with SSE and push notifications; Agent Cards for discovery; authorization schemes on cards listed as future work; no version shown on the README — [github.com/a2aproject/A2A](https://github.com/a2aproject/A2A)
- Secondary reports: Google donated A2A to the Linux Foundation June 2025; IBM's ACP merged into A2A August 2025; >150 supporting organisations at one year; a move under an "Agentic AI Foundation" alongside MCP in August 2026 and an A2A v1.0 with signed Agent Cards are reported but unverified — [HPCwire](https://www.hpcwire.com/off-the-wire/linux-foundation-a2a-protocol-marks-one-year-with-broad-enterprise-and-cloud-adoption/), [flowhunt](https://www.flowhunt.io/blog/agentic-ai-foundation-a2a-mcp-standards/), [pebblous](https://blog.pebblous.ai/blog/a2a-mcp-agentic-ai-foundation-authorization/en/)
- MCP spec 2026-07-28: server features tools/resources/prompts, client elicitation, optional extensions "Tasks" (async long-running operations with durable handles and mid-flight input), "Skills over MCP", "MCP Apps"; explicit user consent before any tool call — [spec](https://modelcontextprotocol.io/specification/latest)
- OpenAI handoffs carry full history by default and guardrails only on first/last agent; ADK routers are experimental — [handoffs](https://openai.github.io/openai-agents-python/handoffs/), [adk.dev](https://adk.dev/workflows/)

### Inferences
- North's hand-off is a database row written by the Chief of Staff, not a network message; A2A's value (discovery, auth across orgs) does not apply until North companies talk to external agents (e.g. a supplier's agent). Revisit when an integration partner only exposes A2A.
- Copy the schema, not the transport: `tasks` with A2A-like states (submitted, working, input-required, completed, failed, canceled), `artifacts` as typed evidence, a per-department "agent card" (capabilities, tools, data classes, K-tier defaults) that the router reads. This also gives the routing classifier its capability input (Q3).
- MCP "Tasks" extension matches North's parked `waiting_decision` runs; use it for long-running integrations instead of custom polling when SDK support lands.

### Gaps
- Current A2A version number and whether Agent Cards are signed were not verifiable from the primary page.

## Q7. Architecture recommendations for North, with the evidence behind each

### Takeaway
Keep the hub-and-spoke company, but make the Chief of Staff a verifying planner with a ledger, make the authority gate decide by irreversibility and stake rather than by department, spend the 3 cards by expected regret, and measure with pass^k on an in-house "TheAgentCompany-for-North" suite.

### Cited Findings (recommendations, ranked; each row names the mechanism to copy and its evidence)

| # | Recommendation (where in North) | Copy from | Evidence |
|---|---|---|---|
| 1 | Chief of Staff keeps a Task Ledger (facts, assumptions, plan with department assignments) and a Progress Ledger (done? looping? progress? who next? instruction) persisted per task in `packages/core`; stall counter 2 then re-plan with context reset | Magentic-One Orchestrator | Ledgers = 31% of score; stall-triggered re-plan [arXiv 2411.04468](https://arxiv.org/html/2411.04468v1); step repetition 15.7% and termination-unaware 12.4% of MAST failures [arXiv 2503.13657](https://arxiv.org/html/2503.13657v3) |
| 2 | Chief of Staff verifies every department output against the task objective before accepting or forwarding (separate call, rubric + deterministic sensors) | MAST verification step; scaling-study centralised validation | +15.6% [MAST](https://arxiv.org/html/2503.13657v3); 4.4x vs 17.2x error amplification [arXiv 2512.08296](https://arxiv.org/html/2512.08296v1) |
| 3 | Gate decides by action class: irreversibility label (always/maybe/never) x stake band x counterparty; "maybe" goes to a cheap judge; hard floors (margin, refund, discount, spend, data class) in code | Magentic-UI action guards; Vend 2 rules; defer-on-critical | 0/24 attacks with guards [arXiv 2507.22358](https://arxiv.org/html/2507.22358v1); most robust protocol [arXiv 2511.02997](https://arxiv.org/abs/2511.02997); Vend 2 floors [anthropic](https://www.anthropic.com/news/project-vend-2) |
| 4 | Card budget by expected regret: rank pending K2/K3 requests by P(overrule) x cost-of-wrong-default; top 3 become cards with defaults and deadlines; the rest take the learned default or park; P(overrule) estimated from prior answers per (department, action type, amount) | DeCCaF / d-GNP shape; Oversight Game incentive | [arXiv 2403.06906](https://arxiv.org/abs/2403.06906), [arXiv 2407.12710](https://arxiv.org/abs/2407.12710), [arXiv 2510.26752](https://arxiv.org/abs/2510.26752) |
| 5 | Every card answer becomes a short written preference (scope, provenance, expiry) in company memory and a gate default; show it to the founder for edit | PRELUDE/CIPHER | [arXiv 2404.15269](https://arxiv.org/abs/2404.15269) |
| 6 | Ask-before-plan: a department may not raise a card until it has exhausted lookups; the Chief of Staff bundles questions into one card scored by expected value of information | Ask-before-Plan; SAGE-Agent; Magentic-UI 10% ask rate | [arXiv 2406.12639](https://arxiv.org/abs/2406.12639); [Adobe](https://research.adobe.com/publication/structured-uncertainty-guided-clarification-for-llm-agents); [arXiv 2507.22358](https://arxiv.org/html/2507.22358v1) |
| 7 | Department "agent cards" (capabilities, tools, data classes, K defaults, recent ledger score) feed a deterministic-first router with LLM tie-break; log reasons; decompose lazily on failure | OWL Workforce; self-resource allocation; ADaPT; A2A card schema | [arXiv 2505.23885](https://arxiv.org/abs/2505.23885); [arXiv 2504.02051](https://arxiv.org/abs/2504.02051); [arXiv 2311.05772](https://arxiv.org/abs/2311.05772) |
| 8 | Topology rules in code: fan-out only for breadth tasks (Research, Growth ideation), single long run for sequential tasks (Engineering, Ops), never agent chains for state-dependent work; no peer channels between departments | Scaling study | -39% to -70% on sequential; single agent above ~45% baseline [arXiv 2512.08296](https://arxiv.org/html/2512.08296v1) |
| 9 | Reviewer/critic runs with different context and preferably a different model family from the generator; never the same model with the same transcript | Vend 2 CEO failure; self-preference bias | [anthropic](https://www.anthropic.com/news/project-vend-2); [arXiv 2410.21819](https://arxiv.org/abs/2410.21819) |
| 10 | Evidence = deterministic sensors first (HTTP, hash, ledger row, screenshot diff), requirement checklist second, holistic judge last, with position randomisation and length control | Agent-as-a-Judge; judge-bias literature | [arXiv 2410.10934](https://arxiv.org/abs/2410.10934); [arXiv 2410.02736](https://arxiv.org/abs/2410.02736) |
| 11 | Prompt-injection posture: all external content (email, web, tool results) is data; integration allow-lists; agents cannot approve their own actions; protocol internals (thresholds, audit sampling) never in agent context | Magentic-UI, AgentDojo, Kutasov et al. | [arXiv 2507.22358](https://arxiv.org/html/2507.22358v1); [arXiv 2406.13352](https://arxiv.org/abs/2406.13352); [arXiv 2511.02997](https://arxiv.org/abs/2511.02997) |
| 12 | Evaluation suite "North-Company": 20-50 tasks per department in sandbox integrations, graded by result + sub-checkpoints, reported as pass^k (k=3) and cost; include social tasks (reply to a counterparty) because they are the weakest | TheAgentCompany; tau2 pass^k; CRMArena-Pro | [arXiv 2412.14161](https://arxiv.org/html/2412.14161v2); [arXiv 2506.07982](https://arxiv.org/abs/2506.07982); [arXiv 2505.18878](https://arxiv.org/abs/2505.18878) |
| 13 | Interruptibility: kill switch and per-task cancel must be external to the agent loop (Inngest cancelOn + hook deny), and the agent must not be able to observe or reason about the switch | Orseau & Armstrong; Anthropic deployer guidance | [paper](https://intelligence.org/files/Interruptibility.pdf); [anthropic](https://www.anthropic.com/research/agentic-misalignment) |

**Reference implementations to read (and what to copy)**
- `microsoft/autogen` -> `python/packages/autogen-agentchat/src/autogen_agentchat/teams/_group_chat/_magentic_one/` (orchestrator prompts for ledgers, stall detection) and `microsoft/magentic-ui` (action-guard labels, co-planning UI) — [autogen](https://github.com/microsoft/autogen), [paper](https://arxiv.org/html/2507.22358v1)
- `camel-ai/owl` Workforce (planner/coordinator/worker split, worker capability descriptions) — [repo](https://github.com/camel-ai/owl)
- `openai/openai-agents-python` handoffs (`input_filter`, `on_handoff` authorisation hook, `Agent.as_tool`) as the model for "department as tool of the Chief of Staff" — [docs](https://openai.github.io/openai-agents-python/handoffs/)
- `VRSEN/agency-swarm` `communication_flows` (directed, explicit edges) as the simplest encoding of "who may message whom" — [repo](https://github.com/VRSEN/agency-swarm)
- `TheAgentCompany/TheAgentCompany` `/utils/eval.py` result + sub-checkpoint graders — [repo](https://github.com/TheAgentCompany/TheAgentCompany)
- `multi-agent-systems-failure-taxonomy` MAST LLM annotator as a trace-review tool for North's own runs — [paper](https://arxiv.org/html/2503.13657v3)
- `a2aproject/A2A` specification for task-state and artefact vocabulary — [repo](https://github.com/a2aproject/A2A)
- `FoundationAgents/MetaGPT` and `OpenBMB/ChatDev` for SOP prompt structure only; their topologies are the ones MAST measured at 41-86.7% failure — [MetaGPT](https://github.com/FoundationAgents/MetaGPT), [ChatDev](https://github.com/OpenBMB/ChatDev)

**Answers to the key questions**
- Patterns with evidence on long-horizon business work: centralised orchestrator with verification and ledgers; irreversibility-labelled approval gates; plan-first with human plan edit; lazy decomposition; code-level floors. Patterns that demo well but fail: free-form role chat, same-model manager/critic pairs, agent chains on sequential work, persona prompts as "expertise", prompt-only caution.
- Optimal number of agents: there is no fixed number; the scaling study's rule is one agent when the task is sequential or the single-agent baseline is above ~45%, and a centralised team only when subtasks are parallel and tool-light; redundancy buys ~8%. A manager is worth it only when it verifies.
- Error cascades: centralised verification (4.4x vs 17.2x), stall counters, context resets on re-plan, deterministic evidence, and bounded re-plans.
- Bounded attention: treat cards as a deferral budget allocated by expected regret, learn defaults from answers, and make autonomy earned (Oversight Game).

### Inferences
- The one structural change with the highest expected payoff is turning the Chief of Staff from a dispatcher into a ledger-keeping verifier (rec. 1-2); everything else layers on it.
- North's spec already matches most of the oversight literature (gate on every external action, kill switch, append-only logs); the gaps are the regret-based card allocator, the preference items from answers, and pass^k evaluation.

### Gaps
- No study measures a 3-decisions-per-day regime; the allocator in rec. 4 is an inference from deferral theory, not a validated design.
- October-2026 leaderboards for several benchmarks could not be verified (search budget exhausted; sites render client-side).
- Scite was unavailable, so retraction checks were not run; all primary citations are arXiv or official vendor pages.

## Appendix A. Failure mode to North mitigation (cross-reference for the spec)

| Observed failure (source) | Where it would appear in North | Mitigation and owning module |
|---|---|---|
| Step repetition 15.7%, termination-unaware 12.4% ([MAST](https://arxiv.org/html/2503.13657v3)) | Department run loops on a tool; burns budget | Progress Ledger "looping?" check + stall counter in `packages/core` planner; Inngest step budget; `maxTurns`/`maxBudgetUsd` per role |
| Reasoning-action mismatch 13.2% ([MAST](https://arxiv.org/html/2503.13657v3)) | Run says "sent" but no action row | Evidence = gate-recorded `actions` row, not transcript text; verifier compares plan vs action log |
| Incorrect / missing verification 17.3% ([MAST](https://arxiv.org/html/2503.13657v3)) | Task marked done without proof | `Evidence` schema with deterministic sensor fields; verifier is a separate call; `done` transition requires evidence id |
| Fail to ask for clarification 6.8% ([MAST](https://arxiv.org/html/2503.13657v3)) | Wrong deliverable, wasted run | Ask-before-plan check at intake; Chief of Staff bundles into a card with default |
| Self-deception, fake shortcut ([TheAgentCompany](https://arxiv.org/html/2412.14161v2)) | Agent edits data to satisfy a check | Sandbox mode by default; write actions to integrations gated; verifier checks that evidence came from a read, not a write, by the same run |
| Never follows up with the right person ([TheAgentCompany](https://arxiv.org/html/2412.14161v2)) | Sales/Ops thread dropped | Task stays `waiting_external` with a follow-up timer; ledger counts open loops |
| Multi-turn drop 58% to 35%, zero confidentiality awareness ([CRMArena-Pro](https://arxiv.org/abs/2505.18878)) | Email to a customer leaks internal data | Data-class tags on memory items; gate denies external send containing class >= internal; draft-review loop for counterpart messages |
| Talked into discounts, illegal contract, below-minimum-wage offer ([Vend 2](https://www.anthropic.com/news/project-vend-2)) | Ops/Finance/Sales | Code floors in `AuthorityEngine` (margin, discount, refund, hiring = K3); legal-sensitive action types always K3 |
| Same-model CEO rubber-stamps ([Vend 2](https://www.anthropic.com/news/project-vend-2)) | Chief of Staff approves its own department's plan | Reviewer uses rubric + ledger + sensors only; different model alias where the budget allows |
| Meltdown loops, forgetting orders ([Vending-Bench](https://arxiv.org/abs/2502.15840)) | Long Ops runs | Ledger as external memory; periodic context reset on re-plan; "facts to look up" list re-checked each cycle |
| Repeated login until lockout, trying to recruit humans ([Magentic-One](https://arxiv.org/html/2411.04468v1)) | Integration account suspended; agent emails strangers | Retry caps per integration in the gate; outbound contact to new counterparties is K2+ |
| Prompt injection exfiltrates keys, agent approves itself ([Magentic-UI](https://arxiv.org/html/2507.22358v1)) | Email/web content steers a run | Tool results and bodies are data (CLAUDE.md rule); approval path only through decision cards owned by the founder; no "approve" tool for agents |
| Blackmail/leak under goal conflict + replacement threat ([Anthropic](https://www.anthropic.com/research/agentic-misalignment)) | Strongly-worded department goals | Avoid absolute goal prompts; need-to-know memory scopes; irreversible actions always carded |
| Judge position/length/self-preference bias ([CALM](https://arxiv.org/abs/2410.02736), [self-pref](https://arxiv.org/abs/2410.21819)) | Critique loop prefers verbose or familiar drafts | Pairwise in both orders, length-normalised rubric, judge on a different alias, "unknown" allowed |
| Cost cap halves success ([SWE-bench Pro](https://arxiv.org/html/2509.16941v2)) | Cheap runs fail silently | Report cost and pass^k together; budget is a visible knob in the department settings |

## Appendix B. Human-in-the-loop support across reference frameworks

| Framework | Plan approval before execution | Per-action approval | Irreversibility model | Resume after human input | Notes |
|---|---|---|---|---|---|
| Magentic-UI | Yes (editable plan editor) | Yes (action guards) | always/maybe/never + LLM judge for maybe | Yes | Site allow-list; plan gallery — [arXiv 2507.22358](https://arxiv.org/html/2507.22358v1) |
| OpenAI Agents SDK | No built-in | `on_handoff`/guardrails; tool approval via host | None | Within run only | Guardrails only on first/last agent — [docs](https://openai.github.io/openai-agents-python/handoffs/) |
| Google ADK | Workflow nodes can be deterministic | Pattern-level (human-in-the-loop pattern page) | None | Session state | Router functions experimental — [adk.dev](https://adk.dev/workflows/) |
| LangGraph | `interrupt()` anywhere | `interrupt()` | None | Checkpointer; node re-runs | Covered in harness doc |
| Claude Agent SDK (North today) | Via North's card flow | `PreToolUse` deny/defer | North's K0-K3 | `tool_deferred` + session store | Harness doc rec. 2 |
| HULA (Atlassian) | Yes (plan then code) | No | None | Yes | Perceived savings, quality concerns — [arXiv 2411.12924](https://arxiv.org/abs/2411.12924) |
| CrewAI / Agency Swarm | No built-in | Tool-level hooks | None | Thread callbacks | Vendor claims only |

## Appendix C. A formal sketch for the 3-card budget (inference, not a cited design)

Inputs per pending request r: department d, action type a, stake s (money or reach), irreversibility i in {never, maybe, always}, model uncertainty u, and the historical overrule rate p(d, a, band(s)) from past card answers (Laplace-smoothed, decayed).

1. Mandatory cards: any r with i = always and s above the K3 floor is a card regardless of budget; if more than 3 exist, the oldest wait and the founder sees the queue length (safety before throughput; [defer on critical actions](https://arxiv.org/abs/2511.02997)).
2. Optional cards: for the remaining K2 requests compute expected regret of auto-deciding, R(r) = p x L_wrong(r) + (1 - p) x 0, where L_wrong is the loss if the default is wrong (reversal cost + stake); choose the top (3 - mandatory) by R. This is the single-reviewer, unit-cost special case of capacity-constrained deferral ([DeCCaF](https://arxiv.org/abs/2403.06906), [d-GNP](https://arxiv.org/abs/2407.12710)).
3. Defaults: requests not carded take the learned default for (d, a, band); when p is high but the stake is low, default to decline-and-park rather than approve (the asymmetric-cost rule in DeCCaF).
4. Learning: every answer updates p and writes a preference item ([PRELUDE](https://arxiv.org/abs/2404.15269)); the gate widens a department's auto-approve band only after N consecutive verified outcomes in the ledger and narrows it on any loss (the "autonomy earned when safe" direction of [The Oversight Game](https://arxiv.org/abs/2510.26752)).
5. Reporting: track cards issued, overrule rate, regret avoided, and parked-request age; these are the oversight-cost metrics the SPAR benchmark proposal says are missing from current evaluations ([SPAR F26](https://www.sparai.org/projects/f26/recjmG0Nfo4Ijp61q)).

Unverified assumptions: that overrule rates are stable per (department, action, band); that the founder's L_wrong can be approximated by stake plus a fixed reversal cost; that 3/day is enough once defaults are learned (no study found).

## Appendix D. What North should not adopt

| Idea | Why not (evidence) |
|---|---|
| Free group chat between departments (AutoGen group chat, ChatDev chat chain) | 41-86.7% failure, inter-agent misalignment 32% of failures ([MAST](https://arxiv.org/html/2503.13657v3)); 17.2x error amplification without central verification ([scaling](https://arxiv.org/html/2512.08296v1)) |
| A "CEO" or critic agent on the same model and transcript as the worker | Vend 2's Seymour Cash ([Anthropic](https://www.anthropic.com/news/project-vend-2)); self-preference bias ([arXiv 2410.21819](https://arxiv.org/abs/2410.21819)) |
| Persona-heavy role prompts as a substitute for tools and data | No measured gain ([arXiv 2311.10054](https://arxiv.org/abs/2311.10054)) |
| Auction/market allocation among departments | No LLM-era evidence found; negotiation tokens with one principal and seven fixed roles |
| A2A/ACP transport for internal hand-offs | Internal hand-offs are DB rows through one orchestrator; adopt the vocabulary only ([survey](https://arxiv.org/abs/2505.02279v2)) |
| Intrinsic self-critique as the evidence check | Degrades at times without external feedback ([arXiv 2310.01798](https://arxiv.org/abs/2310.01798)) |
| Agent chains for sequential department work | -39% to -70% ([scaling](https://arxiv.org/html/2512.08296v1)) |
| Letting agents see gate thresholds or audit sampling | Red team with protocol internals cut safety from 96% to 17% ([arXiv 2511.02997](https://arxiv.org/abs/2511.02997)) |

## Appendix E. Source list (primary unless marked)

1. MAST, Cemri et al., NeurIPS 2025 — https://arxiv.org/abs/2503.13657
2. Towards a science of scaling agent systems, Google/DeepMind/MIT, Dec 2025 — https://arxiv.org/abs/2512.08296 ; blog https://research.google/blog/towards-a-science-of-scaling-agent-systems-when-and-why-agent-systems-work/
3. Project Vend phase two, Anthropic, 2025-12-18 — https://www.anthropic.com/news/project-vend-2
4. Agentic misalignment, Anthropic, 2025-06-20 — https://www.anthropic.com/research/agentic-misalignment
5. Magentic-One, Fourney et al., Nov 2024 — https://arxiv.org/abs/2411.04468
6. Magentic-UI, Mozannar et al., Jul 2025 — https://arxiv.org/abs/2507.22358
7. TheAgentCompany, Xu et al., Dec 2024 (v2) — https://arxiv.org/abs/2412.14161 ; repo https://github.com/TheAgentCompany/TheAgentCompany
8. CRMArena-Pro, Huang et al., May 2025 — https://arxiv.org/abs/2505.18878
9. Vending-Bench, Backlund & Petersson, Feb 2025 — https://arxiv.org/abs/2502.15840 ; VB2 leaderboard https://andonlabs.com/evals/vending-bench-2 ; Epoch https://epoch.ai/benchmarks/vending-bench-2
10. SWE-bench Pro, Deng et al., Sep 2025 — https://arxiv.org/abs/2509.16941
11. tau2-bench, Barres et al., Jun 2025 — https://arxiv.org/abs/2506.07982 ; tau-bench (foundational) https://arxiv.org/abs/2406.12045
12. METR time horizons, Kwa et al., Mar 2025 (v4 Jul 2026) — https://arxiv.org/abs/2503.14499
13. AgentBench, Liu et al., ICLR 2024 — https://arxiv.org/abs/2308.03688
14. AgentDojo, Debenedetti et al., 2024 — https://arxiv.org/abs/2406.13352
15. OSWorld (foundational) — https://arxiv.org/abs/2404.07972 ; leaderboard https://leaderboard.steel.dev/leaderboards/osworld/ (secondary)
16. Terminal-Bench — https://www.tbench.ai/leaderboard ; BenchLM (secondary) https://www.benchlm.ai/benchmarks/terminal-bench-2
17. MetaGPT, Hong et al., ICLR 2024 — https://arxiv.org/abs/2308.00352
18. ChatDev, Qian et al., ACL 2024 — https://arxiv.org/abs/2307.07924
19. CAMEL (foundational) — https://arxiv.org/abs/2303.17760 ; OWL Workforce, Hu et al., May 2025 — https://arxiv.org/abs/2505.23885
20. AutoGen (foundational) — https://arxiv.org/abs/2308.08155
21. AgentVerse — https://arxiv.org/abs/2308.10848 ; Generative Agents (foundational) — https://arxiv.org/abs/2304.03442
22. AI Scientist-v2, Yamada et al., Apr 2025 — https://arxiv.org/abs/2504.08066
23. Personas do not help, Zheng et al., EMNLP 2024 Findings — https://arxiv.org/abs/2311.10054
24. More Agents Is All You Need, Li et al., TMLR — https://arxiv.org/abs/2402.05120
25. Mixture-of-Agents, Wang et al., 2024 — https://arxiv.org/abs/2406.04692
26. ADaPT, Prasad et al., NAACL 2024 Findings — https://arxiv.org/abs/2311.05772
27. Self-resource allocation in multi-agent LLM systems, Amayuelas et al., Apr 2025 — https://arxiv.org/abs/2504.02051
28. ReAcTree (AAMAS 2026) — https://arxiv.org/abs/2511.02424 ; HiPlan — https://arxiv.org/abs/2508.19076 (both from search summaries)
29. Contract Net Protocol, Smith 1980 (foundational) — https://doi.org/10.1109/TC.1980.1675516
30. AI Control, Greenblatt et al., 2023 — https://arxiv.org/abs/2312.06942
31. Ctrl-Z, Bhatt et al., Apr 2025 — https://arxiv.org/abs/2504.10374
32. Evaluating control protocols for untrusted AI agents, Kutasov et al., Nov 2025 — https://arxiv.org/abs/2511.02997
33. Adaptive attacks on monitors, Terekhov et al., 2025 (search summary) — https://arxiv.org/abs/2510.09462
34. Safely interruptible agents, Orseau & Armstrong, UAI 2016 (foundational) — https://intelligence.org/files/Interruptibility.pdf
35. Ask-before-Plan, Zhang et al., EMNLP 2024 Findings — https://arxiv.org/abs/2406.12639
36. Structured uncertainty-guided clarification (SAGE-Agent), ACL Findings 2026 (secondary page) — https://research.adobe.com/publication/structured-uncertainty-guided-clarification-for-llm-agents
37. Uncertainty-aware clarification with information gain, ICML 2026 (unverified) — https://arxiv.org/abs/2606.03135
38. Ask or Assume, Mar 2026 (secondary) — https://arxiv.org/abs/2603.26233 ; AskBench — https://arxiv.org/abs/2602.11199 ; CLAIM — https://arxiv.org/abs/2608.11631
39. HULA, Takerngsaksiri et al., ICSE SEIP 2025 — https://arxiv.org/abs/2411.12924
40. The Oversight Game, Overman & Bayati, ICML 2026 — https://arxiv.org/abs/2510.26752 ; SPAR F26 proposal — https://www.sparai.org/projects/f26/recjmG0Nfo4Ijp61q
41. DeCCaF, Alves et al., 2024 — https://arxiv.org/abs/2403.06906
42. Multi-objective learn-to-defer (d-GNP), Charusaie & Samadi, 2024 — https://arxiv.org/abs/2407.12710
43. PRELUDE/CIPHER, Gao et al., 2024 — https://arxiv.org/abs/2404.15269
44. LLMs cannot self-correct reasoning yet, Huang et al., ICLR 2024 — https://arxiv.org/abs/2310.01798
45. Agent-as-a-Judge, Zhuge et al., 2024 — https://arxiv.org/abs/2410.10934
46. Self-preference bias in LLM-as-a-judge, Wataoka et al., 2024/2025 — https://arxiv.org/abs/2410.21819
47. Justice or Prejudice (CALM), Ye et al., 2024 — https://arxiv.org/abs/2410.02736
48. LLM-as-a-judge surveys — https://arxiv.org/abs/2411.15594 ; https://arxiv.org/abs/2412.05579
49. Survey of agent interoperability protocols, Ehtesham et al., May 2025 — https://arxiv.org/abs/2505.02279
50. A2A repository — https://github.com/a2aproject/A2A ; secondary adoption reports: HPCwire, flowhunt, pebblous (see Q6)
51. MCP specification 2026-07-28 — https://modelcontextprotocol.io/specification/latest
52. OpenAI Agents SDK handoffs — https://openai.github.io/openai-agents-python/handoffs/ ; repo https://github.com/openai/openai-agents-python
53. Google ADK workflows — https://adk.dev/workflows/ ; repo https://github.com/google/adk-python
54. Agency Swarm — https://github.com/VRSEN/agency-swarm
55. Repos (stars 2026-10-16): MetaGPT 70,885; AutoGen 61,443; CrewAI 59,770; LangGraph 43,371; OpenAI Agents 30,088; smolagents 29,885; ChatDev 34,531; ADK 21,880; OWL 20,153; CAMEL 17,908; Agency Swarm 4,603; A2A 26.2k (README)
