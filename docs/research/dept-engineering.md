# Engineering department: making it world class

Date: 2026-10-16. Scope: the Engineering department that builds the user's product. This phase
ships an excellent landing page with a waitlist; the design must carry over to a full app later.
Method: repos verified by `git ls-remote` plus a shallow clone (license file, last commit on the
default branch, `SKILL.md` inventory); npm versions read from the registry on 2026-10-16;
pricing and API facts read from vendor docs. "Unverified" marks anything I could not confirm.

## Summary

1. **The current pipeline cannot produce a world-class site.** `build_site` asks for one static
   `index.html` with no build step. `workspaceFiles()` keeps only text extensions (no images or
   fonts), at most 60 files of 512 KiB each. `VercelDeploy.create` uploads inline files with
   `framework: null`. `test_report` evidence counts as verified for any non-empty string
   (`verifier.ts`). Sources: `packages/agents/src/prompts/task-guides.ts`,
   `packages/agents/src/runtime/workspace.ts`, `packages/core/src/tasks/types.ts`,
   `apps/worker/src/services/verifier.ts`.
2. **There is a security gap to fix first.** The engineering agent's `Bash` runs on the worker host
   with `ANTHROPIC_API_KEY` in its environment, no `sandbox` option set and open egress
   (`buildQueryOptions` in `claude-agent-sdk.ts`). A prompt injection in fetched content could
   read the key and send it out. The SDK's own default `allowUnsandboxedCommands: true` would also
   need overriding ([SDK reference](https://code.claude.com/docs/en/agent-sdk/typescript)).
3. **Adopt Anthropic's published long-running harness.** It has three parts: a planner, a builder
   and a separate, skeptical evaluator that drives the live page with Playwright. The builder
   works from `feature_list.json`, a progress file and `init.sh`, one feature per session. The
   costs matter: Anthropic's full-app runs cost $124.70-$200, against $9 for a broken solo run.
   A landing page has to be capped far below that
   ([Nov 2025](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents),
   [Mar 2026](https://www.anthropic.com/engineering/harness-design-long-running-apps)).
4. **Skills can be loaded without `settingSources`.** The SDK takes
   `plugins: [{ type: "local", path }]`, plus `skills: [...]` as a per-persona allowlist. North
   keeps `settingSources: []` and vendors pinned skill folders
   ([Agent SDK skills](https://code.claude.com/docs/en/agent-sdk/skills)).
5. **Libraries worth vendoring, all checked for license:** obra/superpowers (MIT),
   mattpocock/skills (MIT), anthropics/skills `frontend-design`/`webapp-testing` (Apache-2.0),
   pbakaus/impeccable (Apache-2.0), vercel-labs/agent-skills React rules (MIT), the Next.js
   `next-dev-loop` skill (MIT), the shadcn skill (MIT), supabase/agent-skills (MIT),
   addyosmani/web-quality-skills (MIT), getsentry/skills (Apache-2.0) and the agent-browser
   `dogfood` QA skill (Apache-2.0). Trail of Bits is CC-BY-SA-4.0, so vendor it unmodified only.
   Do not vendor Anthropic's `claude-security`: its license is proprietary and for internal use.
6. **Framework knowledge belongs in always-on context, not in skills.** In Vercel's evals, a skill
   scored 53% (it went unused in 56% of cases), 79% with explicit instructions, and an
   `AGENTS.md` docs index scored 100%. Next.js 16.3+ writes that `AGENTS.md` itself, pointing to
   docs bundled with the installed version
   ([Vercel](https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals),
   [Next.js](https://nextjs.org/docs/app/guides/ai-agents)).
7. **Sandbox pick: Vercel Sandbox, with E2B as fallback.** Vercel runs Firecracker microVMs,
   bills CPU only while it is active, has an egress firewall with credential brokering, takes
   snapshots and runs Chrome. Raw compute for a build costs cents; tokens dominate cost.
   Daytona's open-source repo has been unmaintained since June 2026.
8. **Generated stack:** Next.js 16.4 + Tailwind 4.3 + shadcn 4.21 + Motion 14.3, built by Vercel
   from the user's GitHub repo. The waitlist lives in the user's own Supabase project (OAuth
   Management API, RLS insert-only), with Resend Contacts as a no-database fallback.
9. **Evidence comes from deterministic gates, not the agent's word.** The gates are: typecheck,
   lint, build, Playwright end-to-end, axe, Lighthouse 13, the impeccable detector, a link check
   and visual baselines. Then the worker re-checks the preview: HTTP 200 with the Vercel bypass
   header, a real form submit, and the row read back from the user's database.
10. **Budget fits under $100.** Estimate: about $4-7 of Claude per landing build (Sonnet 5.5
    builds, Opus 5.5 plans and reviews) and under $0.30 per per-change CI run on a tiny fixture.
    That is roughly $30-45 a month for Engineering in dev, plus under $5 of sandbox compute.

## Findings

### 1. Current state: what blocks quality (repo, 2026-10-16)

| Area | Today | Effect |
| --- | --- | --- |
| Build guide | `build_site`: static `index.html`, "no build step required" (`task-guides.ts:77`) | No components, design tokens, motion, image optimisation or tests |
| Output collection | `TEXT_EXTENSIONS` only, 60 files, 512 KiB each, utf-8 only (`workspace.ts`, `tasks/types.ts:103`) | Cannot ship a logo, OG image, fonts or a normal Next.js tree |
| Push | `GitHubCodeHost.pushTree` sends `encoding: "utf-8"` blobs only | Binary assets are impossible |
| Deploy | `VercelDeploy.create`: inline files, `projectSettings: { framework: null }` | No framework build on Vercel; every deploy re-uploads every file |
| Verification | `verifyUrl` is a plain GET with no redirects; `test_report` passes on any non-empty ref | Protected previews return 401 or redirect; test claims are unchecked |
| Isolation | SDK subprocess `cwd` = `<workspaceRoot>/<taskId>` on the worker; no `sandbox`; key in env | Bash can read the key and reach any host |
| Skills | `settingSources: []`, one in-process MCP tool | No TDD, debugging, design or QA know-how loaded |
| Loop | One run, one artifact (research context) | No planner, evaluator or fix loop; self-evaluation "skews positive" per Anthropic |

### 2. Skill libraries (every repo verified 2026-10-16)

| Library | License | Last commit | What Engineering would use | Verdict |
| --- | --- | --- | --- | --- |
| [obra/superpowers](https://github.com/obra/superpowers) v7.0.0 | MIT | 2026-10-09 | `test-driven-development`, `systematic-debugging`, `verification-before-completion`, `writing-plans`, `executing-plans`, `subagent-driven-development`, `requesting-code-review` | Vendor. `brainstorming` asks the user many questions, so replace it with the planner's own spec step |
| [mattpocock/skills](https://github.com/mattpocock/skills) plugin v1.3.1 (38 skills; listed in `claude-plugins-official`) | MIT | 2026-10-09 | `engineering/tdd`, `diagnosing-bugs`, `code-review` (standards + spec axes in parallel subagents), `codebase-design` (deep modules), `to-tickets` (tracer-bullet tickets with blocking edges), `implement`, `prototype` | Vendor those seven. `grill-me`, `grilling` and `to-questionnaire` interview the user and would spend cards; leave them out |
| [anthropics/skills](https://github.com/anthropics/skills) (no root license; per-skill `LICENSE.txt`) | Apache-2.0 for the three named | 2026-10-09 | `frontend-design` (anti-template aesthetics), `webapp-testing` (Playwright + `with_server.py`), `skill-creator` (for North-authored skills) | Vendor. `docx`/`pdf`/`pptx` carry different terms; not needed here |
| [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) | Apache-2.0 per plugin, except `claude-security` (proprietary, "internal use") | 2026-10-15 | `frontend-design`, `pr-review-toolkit` agents (`silent-failure-hunter`, `pr-test-analyzer`, `type-design-analyzer`), `security-guidance` (pattern warnings + diff review hooks) | Vendor `pr-review-toolkit` agents as subagent prompts. Do not ship `claude-security` |
| [pbakaus/impeccable](https://github.com/pbakaus/impeccable) v4.6.0 | Apache-2.0 | 2026-10-16 | 24 commands (`craft`, `critique`, `audit`, `polish`, `harden`, `adapt`, `animate`) + `impeccable detect --json` (59 deterministic anti-pattern rules, no LLM) | Vendor the skill and use `detect` as a gate. It downloads a binary on first run and sends telemetry unless `IMPECCABLE_NO_TELEMETRY=1`; pre-install the binary in the snapshot |
| [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) | MIT (README; `license: MIT` in skills) | 2026-08-28 | `react-best-practices` (72 rule files), `composition-patterns`, `react-view-transitions` | Vendor. `web-design-guidelines` fetches its rules at run time: vendor a snapshot of [web-interface-guidelines](https://github.com/vercel-labs/web-interface-guidelines) (MIT, 2026-10-05) instead |
| [vercel/next.js `skills/`](https://github.com/vercel/next.js/tree/canary/skills) (replaces the moved [vercel-labs/next-skills](https://github.com/vercel-labs/next-skills)) | MIT | 2026-10-16 | `next-dev-loop` (edit, then verify through `/_next/mcp` + agent-browser), `next-bundle-optimizer` | Vendor `next-dev-loop`. Framework rules come from the bundled `node_modules/next/dist/docs/` |
| [shadcn-ui/ui `skills/shadcn`](https://github.com/shadcn-ui/ui) | MIT | 2026-10-16 | Component add/compose, presets, DESIGN.md to theme | Vendor, after rewriting `npx shadcn@latest` to the pinned `shadcn@4.21.5` |
| [supabase/agent-skills](https://github.com/supabase/agent-skills) | MIT | 2026-10-02 | `supabase` (RLS, SSR auth, `getClaims`), `supabase-postgres-best-practices` | Vendor. It tells the agent to fetch the Supabase changelog, so allowlist `supabase.com` or override that line in a North overlay |
| [addyosmani/web-quality-skills](https://github.com/addyosmani/web-quality-skills) | MIT | 2026-08-24 | `web-quality-audit`, `accessibility` (WCAG 2.2), `core-web-vitals`, `performance`, `seo` | Vendor for QA |
| [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) (25 skills) | MIT | 2026-10-13 | `frontend-ui-engineering`, `incremental-implementation`, `browser-testing-with-devtools`, `shipping-and-launch` | Optional; overlaps superpowers |
| [getsentry/skills](https://github.com/getsentry/skills) | Apache-2.0 | 2026-10-15 | `find-bugs`, `code-review`, `security-review`, `iterate-pr` (green-CI loop), `skill-scanner` | Vendor `find-bugs`, `security-review`, `skill-scanner` (use it to audit vendored skills) |
| [trailofbits/skills](https://github.com/trailofbits/skills) (85 skills) | CC-BY-SA-4.0 | 2026-10-15 | `insecure-defaults`, `differential-review`, `supply-chain-risk-auditor`, `sharp-edges`, `property-based-testing` | Vendor unmodified with attribution. Changes would have to be published CC-BY-SA |
| [vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser) 0.39.1 | Apache-2.0 | 2026-10-15 | CLI driving Chrome (DOM, console, network, React tree, vitals); `dogfood` exploratory-QA skill; a `vercel-sandbox` recipe | Vendor; the QA engineer's main tool |
| [microsoft/playwright-cli](https://github.com/microsoft/playwright-cli) (`@playwright/cli` 0.1.22) | Apache-2.0 | 2026-09-28 | Playwright as a CLI + skill; Microsoft says it is more token-efficient than MCP for coding agents | Vendor; use Playwright MCP only for the evaluator if needed |
| [wshobson/agents](https://github.com/wshobson/agents) (185 skills) | MIT | 2026-10-15 | Large catalog | Skip: too broad to audit |

Design-side libraries (3D, motion) are covered in the Design department report. Engineering
consumes their output as `DESIGN.md` + tokens.

### 3. Sandboxed execution

The Agent SDK runs a `claude` subprocess over stdio. Anthropic recommends putting it inside an
isolation boundary and injecting credentials through a proxy outside it, "1 GiB RAM, 5 GiB disk,
and 1 CPU per agent" as a floor. Its docs also say token cost "typically dominates container
infrastructure cost by an order of magnitude"
([hosting](https://code.claude.com/docs/en/agent-sdk/hosting),
[secure deployment](https://code.claude.com/docs/en/agent-sdk/secure-deployment)). The TS SDK's
`spawnClaudeCodeProcess` lets North run the CLI inside a VM while hooks and in-process MCP tools
stay in the worker. The SDK still talks to it over stdio. Whether stdin streams through each
provider's command API is **unverified**; a spike is needed.

| Provider | Isolation | Billing basis | Published rates | Free / plan | Max session | Egress control | Chrome / Playwright |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [Vercel Sandbox](https://vercel.com/docs/sandbox/pricing) | Firecracker microVM, own kernel | **Active CPU** + provisioned memory | $0.128/CPU-h, $0.0212/GB-h, $0.60/1M creations | Hobby: 5 CPU-h + 420 GB-h/mo, but Hobby is "non-commercial, personal use only" ([Hobby](https://vercel.com/docs/plans/hobby)); Pro $20 with $20 credit | 45 min Hobby / 24 h Pro | Allow/deny lists, SNI enforcement, **credential brokering** (`transform` headers), live policy updates ([firewall](https://vercel.com/docs/sandbox/concepts/firewall)) | Yes: agent-browser ships a `vercel-sandbox` recipe and snapshots |
| [E2B](https://e2b.dev/pricing) | Firecracker VM | Wall clock | $0.0504/vCPU-h, $0.0162/GiB-h | Hobby $0 + one-time $100 credit; Pro $150/mo | 1 h Hobby / 24 h Pro | Allow/deny by IP, CIDR or domain (SNI/Host) ([docs](https://docs.e2b.dev/network/internet-access)) | Desktop sandboxes; Chromium in custom templates |
| [Daytona](https://www.daytona.io/pricing) | Dedicated kernel | Wall clock, per second | $0.0504/vCPU-h, $0.0162/GiB-h | $200 credit | n/a | "Network limits" | Computer use |
| [Modal](https://modal.com/pricing) | gVisor (not verified on page) | Wall clock | Sandbox $0.00003942/core-s (≈3× standard) | $30/mo credit | n/a | n/a | Custom image |
| [Cloudflare Sandbox SDK](https://developers.cloudflare.com/sandbox/) 1.0.1 | microVM per container | Active CPU, provisioned memory | $0.000020/vCPU-s, $0.0000025/GiB-s ([pricing](https://developers.cloudflare.com/containers/pricing/)) | Workers Paid $5 incl. 375 vCPU-min, 25 GiB-h | n/a | `enableInternet: false`, credentials stay in the Worker | Not stated; needs a Worker + Durable Object architecture |
| [Fly Machines](https://docs.fly.io/about/pricing) | Firecracker | Per second while running | shared-cpu-2x 2 GB $0.0186/h | No free tier | Unlimited | Self-built | Self-built image |
| [Fly Sprites](https://fly.io/sprites) | Not stated | **Used** CPU and memory | $0.0385/CPU-h, $0.021875/GB-h | $30 trial; Hero $100/mo | Sleep/wake | Not described on page | Self-installed |

Notes. Fly's own (vendor) comparison prices 100 sandbox-hours at 2 vCPU/4 GB, 25% busy, at
$14.88 on Vercel, $16.56 on E2B/Daytona and $5.21 on Sprites
([Fly](https://fly.io/learn/ai-sandbox-pricing/)). Vercel's own estimate for a 30-minute
4 vCPU/8 GB build-and-test is $0.11. The Daytona repo README says core development "moved to a
private codebase" in June 2026 ([repo](https://github.com/daytonaio/daytona)). The cloud service
continues, but the self-host escape hatch is gone. Anthropic's
[sandbox-runtime](https://github.com/anthropic-experimental/sandbox-runtime) (Apache-2.0,
2026-10-16) is bubblewrap on the same kernel. It is good as an immediate hardening layer on the
worker, but not as the long-term boundary. Claude Managed Agents (beta header
`managed-agents-2026-04-01`) hosts loop and sandbox
([overview](https://platform.claude.com/docs/en/managed-agents/overview)). It would bypass
North's in-process `PreToolUse` gate and audit, so keep it as a later adapter, as ADR 0004
already says.

**Pick for dev under $100/month: Vercel Sandbox on a North Pro team.** It brings microVM isolation
and Active-CPU billing (the agent mostly waits on the model), and brokering keeps the Anthropic
key out of the VM. Snapshots with Node 24, pnpm, Chromium and the vendored skills preinstalled
cut cold starts. It is also the same vendor as the deploy target. Expected sandbox spend is $3-8 a
month inside the $20 Pro credit. Fallback: E2B Hobby (the one-time $100 credit covers about 600
2 vCPU/4 GiB hours) behind the same `SandboxProvider` interface.

### 4. Stack for the generated landing page

- **Next.js 16.4.2** (npm, 2026-10-15) is the default. The same codebase grows into the full app.
  `next dev` writes the managed `AGENTS.md` block, exposes `/_next/mcp` (`get_compilation_issues`,
  `compile_route`) and forwards browser console errors to the terminal, so the agent can verify
  its work without a full build ([Next.js](https://nextjs.org/docs/app/guides/ai-agents)).
  Pages can be fully static. North already pins Next 16.4.1 for its own web app, so the stack
  knowledge is shared.
- **Astro 7.4.0** is the alternative for pure-content sites. Cloudflare acquired the team on
  2026-01-16; it stays MIT
  ([BusinessWire](https://secure.businesswire.com/news/home/20260116386991/en/Cloudflare-Acquires-Astro-to-Accelerate-the-Future-of-High-Performance-Web-Development)).
  It is not the default because the full app would need a second stack. **Plain static HTML**
  stays only as the sandbox-mode fixture.
- **Tailwind CSS 4.3.3** (`@theme` tokens from the brand kit), **shadcn 4.21.5** (source copied
  into the repo; skill + `components.json`) and **Motion 14.3.0** (all MIT, npm 2026-10-16).
- **Deploy to the user's Vercel.** Create the project linked to the user's GitHub repo, or use
  `gitSource` on `POST /v13/deployments` with `framework: "nextjs"`, so Vercel builds remotely;
  inline `files` "cannot be used together with `gitSource`"
  ([API](https://vercel.com/docs/rest-api/reference/endpoints/deployments/create-a-new-deployment)).
  Previews may sit behind Standard Protection, which covers every non-production URL. The
  verifier must send `x-vercel-protection-bypass` with a per-project automation secret (all
  plans) ([bypass](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation),
  [protection](https://vercel.com/docs/deployment-protection)). If the user is on Hobby, a
  commercial landing page breaches Vercel's fair-use terms; the onboarding should say so.
- **Waitlist backend, option A (default): the user's own Supabase.** North's OAuth app uses
  `https://api.supabase.com/v1/oauth/authorize` with PKCE. Scopes are fixed on the app
  (`Database:write` covers "Create a SQL query"; `Projects:write` covers project creation)
  ([integration](https://supabase.com/docs/guides/integrations/build-a-supabase-integration),
  [scopes](https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration/oauth-scopes)).
  The Management API paths `/v1/projects/{ref}/database/migrations` and `/database/query`
  (+ `/read-only`) exist in supabase-mcp 0.14.0's typed client
  ([repo](https://github.com/supabase-community/supabase-mcp)). The schema is a `waitlist` table
  (email citext unique, source, utm, created_at), RLS on, `anon` may INSERT only, no SELECT, and
  the write goes through a Next.js server action. Rate limit: 120 req/min per user per project.
  Risks: two free projects per account
  ([billing](https://supabase.com/docs/guides/platform/billing-on-supabase)), and free projects
  pause after 7 idle days (secondary sources only, e.g.
  [jetadmin](https://www.jetadmin.io/blog/supabase-pricing-2026-guide-to-plans-limits-and-real-world-costs/)).
  A paused project silently breaks the form, so North's daily health check must submit a test
  signup.
- **Waitlist option B (no database):** the user's Resend account, `POST https://api.resend.com/contacts`
  (only `email` is required; segments optional)
  ([Resend](https://resend.com/docs/api-reference/contacts/create-contact)). North already has a
  Resend adapter. It is the fallback when the user will not connect Supabase.
- **Evidence for the waitlist (worker-side, not agent-side):** (1) the preview GET returns 200
  with the bypass header; (2) a Playwright submit of `waitlist+<taskShortId>@<north test domain>`
  shows the success state; (3) a `database/query/read-only` call (or a Resend contact lookup)
  finds exactly that row; (4) the test row is marked `source='north_verifier'` and excluded from
  metrics. This is Lovable's lesson: 170 of 1,645 scanned apps had broken RLS (CVE-2025-48757,
  secondary source: [unicoconnect](https://unicoconnect.com/blogs/supabase-rls-security-checklist)).
  So the verifier also asserts that an `anon` SELECT on `waitlist` returns nothing.

### 5. Long-running coding harness

Anthropic, Nov 2025: an initializer writes `init.sh`, `claude-progress.txt`, a first git commit
and a JSON feature list (each entry has category, description, test steps, `passes: false`).
"JSON because the model is less likely to inappropriately overwrite it". Coding sessions start
with `pwd`, the progress file, git log, the feature list and a smoke test, then do one feature,
test it as a user would and commit. The reference code is
[claude-quickstarts/autonomous-coding](https://github.com/anthropics/claude-quickstarts/tree/main/autonomous-coding)
(MIT, 2026-10-07), with a bash allowlist hook and `sandbox: { enabled: true }`.

Anthropic, Mar 2026: a planner expands the brief; the generator and evaluator agree a "sprint
contract" (Sprint 3 had 27 criteria). The evaluator uses Playwright MCP to click through,
screenshot and score **design quality, originality, craft, functionality**, weighting the first
two. With Opus 4.5+ the sprints and context resets were dropped in favour of SDK auto-compaction;
the planner stayed ("without it the generator under-scoped"). Lesson: "every harness component
encodes an assumption about what the model can't do alone".

How North should configure the Agent SDK for this (all options verified in the TS reference):
`settingSources: []`; `plugins: [{type:"local", path:"<snapshot>/skills/north-engineering"}]`;
`skills: [<persona allowlist>]`; and
`sandbox: { enabled: true, allowUnsandboxedCommands: false, network: { allowedDomains: [...] } }`
for the worker-local fallback. Further options: `agents: { evaluator, reviewer }` (an
`AgentDefinition` takes `tools`, `model`, `skills`, `maxTurns`, `effort`);
`hooks: { PreToolUse: audit+gate, PostToolUse: stream step/screenshot events, Stop: run gates }`;
`includePartialMessages: true` for the live work view; `maxBudgetUsd` per persona;
`persistSession` with a `SessionStore` so Inngest retries resume; `enableFileCheckpointing`
for rewinds; and `spawnClaudeCodeProcess` to run the CLI in the sandbox. In `env`, set
`CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` and a per-task `CLAUDE_CONFIG_DIR`; the docs list both for
multi-tenant isolation.

### 6. Quality gates for generated code (versions from npm, 2026-10-16)

| Gate | Tool | License | Pass bar for a landing page |
| --- | --- | --- | --- |
| Types, lint, build | `tsc --noEmit`, ESLint CLI (`next lint` is gone in 16), `next build` | — | Zero errors |
| Unit / component | Vitest | MIT | Waitlist action validated with Zod; duplicate email handled |
| End-to-end | `@playwright/test` 1.64.1 | Apache-2.0 | Hero, CTA, submit, success, error, mobile nav at 375/768/1440 |
| Accessibility | `@axe-core/playwright` 4.14.0 | MPL-2.0 | 0 serious or critical violations |
| Performance, SEO | `lighthouse` 13.5.0 run directly | Apache-2.0 | Mobile perf ≥ 90, a11y ≥ 95, SEO ≥ 95, CLS < 0.1. `@lhci/cli` 0.15.1 dates from 2025-06-25 and pins lighthouse 12.6.1, so assert scores in North code instead |
| Design anti-patterns | `impeccable detect --json` | Apache-2.0 | No high-severity findings |
| Links | `linkinator` 8.1.0 (MIT) or `lychee` (Apache-2.0, 2026-10-13) | — | No broken internal links; external links checked against the allowlist |
| Visual regression | Playwright `toHaveScreenshot` ([docs](https://playwright.dev/docs/test-snapshots)) | — | Baselines generated in the same sandbox image (render differs across OS); used for fix tasks, not first builds |
| Security | `pnpm audit`, ToB `supply-chain-risk-auditor`, RLS probe | — | No critical advisories; anon SELECT denied |

### 7. Comparable products: how they get good output and what they verify

| Product | How it gets quality | What it verifies |
| --- | --- | --- |
| v0 (Vercel) | Composite pipeline: RAG over docs/examples, a frontier base model, Quick Edit, streaming `vercel-autofixer-01` + linter. 93.87% error-free vs 78.43% for Claude 4 Opus alone (2025-06-01) ([blog](https://vercel.com/blog/v0-composite-model-family)) | That the code compiles and is lint-clean while streaming |
| Lovable | Vitest + RTL frontend tests, Deno edge tests, browser testing with screenshots, console and network capture ([testing](https://docs.lovable.dev/features/testing)) | Quick security scan on every publish (RLS, dependencies, unauthenticated MCP); Deep scan on demand; admins can block publish on critical issues ([security](https://docs.lovable.dev/features/security)) |
| Replit Agent | "App Testing": the agent clicks through in a real browser and records a replayable video; it decides when to test ([docs](https://docs.replit.com/core-concepts/agent/app-testing)) | UI, flows, integrations, basic a11y/perf; full-stack JS and Streamlit only |
| Bolt.new | Full stack in the browser via WebContainers (secondary: [morphllm](https://www.morphllm.com/bolt-vibe-coding)); the open-source [repo](https://github.com/stackblitz/bolt.new) has been idle since 2024-12-17 | Dev server boots; no published verification step found |
| Polsia | Agent SDK loops; hosts sites on `<slug>.polsia.app` (Next.js + Tailwind + Prisma) (`docs/research/polsia-teardown.md`) | Little: 41 of 47 tasks marked "done" with about 21% real success (cto.new, per the teardown) |

The pattern that works is a separate verifier with real browser evidence and a security scan
before going live. North adds what none of them has: evidence the platform re-checks on its own
before a task can be done, and live deploys gated behind K2.

## Recommendations for North (ranked)

1. **Close the isolation gap now (one small PR, before any live Claude run).**
   - In `packages/agents/src/runtime/claude-agent-sdk.ts`, add `sandbox: { enabled: true,
     failIfUnavailable: true, allowUnsandboxedCommands: false, network: { allowedDomains:
     ["registry.npmjs.org"] } }` for engineering.
   - Route model calls through `ANTHROPIC_BASE_URL` to a worker-local proxy that injects the key,
     and drop `ANTHROPIC_API_KEY` from `SUBPROCESS_ENV_ALLOWLIST` for that role.
   - Add a Vitest test proving the key is absent from the Bash environment (tag it DEC/AGT per
     SPEC).
2. **Add a `SandboxProvider` in `packages/integrations`** (`sandbox/local-process.ts` for tests,
   `live/vercel-sandbox.ts`, `live/e2b-sandbox.ts`). Its interface: `create(snapshotId, policy)`,
   `exec`, `writeFiles`, `readFiles`, `exposePort`, `stop`.
   - In `apps/worker`, start one sandbox per engineering task from a pinned snapshot (Node 24,
     pnpm, Chromium, agent-browser 0.39.1, impeccable, `skills/` tree).
   - Run the CLI through `spawnClaudeCodeProcess`. Spike first: if stdio streaming fails, fall
     back to North MCP tools (`sandbox_exec`, `sandbox_write`) with built-in Bash disabled.
   - Network policy: npm registry, Google Fonts, and `api.anthropic.com` with the key brokered
     through `transform`. GitHub, Vercel and Supabase stay out: those calls go through the
     worker's gated adapters, so non-negotiable 1 holds.
   - The kill switch (`services/kill-switch.ts`) calls `sandbox.stop()` and aborts the query.
3. **Vendor skills with a lockfile.**
   - Folder layout: `skills/vendor/<owner>__<repo>@<sha>/...`, plus North-authored skills in
     `skills/north/`.
   - `skills/LOCK.json` records repo, commit SHA, SPDX license, a sha256 per file, and the
     "modified" flag (it must be false for CC-BY-SA content).
   - `scripts/skills-verify.ts` joins `pnpm validate`. It fails on hash drift or on a license
     outside {MIT, Apache-2.0, CC-BY-4.0, CC-BY-SA-4.0 unmodified}, and runs Sentry's
     `skill-scanner` rules.
   - Build a local plugin per persona (`.claude-plugin/plugin.json`) and load it with
     `plugins` + `skills`. Report the loaded skills from the `init` message to the live work view.
4. **Replace single-shot `build_site` with a harness of four Inngest steps**
   (`apps/worker/src/inngest/functions.ts`, new `services/build-harness.ts`). They are: plan, then
   build loop (one feature per session, until all `passes: true` or the budget runs out), then
   evaluate, then fix (at most 2 rounds, per AGT-3), then gates, then the existing pipeline.
   State lives in the repo (`feature_list.json`, `PROGRESS.md`, `init.sh`) and in `agent_runs`.
   Give `task-guides.ts` a `build_site_next` guide and keep the static guide as a fixture.
5. **Fix the delivery path.**
   - `workspace.ts`: allow binary assets (png, jpg, webp, avif, ico, woff2) as base64 and raise the
     limits for engineering. Better still, have the sandbox produce a git bundle that the worker
     pushes.
   - `github.ts`: send `encoding: "base64"` for binary blobs.
   - `vercel.ts`: add `ensureProject` (framework `nextjs`, git link), `gitSource` deploys and
     `bypassSecret()`.
   - `verifier.ts`: send the bypass header only for the project's own `*.vercel.app` hosts, and
     add `verifyWaitlist()`.
6. **Make `test_report` real evidence.** The worker runs the gates in Section 6 inside the sandbox
   and stores `gates.json` + screenshots as an artifact (Supabase Storage). `verifyEvidence`
   (`case "test_report"`) then loads that artifact and checks every gate passed for the deployed
   commit SHA. An agent-written report alone never counts.
7. **Add a `SupabaseProvider`** (`packages/integrations/src/live/supabase.ts` + sandbox twin):
   OAuth with PKCE in `services/oauth-providers.ts`, and `ensureProject`, `applyMigration`,
   `queryReadOnly`. Tiers: create a table in an existing project = K1; create a project = K1 on
   the free plan, K2 if the org is paid. Fallback: a `waitlist.provider: resend` option.
8. **Split Engineering into the personas below**: extend `packages/agents/src/roles/schema.ts`
   with `skills`, `effort`, `persona` and `evidence`, and add `agents/engineering/*.yaml`.
   The evaluator gets a fresh context and no write tools.
9. **Variants without 3× cost.** Build one site, then have the frontend engineer produce 2-3
   theme/hero variants as `variant/a|b|c` branches with separate preview deploys. The CEO picks in
   the review queue, which does not touch the 3-card quota.

### Personas

| Persona | Model / effort / budget (start values) | Skills (vendored) | Tools | Outputs | Evidence of done | Tier |
| --- | --- | --- | --- | --- | --- | --- |
| Tech Lead (planner) | Opus 5.5, high, $0.75 | superpowers `writing-plans`; mattpocock `to-tickets`, `codebase-design`; North `landing-recipe` | memory.search, fs.read, artifacts.write | `BuildPlan` (feature_list.json, sprint contract, init.sh) | Plan artifact validated by Zod, every feature has test steps | K0 |
| Frontend Engineer (generator) | Sonnet 5.5, medium→high, $3.00 | `frontend-design`, impeccable, `react-best-practices`, `composition-patterns`, shadcn, `next-dev-loop`, superpowers TDD + `verification-before-completion` | fs.*, bash (sandbox), agent-browser, playwright-cli | Commits on `build/<shortId>` | All features `passes: true`, gates green locally | K0 in sandbox; push K1 via worker |
| Backend Engineer (waitlist, later the app API) | Sonnet 5.5, medium, $1.00 | `supabase`, `supabase-postgres-best-practices`, ToB `insecure-defaults` | fs.*, bash (sandbox), North MCP `supabase_apply_migration` / `supabase_query_readonly` (gated) | Migration, server action, env wiring | Migration listed by API; RLS probe passes; synthetic row found | K1 (table); K2 (paid project) |
| QA Engineer (evaluator) | Sonnet 5.5, high, $1.00; fresh context, read-only fs | agent-browser `dogfood`, `webapp-testing`, `web-quality-audit`, `accessibility`, `core-web-vitals` | agent-browser, playwright-cli against the preview (bypass header) | `TestReport` with scores on design quality / originality / craft / functionality + bugs | Every sprint-contract criterion scored with a screenshot; gates JSON attached | K0 |
| Code & Security Reviewer | Opus 5.5, medium, $0.75 | superpowers `requesting-code-review`; mattpocock `code-review`; Sentry `find-bugs`, `security-review`; ToB `differential-review`, `supply-chain-risk-auditor`; pr-review-toolkit `silent-failure-hunter` | fs.read, git diff | `ReviewReport` | No open high-severity finding; reviewer cannot approve its own fixes | K0 |
| Release (deterministic worker code, not an LLM) | — | — | GitHub/Vercel/Supabase adapters | PR, preview, go-live card | Preview 200 + gates for the same SHA; production only after the K2 card | K1 preview, K2 production |

### Budget (estimates from published prices; to be replaced by `agent_runs` measurements)

Prices from the [official page](https://platform.claude.com/docs/en/about-claude/pricing): Opus 5.5
$4/$20 per MTok, cache hit $0.20. Sonnet 5.5 $2/$10, cache hit $0.10. Haiku 5.5 $0.10/$0.50.

- **One landing build: about $4.5.** Plan $0.3, build $2.3 (around 60 turns, ~3M cache-read,
  ~200K cache-write and ~150K output tokens), QA $0.75, review $0.3, one fix round $0.8. The same
  build with an Opus generator comes to about $7.
- **Per-change CI tier** (real Claude, sandboxed outside world): a micro fixture such as "change
  headline, add FAQ item" on Sonnet at low effort, capped at 15 turns, $0.15-0.30 per run.
- **Month in dev:** 80 change runs ($20) + 4 acceptance builds ($18) + sandbox ($5), about $43.
  That leaves room for Higgsfield and the other departments under $100. Set the hard cap through
  the existing budget guard: $6 per build, $1 per change run.

## Risks

- **Stdio bridging to a remote CLI is unproven** on Vercel Sandbox and E2B. If it fails, the
  fallback is custom MCP tools, which loses built-in `Edit`/`Bash` ergonomics and skills that
  run shell injections (`!` lines).
- **Vendor concentration.** Sandbox, hosting and the preview verifier would all be Vercel. The
  provider interface and the E2B adapter are the hedge.
- **Plan terms.** Vercel Hobby forbids commercial use, for both North's own sandbox account and
  the user's deployments. Supabase free projects pause and are limited to two.
- **Skill supply chain.** Skills are instructions. A vendored update can change agent behaviour
  as much as a code change can. The impeccable binary download and telemetry, unpinned
  `npx shadcn@latest`, and the run-time fetches in Supabase's and Vercel's guideline skills all
  need overrides.
- **License traps.** CC-BY-SA ShareAlike (Trail of Bits) and the proprietary `claude-security`.
  The Agent SDK itself is "SEE LICENSE IN README" (Anthropic commercial terms).
- **The evaluator can be lenient or flaky.** Anthropic notes self-evaluation skews positive.
  Screenshot baselines differ across OS. Gate on deterministic checks first and use LLM scores
  only to rank.
- **Cost runaway.** The full harness pattern cost Anthropic $124-200 per app. Without per-persona
  `maxBudgetUsd` and an Inngest-level cap, a looping fix round can consume the monthly budget.
- **Freshness.** Lighthouse CI lags Lighthouse by a major version. Next.js agent features need
  16.3+. Skills pinned now will age, so schedule a monthly vendor-bump PR reviewed by
  `north-security-reviewer`.

## Open questions for the founder

1. May North run a Vercel Pro team ($20/month, includes $20 of usage) for engineering sandboxes,
   outside the $100 Claude + Higgsfield budget? Or start on E2B Hobby's one-time $100 credit?
2. Should the waitlist default to the user's own Supabase (one more connection to make, but it
   grows into the app's database), or to Resend Contacts (simpler, no database)?
3. May North create a Supabase project in the user's account? It uses one of their two free
   slots. Notify-only (K1), or a decision card (K2)?
4. Next.js as the single default even for pure landing pages, with Astro excluded this phase?
5. May the agent add npm packages freely? Proposal: an allowlist (Next, React, Tailwind, shadcn
   deps, Motion, Zod, supabase-js), with anything else raised to the reviewer.
6. Engineering's control-dial default: Autopilot up to the preview, with the variant pick in the
   review queue and production always K2?
7. When the user's Vercel is on Hobby, should North warn once (a review-queue note), or block
   going live until they upgrade?

## Sources

- Repo files: `agents/engineering.yaml`, `packages/agents/src/runtime/{claude-agent-sdk,workspace,tool-policy}.ts`, `packages/agents/src/prompts/task-guides.ts`, `packages/integrations/src/live/{github,vercel}.ts`, `apps/worker/src/services/{build-pipeline,verifier}.ts`, `packages/core/src/tasks/types.ts`, `docs/research/polsia-teardown.md`, `docs/research/stack-decisions.md`
- Skills: https://github.com/obra/superpowers · https://github.com/mattpocock/skills · https://github.com/anthropics/skills · https://github.com/anthropics/claude-plugins-official · https://github.com/pbakaus/impeccable · https://impeccable.style · https://github.com/vercel-labs/agent-skills · https://github.com/vercel-labs/web-interface-guidelines · https://github.com/vercel-labs/next-skills · https://github.com/vercel/next.js/tree/canary/skills · https://github.com/shadcn-ui/ui · https://github.com/supabase/agent-skills · https://github.com/supabase-community/supabase-mcp · https://github.com/addyosmani/web-quality-skills · https://github.com/addyosmani/agent-skills · https://github.com/getsentry/skills · https://github.com/trailofbits/skills · https://github.com/trailofbits/skills-curated · https://github.com/vercel-labs/agent-browser · https://github.com/microsoft/playwright-cli · https://github.com/microsoft/playwright-mcp · https://github.com/wshobson/agents
- Harness and SDK: https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents · https://www.anthropic.com/engineering/harness-design-long-running-apps · https://github.com/anthropics/claude-quickstarts/tree/main/autonomous-coding · https://code.claude.com/docs/en/agent-sdk/skills · https://code.claude.com/docs/en/agent-sdk/typescript · https://code.claude.com/docs/en/agent-sdk/hosting · https://code.claude.com/docs/en/agent-sdk/secure-deployment · https://github.com/anthropic-experimental/sandbox-runtime · https://platform.claude.com/docs/en/managed-agents/overview · https://platform.claude.com/docs/en/about-claude/pricing
- Sandboxes: https://vercel.com/docs/sandbox/pricing · https://vercel.com/docs/sandbox/concepts · https://vercel.com/docs/sandbox/concepts/firewall · https://e2b.dev/pricing · https://docs.e2b.dev/network/internet-access · https://www.daytona.io/pricing · https://github.com/daytonaio/daytona · https://modal.com/pricing · https://developers.cloudflare.com/sandbox/ · https://developers.cloudflare.com/containers/pricing/ · https://docs.fly.io/about/pricing · https://fly.io/sprites · https://fly.io/learn/ai-sandbox-pricing/
- Stack and deploy: https://nextjs.org/docs/app/guides/ai-agents · https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals · https://vercel.com/docs/rest-api/reference/endpoints/deployments/create-a-new-deployment · https://vercel.com/docs/deployment-protection · https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation · https://vercel.com/docs/plans/hobby · https://secure.businesswire.com/news/home/20260116386991/en/Cloudflare-Acquires-Astro-to-Accelerate-the-Future-of-High-Performance-Web-Development · npm registry (`next`, `astro`, `tailwindcss`, `shadcn`, `motion`, `@playwright/test`, `@axe-core/playwright`, `lighthouse`, `@lhci/cli`, `linkinator`, `@vercel/sandbox`, `e2b`, `@cloudflare/sandbox`, `agent-browser`, `impeccable`, `@anthropic-ai/claude-agent-sdk`), read 2026-10-16
- Waitlist: https://supabase.com/docs/guides/integrations/build-a-supabase-integration · https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration/oauth-scopes · https://supabase.com/docs/guides/platform/billing-on-supabase · https://www.jetadmin.io/blog/supabase-pricing-2026-guide-to-plans-limits-and-real-world-costs/ (secondary) · https://resend.com/docs/api-reference/contacts/create-contact · https://unicoconnect.com/blogs/supabase-rls-security-checklist (secondary)
- Quality gates: https://playwright.dev/docs/test-snapshots · https://github.com/GoogleChrome/lighthouse-ci · https://github.com/dequelabs/axe-core · https://github.com/lycheeverse/lychee · https://github.com/JustinBeckwith/linkinator
- Comparables: https://vercel.com/blog/v0-composite-model-family · https://docs.lovable.dev/features/testing · https://docs.lovable.dev/features/security · https://docs.replit.com/core-concepts/agent/app-testing · https://github.com/stackblitz/bolt.new · https://www.morphllm.com/bolt-vibe-coding (secondary)
