# 06 — Connectors and the integration layer for North (as of 2026-10-16)

Scope: how agent products reach the hundreds of SaaS tools real businesses use, and what North should build or buy. Current North state (read from the repo on 2026-10-16): `packages/integrations` has typed provider contracts (`ads`, `mail`, `outreach`, `analytics`, `payments`, `push`, `code`, `deploy`, `images`, `signals`, `billing`), a `sandbox/` and a `live/` implementation per contract, Zod validation at the adapter boundary, a per-user `ProviderAuth { token, scope?, scopes?, account? }` read from the `connections` table (tokens encrypted via Supabase Vault/KMS per `docs/SPEC.md` "Veri modeli"), and live adapters for Gmail, GitHub, Vercel, Stripe (read + billing), Meta Ads, Google Ads, Reddit, PostHog, Product Hunt, Google Trends, Resend and Web Push. SPEC "Mimari ve teknoloji" lists the MVP external set as "Gmail API, GitHub App, Vercel API, Meta Marketing API, Google Ads API, Reddit API (okuma)". Every outbound action is gated by `AuthorityEngine.gate()` and written to the append-only `actions` table (CLAUDE.md non-negotiables 1–3).

Research-method note: web search budget for this run was exhausted after ~25 queries; remaining evidence came from direct fetches of vendor docs, specs and pricing pages. Items I could not reach are listed under Gaps. Verbs like "will" in vendor pages are reported as such.

### Decision summary (one screen)

| Decision | Recommendation | Why (see section) |
|---|---|---|
| Buy or build the connector layer? | Build the gate, ledger, manifest and the money/ads/code adapters; buy OAuth plumbing and the long tail from one aggregator (Composio self-managed credentials first; Nango if EU residency/self-host becomes a requirement) | KQ1 pricing and custody options; KQ7 option table |
| MCP or native adapters? | Both, behind one contract surface: native for Stripe/Meta/Google Ads/Gmail/GitHub/Vercel, vendor-run remote MCP for Notion/Slack/Linear/Shopify-UCP/QuickBooks, aggregator for everything else; never community stdio servers | KQ2 coverage and security; KQ3 vendor UX |
| How do agents see tools? | Only North contract methods; ≤20 non-deferred per role, rest via Claude tool search / `mcp_toolset` deferral; pinned tool lists | KQ4 thresholds |
| Where do tiers live? | In `connector_capabilities` rows (direction, risk_tier, reversible, external_confirmation), read by `AuthorityEngine.gate()`; money/publish writes are T2 with decision card; provider approval tokens (Stripe) stored instead of "always allow" | KQ7 data model |
| Next connectors? | Wave 1: Google Calendar/Sheets/Drive, Slack, Notion, Linear. Wave 2: Shopify (UCP/Admin), Klaviyo, QuickBooks/Xero read, HubSpot, Mailchimp. Wave 3: long tail via aggregator; social publishing stays read-only until policy review | KQ5 stack data; KQ6 matrix |
| Sandbox default? | `sandbox_mode` per manifest: provider sandbox where it exists (Stripe, Shopify dev store, QBO, GitHub, Vercel preview), North mock otherwise; `none` forces T2 on every write | KQ7 rule 6 |

---

## KQ1. Landscape of integration platforms built for agents: who is agent-native vs classic iPaaS?

### Takeaway
By late 2026 there are three clusters: (a) agent-native tool platforms that sell per-end-user OAuth + tool schemas + MCP (Composio, Nango, Arcade, Klavis, Pipedream Connect, Paragon ActionKit, Merge Agent Handler), (b) unified-API vendors that bolted MCP onto normalized data models (Apideck, Unified.to, Membrane/Integration.app), and (c) classic iPaaS with agent features (Zapier MCP/Agents, Workato, Tray). Pricing has converged on usage meters (tool calls, connections, "external users", auth challenges), with free tiers large enough for an MVP and $25–$150/month entry plans; none of them sells write-action approval as a product feature, which stays the buyer's responsibility.

### Cited Findings

Comparison table (numbers as stated on the vendor page fetched; "n/s" = not stated on the page I could reach):

| Platform | Connectors / tools | Auth model | Tool schema / MCP | Entry pricing | Write-safety / audit | Residency / compliance |
|---|---|---|---|---|---|---|
| Composio | "1500+ toolkits" on pricing page; toolkits catalog page shows 1,613 toolkits and "20,000+ tools" in meta text (inconsistent counts on same site) — [pricing](https://composio.dev/pricing), [toolkits](https://composio.dev/toolkits) | Managed OAuth: "consent, token storage, refresh, and scopes handled for every connected account"; connected accounts unlimited & free; "self-managed credentials" option where "Composio never stores or refreshes them"; customer-managed KMS keys Enterprise-only — [pricing](https://composio.dev/pricing) | "Custom tools & MCP" on all plans; "Meta tools such as tool search are free" — [pricing](https://composio.dev/pricing) | Hobby $0 (100K tool calls/mo, 50K triggers, 3 seats); Pro $29/mo then $0.0003/call, $0.003/trigger event; Composio-managed OAuth apps capped at 20K of the free calls then $0.0005/call; connections beyond 1K cost $0.10 each on paid plans; Enterprise custom — [pricing](https://composio.dev/pricing) | Spend caps per meter; Viewer seats; IP allowlist add-on; no explicit approval/HITL feature described — [pricing](https://composio.dev/pricing) | Data residency "not stated"; DPA on Pro+; BAA add-on $0.0003/call; zero-data-retention add-on +$0.0001/call — [pricing](https://composio.dev/pricing) |
| Nango | "Auth for 1,000+ APIs", "7,000+ pre-built tools, triggers, and syncs" — [pricing](https://nango.dev/pricing) | Connect UI under your brand; OAuth, API keys, JWT, "MCP Auth"; pre-approved Nango-managed OAuth apps or your own; integrations are TypeScript functions in your repo — [pricing](https://nango.dev/pricing), [blog](https://nango.dev/blog/best-embedded-integrations-platform-for-ai-agents) | MCP server ("7,000+ tools, one server") — [pricing](https://nango.dev/pricing) | Free: 10 connections, 10 compute h, 10 GB; PAYG $50/mo incl. $50 credit: $0.29/connection/mo, $0.72/compute hour, $0.50/GB egress; Enterprise down to $0.01/connection; Growth support add-on $450/mo — [pricing](https://nango.dev/pricing) | Audit trail (Enterprise), RBAC/SSO/SCIM — [pricing](https://nango.dev/pricing) | SOC 2 Type II, HIPAA/BAA, self-hosting + BYOC in any AWS/GCP/Azure region; "no EU-hosted cloud yet" — [pricing](https://nango.dev/pricing) |
| Paragon ActionKit | "1000+ integration actions" (ActionKit); Nango's Aug-2026 comparison says 130+ connectors — [ActionKit](https://www.useparagon.com/actionkit), [Nango](https://nango.dev/blog/best-embedded-integrations-platform-for-ai-agents) | Embedded Connect Portal, per-user consent screen — [ActionKit](https://www.useparagon.com/actionkit) | OpenAI-style function JSON (`additionalProperties:false`); tools fetched at query time filtered by category; MCP in headline only — [ActionKit](https://www.useparagon.com/actionkit) | Not listed; "Start for free" + demo — [ActionKit](https://www.useparagon.com/actionkit) | Event Logs dashboard per action/connection; category filter is the only agent scoping shown — [ActionKit](https://www.useparagon.com/actionkit) | SOC 2 Type II, cloud or on-prem — [ActionKit](https://www.useparagon.com/actionkit) |
| Merge Agent Handler | "Thousands of pre-built tools" / "hundreds of enterprise systems" — [Merge](https://www.merge.dev/agent-handler) | Guided user authorization; own OAuth app possible per Nango comparison — [Merge](https://www.merge.dev/agent-handler), [Nango](https://nango.dev/blog/best-embedded-integrations-platform-for-ai-agents) | Built on MCP; installable as remote MCP server into Claude, Claude Code, Cursor, ChatGPT; public MCP servers importable — [Merge](https://www.merge.dev/agent-handler) | Free to start; credits consumed by tool calls; Enterprise custom — [Merge](https://www.merge.dev/agent-handler) | Per-agent connector bundles ("Tool Packs"); DLP scanning of inputs/outputs with block/redact/mask/log rules; searchable audit trail (identity, arguments, downstream calls, outcomes); logs 90 days on standard plans — [Merge](https://www.merge.dev/agent-handler), [Nango](https://nango.dev/blog/best-embedded-integrations-platform-for-ai-agents) | SOC 2 — [Merge](https://www.merge.dev/agent-handler) |
| Pipedream Connect | "3,000+ connectors, 10,000+ prebuilt tools and triggers" — [pricing](https://pipedream.com/pricing) | Pipedream's OAuth clients or your own ("custom OAuth clients: included" all tiers) — [pricing](https://pipedream.com/pricing) | MCP servers on all tiers — [pricing](https://pipedream.com/pricing) | Free (dev only); Startup $99/mo annual ($150 monthly): 100 external users then $2/user, 10K credits then $0.012; Business custom — [pricing](https://pipedream.com/pricing) | n/s on pricing page | SOC 2 Type 2, GDPR all tiers; HIPAA/SSO/static egress IPs Business only; Workday acquisition announced Nov 2025, completed early 2026 — [Nango](https://nango.dev/blog/best-embedded-integrations-platform-for-ai-agents) |
| Arcade.dev | "7,500+ agent-optimized tools across 81 MCP servers" — [docs](https://docs.arcade.dev/home) | "Auth-first": Arcade manages user tokens, enforces per-action authorization; secrets managed for tools; self-host via Helm/Worker/hybrid — [docs](https://docs.arcade.dev/home) | Custom MCP servers with SDK; register own MCP server for governance; MCP Gateways section — [docs](https://docs.arcade.dev/home) | Free (100 challenges, 1,000 std executions, 50 pro); Growth $25/mo incl. $100 usage; $0.05/user challenge, $0.01/std execution, $0.50/pro execution ($0.01 BYO creds), $0.05/worker-hour; rate limit 1,000 API calls/min — [pricing post 2025-08-22](https://arcade.dev/blog/pricing-updates) | Server-level vs tool-level authorization, group-based tool access, visibility filtering (named, not detailed) — [docs](https://docs.arcade.dev/home) | n/s |
| Klavis AI | "100+ prebuilt integrations out-of-the-box, with OAuth support"; Strata = "intelligent connectors… optimize context window"; Apache-2.0; ~5.8k GitHub stars — [GitHub](https://github.com/Klavis-AI/klavis) | Server instances created with a `user_id` (per-user separation implied) — [GitHub](https://github.com/Klavis-AI/klavis) | MCP-native (hosted, Docker self-host, local Strata via pipx) — [GitHub](https://github.com/Klavis-AI/klavis) | Pricing page unreachable in this run — [klavis.ai](https://www.klavis.ai/pricing) | n/s | n/s |
| Apideck | 12 Unified API categories; connector count n/s — [pricing](https://www.apideck.com/pricing) | Vault handles auth incl. for hosted MCP; whitelabel Vault and SSO Enterprise-only — [pricing](https://www.apideck.com/pricing) | Hosted Apideck MCP Server on all tiers (scoped to included categories) — [pricing](https://www.apideck.com/pricing) | Launch $599/mo (25 consumers, 1 category); Scale $1,299/mo (100 consumers, 3 categories); Enterprise custom; metered on "active consumers" — [pricing](https://www.apideck.com/pricing) | n/s | n/s |
| Unified.to | "1,428+ pre-built integrations and 36+ Unified APIs" — [pricing](https://unified.to/pricing) | Register your own OAuth app for production branding; Unified test credentials for dev; embedded authorization UI; Secrets Manager on Pro+ — [pricing](https://unified.to/pricing) | "Unified MCP" product — [pricing](https://unified.to/pricing) | Grow $750/mo (750K API calls, $1/1K overage); Pro $1,500; Scale $3,000; Enterprise custom — [pricing](https://unified.to/pricing) | n/s | SOC 2 Type II, GDPR, CCPA, HIPAA (BAA on Scale), PIPEDA; "data region sync" Scale only — [pricing](https://unified.to/pricing) |
| Membrane (ex-Integration.app) | "100,000+ integrations available" via "Membrane Universe" — [pricing](https://getmembrane.com/pricing) | n/s on page | MCP, API, CLI, Skills, SDK; "works with ChatGPT, Claude, OpenClaw, Lovable, or custom agents" — [pricing](https://getmembrane.com/pricing) | Enterprise/contact only — [pricing](https://getmembrane.com/pricing) | Per-tenant rate limits, monitoring — [pricing](https://getmembrane.com/pricing) | SOC 2 Type II, GDPR; self-host on AWS/GCP/Azure — [pricing](https://getmembrane.com/pricing) |
| Zapier MCP / Agents | "9,000+ apps", "66,000+ triggers and actions" (FAQ: "30,000+ actions"); apps directory says "10300+ apps" — [Zapier MCP](https://zapier.com/mcp), [apps](https://zapier.com/apps) | Connections live in the user's Zapier account; "credentials stay in Zapier's managed connection layer and are not passed into the model" — [Zapier MCP](https://zapier.com/mcp) | MCP server per user; "Code Actions" fallback; clients: Claude, ChatGPT, Cursor, any MCP client — [Zapier MCP](https://zapier.com/mcp) | Included in every Zapier plan; each tool call = 2 tasks — [Zapier MCP](https://zapier.com/mcp) | Per-app and per-action enable/disable; IT can disable MCP per workspace; every action logged in History; no preview/confirm before writes described; separate "Human in the Loop" Zap actions (collect data / request approval) — [Zapier MCP](https://zapier.com/mcp), [HITL](https://zapier.com/mcp/human-in-the-loop) | SOC 2 Type II — [Zapier MCP](https://zapier.com/mcp) |
| Workato / Tray | Pages returned HTTP 404/429 in this run; no verified 2026 figures | — | — | — | — | — |

Other platform-level facts:
- Nango's Aug-2026 comparison claims Paragon gates "most production controls" to Enterprise, Pipedream Connect shows Pipedream branding on the auth screen and needs several API calls per pre-built action, and Merge launched Agent Handler in October 2025 — vendor-authored, treat as marketing — [Nango blog](https://nango.dev/blog/best-embedded-integrations-platform-for-ai-agents).
- A third-party usage-pricing tracker claims Composio moved to a six-dimension meter on 2026-08-15 with a $599 Business tier; the live pricing page I fetched shows only Hobby/Pro($29)/Enterprise, so the tracker is unverified — [usagepricing.com](https://usagepricing.com/blueprint/activity/composio-2026-07-23-packaging) vs [composio.dev/pricing](https://composio.dev/pricing).
- Arcade's own pricing post states authorizing many end users into an agent "is not yet possible with MCP Servers" (Aug 2025), which is its pitch for an auth layer outside MCP — [Arcade](https://arcade.dev/blog/pricing-updates).

### Inferences
- "Agent-native" in practice means four things: per-end-user connections as the billing/identity unit, tool definitions emitted as JSON Schema function tools, a hosted remote MCP endpoint, and a managed-OAuth-app option so the buyer does not have to pass Google/Meta app review. Composio, Nango, Arcade, Pipedream Connect, Klavis and Merge Agent Handler satisfy all four; Apideck/Unified.to/Membrane are unified-data vendors with an MCP endpoint; Zapier/Workato/Tray are iPaaS with an MCP veneer.
- None of the platforms implements risk tiers, approval cards or quota on the buyer's behalf; the closest are Merge's DLP policies and Zapier's per-action toggles. North's `AuthorityEngine.gate()` therefore has no off-the-shelf substitute and must stay in-house regardless of the buy decision.
- Cost at North's scale (computed from list prices above; illustrative): 1,000 founders × 5 connections, 300K tool calls/month: Composio ≈ $29 + (200K × $0.0003) = $89/mo; Nango PAYG ≈ 5,000 × $0.29 = $1,450/mo + compute; Pipedream Startup ≈ $99 + 900 × $2 = $1,899/mo; Arcade ≈ 300K × $0.01 = $3,000/mo + challenges; Apideck/Unified.to start at $599–$750/mo before scale. Composio and Nango free tiers cover an MVP of <100 founders.

### Gaps
- Klavis pricing, Workato and Tray 2026 connector counts and agent features (pages unreachable: 404/429).
- Independent, non-vendor benchmarks of tool quality (schema accuracy, rate-limit handling) across platforms: none found.
- Composio and Zapier each publish inconsistent counts on their own sites; exact numbers should be re-checked at decision time.

---

## KQ2. MCP ecosystem: coverage, auth (OAuth 2.1, DCR vs CIMD), registry, and known security issues

### Takeaway
MCP is the de-facto wire format for connectors in Claude, ChatGPT, Copilot Studio and Agentforce; the 2026-07-28 spec mandates OAuth 2.1 + PKCE + RFC 8707 resource indicators + RFC 9728 metadata, makes Client ID Metadata Documents the preferred registration method and deprecates Dynamic Client Registration. Coverage of first-party business servers is real but uneven (Stripe is exemplary; Shopify re-platformed to UCP), the official registry is still pre-GA, and the security literature (tool poisoning, lethal trifecta, confused deputy, OWASP ASI) converges on the same mitigations: least-privilege scopes, pinned tool definitions, human confirmation for consequential writes, and treating tool results as data.

### Cited Findings
Spec and auth:
- Latest spec version is 2026-07-28; MCP server is an OAuth 2.1 resource server; AS "MUST implement OAuth 2.1"; MCP servers "MUST implement OAuth 2.0 Protected Resource Metadata (RFC 9728)"; clients "MUST implement Resource Indicators (RFC 8707)"; AS/clients "SHOULD support OAuth Client ID Metadata Documents", "MAY support Dynamic Client Registration… deprecated and retained for backwards compatibility" — [MCP Authorization](https://modelcontextprotocol.io/specification/latest/basic/authorization).
- Scope step-up: 403 with `WWW-Authenticate: Bearer error="insufficient_scope", scope="files:write"`; clients accumulate the union of scopes; servers must honor scope hierarchies — [MCP Authorization](https://modelcontextprotocol.io/specification/latest/basic/authorization).
- "MCP servers MUST NOT accept or transit any other tokens" (token passthrough forbidden); confused-deputy mitigation requires per-client consent screens, exact redirect_uri matching, single-use `state`; SSRF guidance for OAuth metadata fetches; MCP is now stateless and "state handle hijacking" replaces session hijacking; scope-minimization section warns against omnibus scopes and recommends progressive elevation — [Security Best Practices](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices).
- Practical consequence observed in this very session: several hosted MCP servers (Asana, PagerDuty, HubSpot, Xero, Zoom) failed to connect with "Incompatible auth server: does not support dynamic client registration", i.e. DCR-only clients break against pre-registered-client servers (session log, 2026-10-16; not a public URL).
Registry and first-party servers:
- Official registry launched in preview 2025-09-08; API freeze v0.1 on 2025-10-24; GA "still ahead"; publishing via `mcp-publisher` with GitHub OAuth/OIDC or DNS/HTTP domain proof; namespaces `io.github.<user>/…`, `me.<domain>/…`; server count not stated — [registry repo](https://github.com/modelcontextprotocol/registry).
- The `modelcontextprotocol/servers` repo now holds only 7 reference servers (Everything, Fetch, Filesystem, Git, Memory, Sequential Thinking, Time); GitHub, GitLab, Google Drive, Slack, Sentry, Postgres etc. are archived, with Slack handed to a third party (Zencoder) — [servers repo](https://github.com/modelcontextprotocol/servers).
- Stripe: remote `https://mcp.stripe.com`, OAuth or "agent API keys"; tools include `stripe_api_search/details/read/write` (generic read/write over an allow-listed method set), Treasury `send_money`/`transfer_money` (preview); "Stripe requires human confirmation before it takes certain `stripe_api_write` actions, such as refunds and outbound payments" via an approval URL token valid 24 h; admins can enable/disable MCP per live/sandbox; from 2026-11-30 full-access secret keys are rejected; Stripe tells users to "turn on your MCP client's tool-approval setting" — [Stripe MCP](https://docs.stripe.com/mcp).
- Shopify removed catalog/cart tools from Storefront MCP and points to UCP at `https://{shop}/api/ucp/mcp` (read: `search_catalog`, `get_cart`…; write: `create_cart`, `update_cart`, `cancel_cart`); Checkout MCP requires auth/request signing — [Shopify](https://shopify.dev/docs/apps/build/storefront-mcp).
- Claude's MCP connector (Messages API, beta header `mcp-client-2025-11-20`, newer `mcp-client-2026-09-15` tool-listing pinning) supports only tool calls, requires public HTTP servers, takes an `authorization_token` the caller must obtain and refresh, and lets the caller allowlist/denylist tools and set `defer_loading` per tool or per server; docs recommend "denylisting write or destructive tools… when you want a human confirmation step before state changes" — [MCP connector](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector).
Security research:
- Tool poisoning (Invariant Labs, 2025-04-01): hidden instructions in tool descriptions made Cursor read `~/.cursor/mcp.json` and an SSH key; "rug pulls" (description changes after approval) and cross-server shadowing (a bogus tool redirecting all emails); mitigations: show full descriptions, pin/hash tool definitions, enforce cross-server data-flow boundaries — [Invariant](https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks).
- Lethal trifecta (Willison, 2025-06-16): private data + untrusted content + external communication; GitHub MCP exploit (May 2025) combined all three; "don't rely on guardrails… 95% is a failing grade"; design so untrusted input cannot trigger consequential actions (cites CaMeL) — [Willison](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/).
- OWASP Top 10 for Agentic Applications 2026 published 2025-12-09 — [OWASP](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/); categories ASI01 Goal Hijack, ASI02 Tool Misuse, ASI03 Identity & Privilege Abuse, ASI04 Agentic Supply Chain, ASI05 Unexpected Code Execution, ASI06 Memory/Context Poisoning, ASI07 Insecure Inter-Agent Communication, ASI08 Cascading Failures, ASI09 Human-Agent Trust Exploitation, ASI10 Rogue Agents; ASI02 mitigations: per-task function allow-lists, "human approval for sensitive operations such as refunds, account changes, external data transfers", monitor tool chains; ASI03: distinct identity per agent, short-lived per-workflow credentials — [Indusface summary](https://www.indusface.com/learning/owasp-top-10-agentic-ai/) (secondary; official PDF behind download).
- MCPTox benchmark (arXiv 2508.14925) tested 20 agents against 45 real MCP servers and reports more capable models being more susceptible to tool poisoning — reported via secondary summaries only; unverified against the paper — [search summary](https://www.practical-devsecops.com/glossary/mcp-indirect-prompt-injection/).
- OpenAI Apps SDK security guidance: request only needed scopes, "verify and enforce scopes on every tool call", "use the host's confirmation prompts for destructive actions, and require human confirmation for irreversible operations", "assume injected or malicious inputs will reach your server", custom MCP servers with write tools "carry extra risk" — [OpenAI](https://developers.openai.com/apps-sdk/guides/security-privacy).

### Inferences
- Quality of third-party MCP servers for business tools is bimodal: vendor-run remote servers (Stripe, Notion, Vercel, GitHub, Shopify/UCP) are production-grade with OAuth and sometimes built-in confirmation; community stdio servers are unreviewed, often broad-scope, and the reference repo has stopped maintaining them. For North, "MCP support" should mean consuming vendor-run remote servers, not community servers.
- DCR deprecation matters for North as an MCP *client*: North should implement CIMD (host `https://north.app/.well-known/...` client metadata) and keep pre-registered client IDs for the big providers; relying on DCR would reproduce the connection failures seen above.
- Stripe's server-side confirmation-token pattern (approve via URL, retry with token) is the best public model of how a provider can cooperate with North's decision cards: a Tier-2 action creates a card, the card approval stores the provider token, and the retry is a different gated action.

### Gaps
- A count of servers in the official registry and an independent quality audit of business-tool MCP servers in 2026 (not found).
- The MCPTox paper itself and the exact vulnerability numbers.
- Anthropic's connector-directory review criteria (claude.ai/directory could not be fetched; a third-party guide claims read/write separation and no-injection checks — [sunpeak.ai](https://sunpeak.ai/blogs/what-are-claude-connectors/), unverified).

---

## KQ3. How leading agent products present connectors to users (connect flow, per-agent allow-lists, ask-before-acting, sandbox, audit)

### Takeaway
The consistent pattern across Claude, ChatGPT, Copilot Studio, Agentforce, Glean, Notion AI and Dust is: admin adds the connector to the workspace, each member authorizes individually via OAuth, tools are enabled per agent/conversation, write tools are off or confirmed by default, and every call is logged. Explicit "ask before acting" exists in Claude (per-tool approval, "Allow always"), ChatGPT (context-dependent confirmation, risky actions blocked, new actions disabled until reviewed), Glean (admin-required human approval), Stripe MCP (server-side approval token) and Zapier (HITL steps); none of the horizontal products exposes a per-action risk tier or a daily decision quota.

### Cited Findings
| Product | Connect flow | Per-agent / per-tool scoping | Ask-before-acting | Sandbox / test | Audit |
|---|---|---|---|---|---|
| Claude (claude.ai) | Org Owner adds connector; "each member connects to it individually"; OAuth or shared API key header; connections originate from Anthropic cloud IPs — [Claude Help](https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp) | Toggle connectors per conversation; disable individual tools in "Search and tools" menu; owners can disable specific tool calls — [Claude Help](https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp) | "Claude requests approval before invoking a connector's tools"; "Allow always" only for trusted tools; Research mode calls tools without approval so "disable any tools that perform write actions" — [Claude Help](https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp) | n/s | n/s on page; "Anthropic doesn't verify custom connectors" — [Claude Help](https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp) |
| ChatGPT (Developer mode / MCP apps) | Full MCP incl. write actions in beta for Business/Enterprise/Edu; admins "see risk warnings when enabling apps that can write or modify data" — [OpenAI Help](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-connectors) (fetched via search snippet; page returned 403 on direct fetch) | "New actions are disabled by default, and changes to existing actions are shown as a diff" after Refresh — [OpenAI Help](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-connectors) | "ChatGPT may ask for confirmation depending on app permissions, the action's context, and the action's potential impact. Some especially risky actions may be blocked" — [OpenAI Help](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-connectors) | Developer mode is the test surface — [OpenAI Help](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-connectors) | n/s |
| Microsoft Copilot Studio | Add Connector tool → "Create new connection"; "By default, the connection uses user credentials"; maker-provided credentials optional; Standard vs Premium connectors by plan — [MS Learn](https://learn.microsoft.com/en-us/microsoft-copilot-studio/advanced-connectors) | Tools added per agent; MCP tools auto-refresh from server; MCP-in-workflows GA 2026-07-15 — [MS Learn MCP](https://learn.microsoft.com/en-us/microsoft-copilot-studio/agent-extend-action-mcp), [Message Center](https://mc.merill.net/message/MC1471573) | n/s in fetched pages | Test pane — [MS Learn](https://learn.microsoft.com/en-us/microsoft-copilot-studio/advanced-connectors) | Quotas: 50–100 generative RPM per environment; 500 knowledge sources/agent; a third-party guide claims 128 tools/agent cap, 25–30 recommended (unverified) — [MS Learn quotas](https://learn.microsoft.com/en-us/microsoft-copilot-studio/requirements-quotas), [StackOne](https://www.stackone.com/blog/best-mcp-gateway-for-microsoft-copilot/) |
| Salesforce Agentforce | Native MCP client (announced Agentforce 3, June 2025); "unified system of record for all MCP servers, including cross-org"; AgentExchange hosts "vetted MCP servers" — [Salesforce](https://www.salesforce.com/agentforce/mcp-support/), [Salesforce News](https://www.salesforce.com/news/?p=88116) | Registry decides "only authorized capabilities are discovered" — [Salesforce](https://www.salesforce.com/agentforce/mcp-support/) | n/s | n/s | "robust authentication, granular access controls… intelligent rate limiting" (future tense on page) — [Salesforce](https://www.salesforce.com/agentforce/mcp-support/) |
| Glean | "over 275 ready-made connectors"; permissions inherited and enforced, synced in real time — [Glean](https://www.glean.com/connectors) | Admin limits on what agents may do — [Glean](https://www.glean.com/connectors) | Admins can "require human approval before an action executes" — [Glean](https://www.glean.com/connectors) | n/s | n/s |
| Notion AI | Workspace owner with admin rights in the third-party app installs; connectors are workspace-level and survive the installer leaving; Business/Enterprise only (personal Gmail free) — [Notion Help](https://www.notion.com/help/notion-ai-connectors) | Permission-mapped ingestion; Slack agent "acts as you" — [Notion Help](https://www.notion.com/help/notion-ai-connectors) | n/s | n/s | Disconnect → unsearchable within ~1 h, data deleted within a day — [Notion Help](https://www.notion.com/help/notion-ai-connectors) |
| Dust | Admin adds tools in workspace settings; "Personal or Workspace credentials" per integration; tools shareable per space — [Dust docs](https://docs.dust.tt/docs/tools) | Agent picks tools; selection narrowed by instructions — [Dust docs](https://docs.dust.tt/docs/tools) | n/s in fetched page | n/s | n/s |
| Zapier MCP / Agents | Connections from the user's Zapier account appear automatically — [Zapier MCP](https://zapier.com/mcp) | Per-app and per-action enable/disable; one MCP server per agent recommended by third parties — [Zapier MCP](https://zapier.com/mcp), [gamut.so](https://www.gamut.so/blog/zapier-mcp-setup-guide) | No pre-write confirmation in MCP; HITL available as Zap steps (approval/edit) — [Zapier HITL](https://zapier.com/mcp/human-in-the-loop) | n/s | "Every MCP action is logged in History" — [Zapier MCP](https://zapier.com/mcp) |
| Lindy | "1,000+ integrations" (counter shows 1,400+); listings labeled "(OAuth)" or "(API key)"; "works with… any MCP server" — [Lindy](https://www.lindy.ai/integrations) | n/s | Third-party reviews describe escalation to a human on confidence/keyword triggers, not per-action gates — [dupple](https://dupple.com/reviews/lindy), [firstaimovers](https://www.firstaimovers.com/p/lindy-ai-agents-automation-guide-2026) | n/s | n/s |
| Relevance AI | Dust integration: paste API key + workspace ID, "every agent in your workspace can then use the connection" — [Relevance](https://relevanceai.com/integrations/dust) | n/s | Approval docs page 404 in this run | n/s | n/s |

### Inferences
- The industry default for write tools is "off until reviewed" (ChatGPT) or "ask every time until the user says always" (Claude). North's "sandbox by default" plus decision cards is stricter than any of these and is a differentiator, not a liability, for a founder audience.
- Nobody shows the user a *diff* of what a write will do before it runs except ChatGPT's action-definition diff and Stripe's approval page. A North decision card that renders the exact payload (recipient, amount, ad budget) before Tier-2 actions would exceed the market norm.
- "Personal vs workspace credential" is the one UX distinction North must carry: founder-owned OAuth (Gmail, Stripe, Meta) vs platform-owned keys (Resend, PostHog project key). North already models this split (`ProviderAuth` factories vs platform-configured `mail`/`push`).

### Gaps
- Dust's documented tool-permission levels and Relevance AI's approval settings (docs pages 404).
- Copilot Studio's official per-agent tool cap and its MCP write-confirmation behavior.
- Lindy's credential storage and scoping documentation.

---

## KQ4. Tool selection at scale (500+ tools): what Anthropic, OpenAI, Microsoft and the literature say

### Takeaway
Both frontier vendors now ship server-side tool search with deferred loading and publish hard-ish numbers: Anthropic says selection accuracy degrades past 30–50 tools and tool search cut context ~85% while lifting MCP-eval accuracy from 49%→74% (Opus 4) and 79.5%→88.1% (Opus 4.5); OpenAI says "aim for fewer than 20 functions available at the start of a turn" and defers the rest via `tool_search` (gpt-5.4+). Progressive disclosure via a file-system of tool stubs (Anthropic's code-execution post, 150K→2K tokens) and per-role tool bundles (Merge Tool Packs, Zapier per-agent servers) are the production patterns; the retrieval literature warns generic embedding retrievers are "not tool-savvy".

### Cited Findings
- Anthropic Tool Search Tool: variants `tool_search_tool_regex_20251119` and `tool_search_tool_bm25_20251119`; `defer_loading: true` keeps definitions server-side; up to 10,000 deferred tools per request; returns up to 5 matches by default (limit 1–10,000); "a typical multiserver setup (GitHub, Slack, Sentry, Grafana, and Splunk) can consume ~55k tokens… Tool search typically reduces this by over 85 percent"; "Claude's ability to pick the right tool degrades once you exceed 30–50 available tools"; keep 3–5 hot tools non-deferred; prefix names by service (`github_`, `slack_`); custom client-side search may return `tool_reference` blocks (e.g., embeddings); works per-server or per-tool via `mcp_toolset.default_config`; not separately metered — [Tool search docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool).
- Anthropic engineering (2025-11-24): tool search ~77K→8.7K tokens (85%) on a 50+ tool MCP setup; Opus 4 49%→74%, Opus 4.5 79.5%→88.1% on MCP evals; programmatic tool calling cut tokens 37% (43,588→27,297); tool-use examples raised parameter accuracy 72%→90%; use tool search when definitions exceed ~10K tokens or 10+ tools — [Advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use).
- Anthropic engineering (2025-11-04): present MCP servers as a code API tree (`./servers/google-drive/getDocument.ts`) and let the agent read only needed stubs; example 150,000→2,000 tokens (98.7%); intermediate data stays in the sandbox; PII can be tokenized (`[EMAIL_1]`) before reaching the model — [Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp).
- OpenAI function-calling guide: "Aim for fewer than 20 functions available at the start of a turn at any one time"; "Keep the number of initially available functions small for higher accuracy"; "Only gpt-5.4 and later models support tool_search"; "For deferred tools, put detailed guidance in the function description and keep the namespace description concise"; "We recommend always enabling strict mode" — [OpenAI](https://developers.openai.com/docs/guides/function-calling).
- ToolRet (ACL 2025, arXiv 2503.01763): 7.6K retrieval tasks over 43K tools; "models that perform well on conventional IR benchmarks still perform poorly on ToolRet", which lowers agent pass rates; training on 200K tool-retrieval instances "substantially improves" retrievers — [arXiv](https://arxiv.org/abs/2503.01763).
- Claude MCP connector lets the caller pin a server's tool list (`mcp_tool_listing`, beta `mcp-client-2026-09-15`) so the API "doesn't ask the server for its tools" — a defense against rug-pulls as well as a token saver — [MCP connector](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector).
- Merge groups connectors per agent "by agent type, customer tier, or environment" (Tool Packs) — [Merge](https://www.merge.dev/agent-handler); Paragon fetches tools filtered by category at query time — [ActionKit](https://www.useparagon.com/actionkit); Stripe exposes one generic `stripe_api_read`/`stripe_api_write` pair plus `stripe_api_search` so "much of the API [is] available through MCP without increasing the context window" — [Stripe MCP](https://docs.stripe.com/mcp).
- Copilot Studio third-party guide claims 128 tools/agent cap, 25–30 recommended (unverified) — [StackOne](https://www.stackone.com/blog/best-mcp-gateway-for-microsoft-copilot/).

### Inferences
- The two vendor thresholds (OpenAI <20 initial, Anthropic 30–50 before degradation) bound North's per-task tool budget: each North agent role (growth, engineering, outreach, finance) should start a task with ≤20 non-deferred tools and reach the long tail via tool search.
- North's existing coarse provider contracts (one `AdsProvider` with a handful of methods) are already a form of Stripe-style "few generic tools over a scoped method allow-list". That design scales better than exposing 20,000 raw vendor tools and should be kept as the agent-facing surface, with raw tools (from an aggregator or MCP) available only through search.
- Because North runs agents through the Claude Agent SDK (SPEC), server-side tool search + `mcp_toolset` deferral is available at zero extra metering; a custom embedding search is unnecessary at MVP scale.

### Gaps
- No published Anthropic/OpenAI numbers for accuracy *with* tool search beyond ~1,000 tools; the 10,000-tool limit is a capacity figure, not an accuracy guarantee.
- No peer-reviewed study of role-bundled tool sets vs retrieval for agentic business workflows.

---

## KQ5. Which SaaS tools small businesses and startups actually use (stack statistics by vertical)

### Takeaway
Hard usage data exists for three verticals only: horizontal SMB automation (Zapier's popular-apps ordering: Google Sheets, Gmail, Slack, Google Calendar, Drive, HubSpot, Facebook Lead Ads, Notion, Mailchimp, Stripe…), enterprise/mid-market identity (Okta 2026: Microsoft 365, Google Workspace, AWS, Salesforce, Zoom, Slack, GitHub, Figma) and Shopify stores (Judge.me, Klaviyo, Klarna messaging, Shopify Inbox, PageFly, Loox, Microsoft Clarity). YC/SaaS startup data is thin (a 2026 vendor teardown: Next.js/React on Vercel, Stripe, Linear, Slack, Notion; Vercel ~25.6% of YC sites). Agencies, content creators and local businesses have no reliable 2025–2026 stack statistics that I could reach; the per-vertical rows for them below are inferences and are marked.

### Cited Findings
- Zapier "Popular apps" in displayed order: Google Sheets, Gmail, Slack, Google Calendar, Google Drive, HubSpot, Facebook Lead Ads, Google Forms, Notion, Mailchimp, Stripe, LeadConnector, Microsoft Outlook, Calendly, Typeform, Airtable, Trello, Google Docs, Salesforce, Jotform, Gravity Forms, monday.com; category sizes: Sales & CRM 2,017 apps, Marketing 1,215, Commerce 885, Communication 789, Productivity 661; "10300+ apps" — [Zapier apps](https://zapier.com/apps). (Ordering is Zapier's own "popular" curation; no methodology given.)
- Okta Businesses at Work 2026 (via Japanese press release/secondary coverage; English top-apps page not reachable): global top by customer count Microsoft 365, Google Workspace, AWS, Salesforce, Zoom; Slack 6th, GitHub 8th, Figma new at 11th; fastest-growing in US NinjaOne (+240% YoY), Canada 1Password, Japan Notion (+43%) — [Okta JP](https://www.okta.com/ja-jp/newsroom/press-releases/okta-businesses-at-work2026/), [ScanNetSecurity](https://scan.netsecurity.ne.jp/article/2026/05/20/55303.html). Okta's English report page gives AI findings only: 82% of orgs report limited/moderate agent adoption; 58% cite AI governance/IAM as top concern; 78% worry about non-human identity permissions but only 10% have a strategy — [Okta](https://www.okta.com/businesses-at-work/).
- Shopify (Koala tracker, snapshot 2026-08-01): most-installed apps Judge.me 3,338 stores, Klaviyo 2,523, Klarna On-Site Messaging 1,429, Shopify Inbox 1,408, PageFly 1,130, Instafeed 1,073, Shopify Product Reviews 1,066, Loox 1,014, Microsoft Clarity 983, Shopify Forms 972; top categories by installs: product reviews 7,580, email marketing 5,553, page builders 2,384, chat 2,290, analytics 2,020, order tracking 2,000; top themes Trademark, Dawn, Horizon — [Koala](https://koala-apps.io/blog/shopify-store-benchmarks/). Shopify Plus (May 2026): Judge.me on 26.44% of Plus stores, Yotpo 9.30% — [Eightx](https://eightx.co/blog/yotpo-vs-okendo-vs-junip-shopify-plus). Another scanner says Klaviyo is on "more than a third" of scanned stores; App Store has 17,600+ apps; ~87% of merchants use third-party apps; average store installs ~6 apps — [tenten.co](https://tenten.co/shopify/shopify-app-ecosystem-most-downloaded-apps-2026/) (vendor blog).
- YC/SaaS startups: "typical YC company runs a remarkably default stack": Next.js/React on Vercel, Stripe, Linear, Slack, Notion; Vercel ≈25.6% of YC startup sites; React on ~250 of 500 sites (stackcrawler data, methodology not shown; updated June 2026) — [cut-the-saas](https://cut-the-saas.com/teardowns/yc-company-tool-stack). Official YC data is from 2016 (AWS 55% of hosted, Google Analytics 70%) — [YC blog](https://www.ycombinator.com/blog/yc-tech-stacks).
- SMB SaaS sprawl: average business runs 106 apps (2025 State of SaaS Report, via Jotform) — [Jotform](https://www.jotform.com/blog/saas-tools-for-startups/) (secondary).
- Zapier's own SMB automation guide pairs Zapier with Asana, HubSpot, Brevo, Wave, Gusto, Breezy HR (editorial, not usage data) — [Zapier via plushcap](https://www.plushcap.com/content/zapier/blog/zapier-the-best-automation-software-for-small-business-in-2026).

Per-vertical top-15 table. Legend: **S** = sourced above; **I** = inference from the category structure and adjacent evidence (unverified; treat as hypothesis to validate in onboarding interviews).

| # | Solo founder (generic) | E-commerce / dropshipping | SaaS startup | Agency (marketing/design/dev) | Content creator | Local business |
|---|---|---|---|---|---|---|
| 1 | Gmail / Google Workspace S | Shopify S | GitHub S | Google Workspace S | YouTube I | Google Business Profile I |
| 2 | Google Sheets S | Klaviyo S | Vercel S | Slack S | Instagram / Meta I | Square or Stripe I |
| 3 | Notion S | Judge.me S | Stripe S | HubSpot S | TikTok I | QuickBooks I |
| 4 | Stripe S | Meta Ads (FB Lead Ads proxy) S | Linear S | Notion S | Stripe / Gumroad I | Google Workspace / Gmail S |
| 5 | Calendly S | Google Ads I | Slack S | Figma S | Canva I | Facebook / Instagram Pages I |
| 6 | Slack S | Shopify Inbox S | Notion S | Canva I | Beehiiv / ConvertKit I | Calendly / booking app I |
| 7 | HubSpot S | Klarna messaging S | PostHog or GA4 I | Meta Ads S | Notion S | Mailchimp S |
| 8 | Mailchimp S | PageFly S | Google Workspace S | Google Ads I | Google Sheets S | Yelp / reviews I |
| 9 | Airtable S | Loox S | Resend / SendGrid I | Linear or Asana I | Calendly S | Zapier S |
| 10 | Google Calendar S | Microsoft Clarity S | Figma S | Stripe / QuickBooks I | Zapier S | WhatsApp Business I |
| 11 | Typeform / Jotform S | Shopify Forms S | AWS S | Calendly S | Discord I | Google Ads I |
| 12 | Trello / monday S | Instafeed S | Sentry I | Airtable S | Slack S | Canva I |
| 13 | Zapier S | Zapier S | Zapier S | Zapier S | Later / Buffer I | Xero or Wave I |
| 14 | LinkedIn I | Stripe / PayPal I | Salesforce (later) S | Gusto I | Google Drive S | Instagram DMs I |
| 15 | Canva I | Google Analytics I | Intercom I | Typeform S | Patreon I | Google Sheets S |

### Inferences
- Four tools appear in every vertical with sourced evidence: Gmail/Google Workspace, Google Sheets, Stripe (or Square), Zapier. A connector layer that nails Google Workspace + Stripe + Meta/Google Ads + Shopify + Notion/Slack covers the sourced core of five of the six verticals.
- E-commerce is the vertical with the most *vertical-specific* connectors (Klaviyo, Judge.me, Loox, PageFly) that no generic MVP would include; it is also the vertical where an aggregator's long tail pays off fastest.
- SaaS startups overlap most with North's existing adapters (GitHub, Vercel, Stripe, PostHog); the missing pieces are Linear, Slack, Notion and a transactional email provider.

### Gaps
- No reliable 2025–2026 stack statistics for agencies, content creators, or local businesses (search budget exhausted; obvious sources—Clutch, ConvertKit/Beehiiv creator reports, Yelp/GBP adoption surveys—not fetched). Rows marked I must be validated.
- G2 top small-business products and StackShare rankings were unreachable (403/429).
- Okta's English top-apps ranking page; the numbers come from Japanese press coverage.
- Zapier's "popular" ordering has no published methodology; Koala's denominator (total tracked stores) is unstated so no percentages.

---

## KQ6. Connector priority list for North by founder type

### Takeaway
Rank connectors by (reach across founder types × action value to the Outcome Ledger × availability of a sandbox or test mode × whether a first-party remote MCP server exists). Under that rule the next wave after the current seven is Google Workspace read-side (Calendar, Sheets, Drive), Slack, Notion, Linear, Shopify, Klaviyo and a bookkeeping read connector (QuickBooks/Xero); Meta/Google Ads stay but should gain a budget-capped sandbox; Reddit stays read-only per SPEC.

### Cited Findings
- North's current live set: Gmail, GitHub, Vercel, Stripe (read + platform billing), Meta Ads, Google Ads, Reddit (read), PostHog, Product Hunt, Google Trends, Resend, Web Push — repo listing `packages/integrations/src/live/` (2026-10-16) and SPEC "Dış entegrasyonlar" row — [SPEC](/home/user/North/docs/SPEC.md).
- Stripe already supports sandboxes with separate MCP permissions per live/sandbox and admin-level MCP on/off — [Stripe MCP](https://docs.stripe.com/mcp).
- Shopify agent surface moved to UCP MCP with explicit read vs write tool split — [Shopify](https://shopify.dev/docs/apps/build/storefront-mcp).
- Notion exposes a remote MCP with workspace-level install and permission mapping; Slack write actions (post, reply, react) are what Notion's agent exposes — [Notion Help](https://www.notion.com/help/notion-ai-connectors).
- Zapier popular list and Shopify app leaderboard establish reach for Google Sheets/Calendar/Drive, Slack, Notion, HubSpot, Mailchimp, Calendly, Airtable, Klaviyo, Judge.me — [Zapier apps](https://zapier.com/apps), [Koala](https://koala-apps.io/blog/shopify-store-benchmarks/).

Priority matrix (R = reach evidence, V = value to ledger metric, S = sandbox/test mode available, M = first-party remote MCP exists; ✓ sourced, ~ partial/inferred):

| Wave | Connector | Founder types | R | V | S | M | Default tier (North) | Note |
|---|---|---|---|---|---|---|---|---|
| 0 (have) | Gmail (send/read replies) | all | ✓ | ✓ outreach replies | ~ (sandbox mail adapter) | — | T1 send to known lead; T2 first contact | Keep; scope `gmail.send` + `gmail.readonly` only |
| 0 (have) | Stripe read | SaaS, e-com, solo | ✓ | ✓ MRR | ✓ Stripe sandbox | ✓ mcp.stripe.com | T0 read | Never custody; refunds T2 with Stripe approval token |
| 0 (have) | GitHub App, Vercel | SaaS | ✓ | ✓ ship/deploy | ✓ preview deploys | ✓ (Vercel MCP in this session) | T1 PR; T2 production deploy | Already EXP-1 compliant |
| 0 (have) | Meta Ads, Google Ads | e-com, local, SaaS | ✓ (FB Lead Ads in Zapier top-10) | ✓ CAC | ~ (Meta test accounts) | — | T2 budget change; T1 pause | Add hard daily cap in gate payload |
| 1 | Google Calendar, Sheets, Drive (read; Sheets append) | all | ✓ | ~ reporting | ~ | ~ (Google MCPs exist in Claude connectors) | T0 read; T1 append row | Cheapest reach win |
| 1 | Slack (post to founder's own workspace) | SaaS, agency, solo | ✓ | ~ brief delivery | ~ test channel | ✓ | T1 | Replaces email for briefs |
| 1 | Notion (read docs, write artifacts) | SaaS, solo, creator, agency | ✓ | ~ memory/artifacts | ~ | ✓ | T0 read; T1 write page | Memory source for MEM-1 |
| 1 | Linear (issues, read status) | SaaS | ✓ (YC stack) | ✓ engineering evidence | ~ | ✓ | T1 | Evidence link for tasks |
| 2 | Shopify (orders, products read; discounts write) | e-com | ✓ | ✓ revenue | ✓ dev stores | ✓ UCP | T0 read; T2 price/discount | Via UCP/Admin MCP, not Storefront |
| 2 | Klaviyo (campaign read; send T2) | e-com | ✓ | ✓ retention | ~ | — | T2 send | Top-2 Shopify app |
| 2 | QuickBooks / Xero (read P&L, AR) | local, agency, solo | ~ | ✓ cash | ✓ QBO sandbox | ✓ (QBO tools in this session) | T0 read; invoice send T2 | Xero MCP failed DCR in this session |
| 2 | HubSpot (CRM read/write contacts) | agency, SaaS | ✓ | ✓ pipeline | ✓ dev portal | ✓ (DCR-incompatible today) | T1 | Needs pre-registered client |
| 2 | Mailchimp / Beehiiv | creator, local | ✓ / ~ | ~ | ~ | — | T2 send | Email policy per SPEC |
| 3 | Calendly, Typeform/Jotform, Airtable | solo, agency | ✓ | ~ | ~ | — | T0/T1 | Long tail → aggregator or MCP |
| 3 | YouTube / Instagram / TikTok publish | creator, local | ~ | ~ | ~ | ~ | T2 publish | Platform-policy sensitive; MVP read-only like Reddit |
| 3 | Square, Google Business Profile, Yelp | local | ~ | ~ | ~ | — | T0 read; reviews reply T2 | Validate demand first |

### Inferences
- Wave 1 is pure reach with low risk (read-mostly) and should be done natively or via Claude-side MCP servers that already exist; Wave 2 is where an aggregator starts to pay off (Klaviyo, HubSpot, QuickBooks, Shopify Admin each carry OAuth-app review burdens).
- Any connector whose write side touches money (Stripe refunds, QuickBooks invoices, Square) must stay T2 with an external approval artifact (Stripe's token model) and never a stored "always allow" rule; this is consistent with non-negotiable 6 (no custody) and the OWASP ASI02 refund example.

### Gaps
- No North-specific demand data (which founder types sign up) to weight the matrix; the weights above are judgment.

---

## KQ7. Recommended architecture for North: buy vs build, MCP vs native adapters, and connector capabilities/permissions/risk tiers as data

### Takeaway
Keep North's thin typed provider contracts as the only agent-facing surface and the only thing `AuthorityEngine.gate()` sees; underneath, run a three-lane transport (native adapters for the money/ads/code core, vendor-run remote MCP servers for Notion/Slack/Linear/Stripe/Shopify, and one aggregator—Composio or Nango—for the long tail), and move each connector's capabilities, scopes, risk tier and sandbox mode into a declarative `connector_manifest` table so new connectors are data, not code. Buy the OAuth plumbing and long tail; never buy the gate, the ledger or the quota.

### Cited Findings (design constraints drawn from the evidence above)
- Gate and audit are non-negotiable in-house: CLAUDE.md rules 1–4 and SPEC "Denetim" (every external action in `actions` with tier and approving card) — [CLAUDE.md](/home/user/North/CLAUDE.md), [SPEC](/home/user/North/docs/SPEC.md).
- No vendor sells approval/tiering; closest are Merge DLP rules and Zapier per-action toggles — [Merge](https://www.merge.dev/agent-handler), [Zapier MCP](https://zapier.com/mcp).
- Tool budgets: <20 initial (OpenAI), 30–50 degradation (Anthropic); `defer_loading` per MCP server/tool; tool list pinning — [OpenAI](https://developers.openai.com/docs/guides/function-calling), [Tool search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool), [MCP connector](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector).
- Spec-level security MUSTs: audience-bound tokens, no passthrough, per-client consent, scope minimization, pinned tool definitions — [MCP security](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices), [Invariant](https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks).
- Lethal-trifecta rule: untrusted content must not be able to trigger consequential actions — [Willison](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/).
- Aggregator economics: Composio $0 → $29/mo + $0.0003/call with free unlimited connections and a "self-managed credentials" mode in which Composio "never stores or refreshes" tokens; Nango $0.29/connection with code-in-your-repo integrations and BYOC — [Composio](https://composio.dev/pricing), [Nango](https://nango.dev/pricing).
- Stripe approval-token flow as the model for provider-cooperative confirmation — [Stripe MCP](https://docs.stripe.com/mcp).

Option comparison:

| Option | What North writes | Coverage | Token custody | Gate fit | Cost (1K founders) | Risk |
|---|---|---|---|---|---|---|
| A. Build all native (status quo) | 1 adapter per provider (~300–500 LOC + tests each, judging by `live/gmail.ts`) | 7 today; ~1 new connector per engineer-week (inference) | North (Vault) ✓ | Perfect | $0 vendor; engineering time | Slow long tail; every OAuth app review (Google, Meta, HubSpot) is North's |
| B. Aggregator only (Composio/Nango) | Thin wrapper mapping aggregator tools to North contracts | 1,000–1,600 toolkits | Vendor-managed unless "self-managed credentials" (Composio) or self-host/BYOC (Nango) | Good if every call still passes gate; risk of agents calling raw tools | ≈$89/mo (Composio) – $1.5K/mo (Nango PAYG) | Vendor lock-in; Pipedream/Workday precedent; inconsistent tool quality |
| C. MCP only (vendor remote servers) | MCP client with CIMD + pre-registered clients; tool allowlists | Stripe, Notion, Slack, Linear, GitHub, Vercel, Shopify/UCP, QuickBooks… (dozens, not thousands) | Tokens in North Vault, audience-bound per server | Good; but tool schemas change under North (needs pinning) | ~$0 vendor; LLM tokens for tool defs | DCR incompatibilities; rug-pull risk; no sandbox for many servers |
| **D. Three-lane (recommended)** | Contracts + manifest + 3 transports | Core native (money/ads/code) + vendor MCP (collab) + aggregator long tail | North Vault for native + MCP; aggregator in self-managed-credentials or BYOC mode | Perfect: gate sees only contract-level actions | ≈$100–300/mo vendor at MVP; grows linearly with calls | More moving parts; must enforce "no raw tool exposure" in code review |

Recommended data model (additions to SPEC "Veri modeli"; all rows validated with Zod at load):

| Table / field | Purpose | Example |
|---|---|---|
| `connector_manifests(id, provider, version, transport ∈ {native,mcp,aggregator}, auth_kind ∈ {oauth_user, api_key_user, platform_key}, oauth_client ∈ {north_registered, cimd, aggregator_managed}, scopes_min[], scopes_optional[], sandbox_mode ∈ {provider_sandbox, north_mock, none}, server_url?, tool_pin_hash?)` | One row per connector version; `tool_pin_hash` is the hash of the pinned MCP tool list (Invariant "pinning" mitigation) | `stripe/2026-10: transport=mcp, oauth_client=north_registered, sandbox_mode=provider_sandbox, tool_pin_hash=…` |
| `connector_capabilities(manifest_id, capability_key, contract_method, direction ∈ {read, write, money, publish}, risk_tier ∈ {0,1,2}, requires_card, reversible, external_confirmation ∈ {none, provider_token}, rate_limit_per_day, payload_schema_ref)` | Maps each exposed capability to a North contract method and a *default* tier; the gate reads tier here, not from code | `stripe.refund: direction=money, risk_tier=2, requires_card=true, reversible=false, external_confirmation=provider_token` |
| `connections` (existing) + `manifest_id, granted_scopes[], mode ∈ {sandbox, live}, token_audience, last_rotated_at, revoked_at` | Per-user connection; `mode` defaults to sandbox (rule 5); `token_audience` enforces RFC 8707 binding | — |
| `agent_tool_bundles(agent_role, manifest_id, capability_key, non_deferred bool)` | Per-role allow-list; ≤20 `non_deferred` per role; the rest reachable only via tool search | growth: meta_ads.pause (non_deferred), klaviyo.send (deferred) |
| `auto_rules` (existing) | "don't ask again" rules must reference `capability_key` and a payload predicate, never a whole connector; money capabilities are excluded from auto-rules | — |

Operating rules that follow from the evidence:
1. Agents see only North contract methods (today's `AdsProvider`, `OutreachMailProvider`, etc.). Raw aggregator/MCP tools are never placed in the model's tool list; the transport is an implementation detail behind the contract, so `gate()` cannot be bypassed (rule 1).
2. Every capability carries `direction` and `risk_tier` as data; the gate derives T0/T1/T2 from the row plus payload predicates (amount, audience size). Tier 2 money/publish writes always produce a decision card (DEC-*) and, where the provider offers it, store the provider's approval token (Stripe) rather than a North-side "always allow".
3. Tokens: native and MCP tokens live in Supabase Vault with `token_audience`; aggregator use is restricted to Composio "self-managed credentials" (North passes the token per call) or Nango BYOC/self-host so that tokens are never resident at the vendor. This preserves the SPEC guarantee "tokenlar şifreli saklanır" and non-negotiable 6.
4. MCP client hygiene: implement CIMD and keep pre-registered client IDs for Google/Meta/HubSpot/Xero; validate `iss`, use `resource` parameter, reject non-HTTPS metadata, pin tool lists (`mcp_tool_listing`) and alert on hash change (rug-pull), and run tool-result content through the same injection policy as email/web (SPEC "Güvenlik").
5. Lethal-trifecta partition: tasks that ingest untrusted content (inbox triage, Reddit/competitor reads) run with `direction=read` capabilities only; any write they propose becomes a card. This is a bundle-level property, enforceable from `agent_tool_bundles`.
6. Sandbox by default: `sandbox_mode=provider_sandbox` where the vendor has one (Stripe, Shopify dev store, QuickBooks sandbox, GitHub test repo, Vercel preview), `north_mock` otherwise (the existing `sandbox/` adapters), and a `none` value that forces T2 for every write until the founder flips `mode=live`.
7. Kill switch (rule 7) revokes in-process via the gate and, for Stripe, can additionally call session revocation (Stripe dashboard supports "Revoke all" per account/environment).

Cost and effort estimate (judgment, informed by the figures above):
- Engineering: manifest + capability tables and gate changes ≈ 1–2 weeks; MCP client with CIMD/pinning ≈ 1–2 weeks; aggregator lane behind contracts ≈ 1 week; each Wave-1 connector ≈ 2–3 days when it rides MCP or the aggregator vs ~1 week native.
- Vendor: $0–$29/mo (Composio Hobby/Pro) or $0–$50/mo (Nango free/PAYG) at MVP; <$300/mo at 1,000 founders and 300K calls; the LLM-side cost of tool definitions is controlled by deferral (≥85% reduction per Anthropic).
- Compliance: both candidate aggregators offer DPA; neither offers an EU region by default (Nango "no EU-hosted cloud yet"; Composio residency "not stated"), so EU founders' data should not transit the aggregator (use self-managed credentials + North-side execution where possible).

### Inferences
- Choosing between Composio and Nango: Composio wins on price and catalog breadth for a long tail routed through North's own tokens; Nango wins if North wants integration code in its own repo (fits the TDD/400-line rules) and a BYOC path. A reasonable sequencing is Composio self-managed-credentials for Wave 2–3 now, re-evaluate Nango self-host when a design partner requires EU residency.
- Representing tiers as data also solves DEC-3 "bunu bir daha sorma" safely: auto-rules bind to `capability_key` + predicate, so a rule learned for "pause ad set" can never widen to "increase budget".

### Gaps
- No verified figure for how often aggregator tool schemas change (needed to size the pinning/alerting work).
- Composio's "self-managed credentials" semantics for refresh tokens (whether North must refresh Google tokens itself) are not detailed on the pricing page; confirm in docs before relying on it.
- EU data-residency options for both aggregators beyond the statements above.

---

## Appendix A. Phased roadmap (derived from KQ6/KQ7; effort figures are judgment)

| Phase | Weeks | Deliverable | Acceptance test (TDD, Vitest/Playwright) | Depends on |
|---|---|---|---|---|
| P0 | 1 | `connector_manifests` + `connector_capabilities` migrations; Zod schemas; seed rows for the 7 existing live adapters | Gate test: an action whose `capability_key` is missing from the table is refused; a `direction=money` capability can never be T0/T1 | SPEC data model |
| P1 | 1–2 | Gate reads tier from capability row + payload predicate; `auto_rules` bound to `capability_key`; decision card renders full payload for T2 | Test: refund card shows amount/customer; "don't ask again" on `meta_ads.pause` does not apply to `meta_ads.set_budget` | P0 |
| P2 | 1–2 | MCP client lane: CIMD document at `/.well-known/`, pre-registered client IDs for Google/Meta/HubSpot, `resource`/`iss` validation, tool-list pinning with hash alert, HTTPS-only metadata, egress proxy | Test: server whose tool description hash changed is quarantined and a signal is raised; token for server A is never sent to server B | P0 |
| P3 | 1 | Wave 1 connectors (Google Calendar/Sheets/Drive, Slack, Notion, Linear) through MCP lane; all `direction=read` or T1 | Playwright: founder connects Notion, agent writes an artifact page as T1, action row + evidence URL present | P2 |
| P4 | 1 | Aggregator lane (Composio self-managed credentials) behind contracts; no raw tool exposure; per-call token injection from Vault | Test: aggregator call without a Vault token fails closed; agent tool list contains zero aggregator tool names | P0 |
| P5 | 2 | Wave 2 connectors (Shopify UCP/Admin, Klaviyo, QuickBooks/Xero read, HubSpot, Mailchimp) with provider sandboxes; Klaviyo/Mailchimp send = T2 | Test: Shopify discount in sandbox store never reaches live without `mode=live` flip + card | P3, P4 |
| P6 | ongoing | Tool budget enforcement per role (≤20 non-deferred), tool search on, Langfuse metrics for "tool found / tool misfired" | Metric: tool-selection error rate per role tracked in observability (SPEC "Gözlem") | P3 |

## Appendix B. Concrete shapes (illustrative; names follow CONTEXT.md conventions to be confirmed)

Manifest row (YAML view of a `connector_manifests` + `connector_capabilities` record):

```yaml
provider: stripe
version: 2026-10
transport: mcp               # native | mcp | aggregator
server_url: https://mcp.stripe.com
auth_kind: oauth_user         # oauth_user | api_key_user | platform_key
oauth_client: north_registered
scopes_min: [read]
scopes_optional: [write]
sandbox_mode: provider_sandbox
tool_pin_hash: sha256:…       # hash of pinned tool list; change => quarantine + signal
capabilities:
  - key: stripe.read_revenue
    contract_method: PaymentsProvider.monthlyRevenue
    direction: read
    risk_tier: 0
  - key: stripe.create_payment_link
    contract_method: PaymentsProvider.createPaymentLink
    direction: write
    risk_tier: 1
    reversible: true
  - key: stripe.refund
    contract_method: PaymentsProvider.refund
    direction: money
    risk_tier: 2
    requires_card: true
    reversible: false
    external_confirmation: provider_token   # Stripe approval URL -> token, 24h expiry
    rate_limit_per_day: 5
```

Gate evaluation order (pseudocode; each step is a pure function returning a new decision object, per "immutable data" rule):

```
gate(action):
  cap   = capabilities.lookup(action.capability_key)      # missing => refuse, log
  conn  = connections.lookup(action.company_id, cap.manifest_id)
  tier  = max(cap.risk_tier, predicates(cap, action.payload))   # e.g. amount > budget.daily_limit => 2
  if conn.mode == 'sandbox' and cap.direction in {money, publish}: tier = 2
  if cap.direction == 'money' and conn.mode == 'sandbox': route to sandbox adapter, tier stays as computed
  if tier == 2: card = decision_cards.create(...); quota.check(company)   # never exceed 3/day
  if cap.external_confirmation == 'provider_token': require token from card, else refuse
  append actions(row with tier, card_id, manifest_version, tool_pin_hash)
  dispatch via transport(cap.manifest.transport)
```

Role bundle example (`agent_tool_bundles`): `growth` → non-deferred: `meta_ads.read_metrics`, `meta_ads.pause`, `google_ads.read_metrics`, `gmail.send_reply`, `posthog.read_funnel`, `stripe.read_revenue` (6); deferred: everything else in Wave 1–3. `engineering` → non-deferred: `github.open_pr`, `github.push_tree`, `vercel.create_preview`, `vercel.status`, `linear.read_issue`, `linear.comment` (6).

## Appendix C. Risk register for the connector layer

| Risk | Evidence | Likelihood / impact | Mitigation in this design |
|---|---|---|---|
| Tool poisoning / rug pull via MCP description change | Invariant Labs 2025-04-01; MCP connector tool-list pinning docs | Medium / high | `tool_pin_hash` + quarantine; only vendor-run servers; descriptions shown in admin UI |
| Lethal trifecta in inbox/Reddit tasks | Willison 2025-06-16; GitHub MCP exploit | High if ignored / high | Read-only bundles for untrusted-content tasks; writes become cards |
| DCR-only client breaks against pre-registered servers | Observed in this session (HubSpot, Xero, Zoom, Asana) ; spec deprecates DCR | High / medium | CIMD + pre-registered IDs |
| Aggregator stores founder tokens or lacks EU region | Composio residency "not stated"; Nango "no EU cloud yet" | Medium / medium | Self-managed credentials / BYOC; EU founders excluded from aggregator lane until residency exists |
| Vendor acquisition changes roadmap | Pipedream → Workday (Nov 2025) | Medium / medium | Contracts isolate transport; two aggregators qualified |
| Tool-selection errors as catalog grows | Anthropic 30–50 threshold; OpenAI <20 | High without controls / medium | Role bundles ≤20 non-deferred; tool search; Langfuse metric |
| Money moves without a human | OWASP ASI02 refund example; Stripe requires confirmation for refunds | Low with design / critical | `direction=money` always T2, provider token, daily rate limit, no auto-rules |
| Quota or kill switch bypass through a vendor-side retry | Stripe retry-with-token semantics | Low / high | Retry is a new gated action; kill switch revokes Vault tokens and Stripe sessions |

---

## Sources consulted (primary unless noted)
Composio pricing https://composio.dev/pricing · Composio toolkits https://composio.dev/toolkits · Nango pricing https://nango.dev/pricing · Nango comparison (vendor) https://nango.dev/blog/best-embedded-integrations-platform-for-ai-agents · Paragon ActionKit https://www.useparagon.com/actionkit · Merge Agent Handler https://www.merge.dev/agent-handler · Pipedream pricing https://pipedream.com/pricing · Arcade pricing post https://arcade.dev/blog/pricing-updates · Arcade docs https://docs.arcade.dev/home · Klavis GitHub https://github.com/Klavis-AI/klavis · Apideck pricing https://www.apideck.com/pricing · Unified.to pricing https://unified.to/pricing · Membrane pricing https://getmembrane.com/pricing · Zapier MCP https://zapier.com/mcp · Zapier HITL https://zapier.com/mcp/human-in-the-loop · Zapier apps https://zapier.com/apps · Zapier Agents https://zapier.com/agents · MCP authorization spec https://modelcontextprotocol.io/specification/latest/basic/authorization · MCP security best practices https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices · MCP registry https://github.com/modelcontextprotocol/registry · MCP reference servers https://github.com/modelcontextprotocol/servers · Stripe MCP https://docs.stripe.com/mcp · Shopify Storefront MCP/UCP https://shopify.dev/docs/apps/build/storefront-mcp · Claude custom connectors https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp · Claude MCP connector https://platform.claude.com/docs/en/agents-and-tools/mcp-connector · Claude tool search https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool · Anthropic advanced tool use https://www.anthropic.com/engineering/advanced-tool-use · Anthropic code execution with MCP https://www.anthropic.com/engineering/code-execution-with-mcp · OpenAI function calling https://developers.openai.com/docs/guides/function-calling · OpenAI Apps SDK security https://developers.openai.com/apps-sdk/guides/security-privacy · OpenAI help (developer mode & MCP; via search snippet) https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-connectors · Copilot Studio connectors https://learn.microsoft.com/en-us/microsoft-copilot-studio/advanced-connectors · Copilot Studio MCP https://learn.microsoft.com/en-us/microsoft-copilot-studio/agent-extend-action-mcp · Copilot Studio quotas https://learn.microsoft.com/en-us/microsoft-copilot-studio/requirements-quotas · Agentforce MCP https://www.salesforce.com/agentforce/mcp-support/ · Glean connectors https://www.glean.com/connectors · Notion AI connectors https://www.notion.com/help/notion-ai-connectors · Dust tools https://docs.dust.tt/docs/tools · Lindy integrations https://www.lindy.ai/integrations · Invariant tool poisoning https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks · Willison lethal trifecta https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/ · OWASP ASI 2026 https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/ (list via https://www.indusface.com/learning/owasp-top-10-agentic-ai/) · ToolRet https://arxiv.org/abs/2503.01763 · Okta BaW 2026 https://www.okta.com/businesses-at-work/ and https://www.okta.com/ja-jp/newsroom/press-releases/okta-businesses-at-work2026/ · Koala Shopify benchmarks https://koala-apps.io/blog/shopify-store-benchmarks/ · YC stack teardown (vendor) https://cut-the-saas.com/teardowns/yc-company-tool-stack · YC 2016 https://www.ycombinator.com/blog/yc-tech-stacks
