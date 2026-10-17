# Market landscape and vertical playbook research (2026-10-16)

Second research pass for North, run on the `research/market-landscape-playbooks` branch.
The first pass (`docs/research/dept-*.md`, `startup-playbook-and-journey.md`,
`agent-harness-best-practices.md`, ...) answered "which tools and APIs does each department
need". This pass answers four different questions:

1. Which companies already do AI marketing, sales, engineering, design, operations and
   whole-company automation well, how do they turn a founder's request into an outcome, and
   which of their features should North adopt?
2. How should North's connector layer be built so agents have the right tools for every
   business's stack (Gmail, Figma, Shopify, Notion, ...)?
3. How must the team, workflows and playbook differ by startup type (dropshipping, SaaS,
   devtool, newsletter, agency, app, local business, ...), and how does North route an idea to
   the right playbook?
4. What do the research literature and reference systems say about the right multi-agent
   architecture, task routing and human-in-the-loop budget?

## Read in this order

| File | What it holds | Use it for |
| --- | --- | --- |
| `00-synthesis-and-backlog.md` | Turkish executive summary, English synthesis, a 42-item prioritised backlog (tiers A/B/C mapped to M7-M9, M10-M12 and proposed M14-M16), patterns to avoid, open founder decisions | Defining new features and the next roadmap |
| `01-ai-marketing-platforms.md` | 30 marketing products: workflow, features, pricing, agentic vs assistive, guardrails; 12 features to adopt | Growth department features |
| `02-ai-sales-platforms.md` | 24 AI SDR / GTM products; the `Play` record idea; founder-led first 30 days; 12 features to adopt | Sales department features |
| `03-ai-engineering-products.md` | Lovable, Bolt, v0, Replit, Devin, Cursor, Codex, Claude Code and others: plan modes, checkpoints, preview comments, quality gates, failure modes | Engineering department and build UX |
| `04-ai-design-brand-products.md` | Claude Design, Figma Make, Canva, Pomelli, Looka, Recraft and others: brand kit as data, critique encoding, variant review UX | Design department and brand kit |
| `05-ai-company-and-ops-platforms.md` | Polsia, Lindy, Relevance, Dust, Manus, Managed Agents, Agentforce, Zapier Agents; support, finance, research and analytics agents; playbook/skill formats; positioning map | Chief of Staff, Ops/Finance, positioning |
| `06-connectors-and-integration-layer.md` | Composio, Nango, Paragon, Pipedream, Arcade, Zapier MCP and the MCP ecosystem; tool selection at scale; per-vertical stack statistics; recommended connector architecture and roadmap | Connector platform (proposed M14) |
| `07-vertical-playbooks-and-routing.md` | Ten-leaf startup taxonomy, per-vertical playbook cards, expert playbooks worth encoding, routing mechanism and playbook schema | Playbooks and routing (proposed M15) |
| `08-multi-agent-orchestration-research.md` | MetaGPT, ChatDev, AutoGen, Magentic-One, Anthropic and DeepMind systems; TheAgentCompany, Vending-Bench, MAST and other benchmarks; HITL budgets; architecture recommendations | Chief of Staff v2 (proposed M16) |

## Method

Eight specialist researcher agents worked in parallel, one per area, each reading the matching
first-pass document first so nothing is repeated. Sources: product docs, changelogs and pricing
pages, G2 and Trustpilot, Reddit threads, YouTube walkthrough transcripts, GitHub repositories,
arXiv and conference papers, and analyst essays. Every product claim carries a URL; claims the
researchers could not confirm are marked "unverified" in the notes and were dropped from the
synthesis. Known limits: the shared web-search budget and the YouTube transcript credits ran out
during the run, so some products are covered from secondary sources only; each note lists its
gaps at the end of each section.

## What happens next

The synthesis is input, not a decision. The founder rules on the open decisions in
`00-synthesis-and-backlog.md` (section "Open founder decisions"), then the accepted backlog items
become `docs/plans/M<n>.md` tasks with requirement IDs in `docs/SPEC.md`.
