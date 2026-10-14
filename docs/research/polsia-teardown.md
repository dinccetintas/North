# Polsia teardown (evidence-backed)

Date: 2026-10-14. Method: REA (`morluto/rea` v6.5.0) browser scenarios against
`polsia.com` (landing, /login, /new, /live) with network bodies retained, plus the
captured production bundle `assets/index-qIk1zfcz.js` (3.6 MB) and stylesheet
`assets/index-BKBWcDqw.css` (722 KB), the `PolsiaAI/Polsia` reference repo, four
independent reviews, three walkthrough videos and the founder interview.

Scenario files and the script manifest live in `docs/evidence/`. Raw captures
(≈560 KB each) are in the session scratchpad and are reproducible with
`rea capture-browser-scenario docs/evidence/rea-scenario-landing.json --json`.

## 1. What Polsia is

- Pitch: "AI That Runs Your Company While You Sleep". One company per idea,
  agents plan, ship code, run ads, reply to customers, send cold email, tweet.
- Launched Feb 2026 by Ben Cera (solo founder). $30M raised at $250M (May 2026).
  Own claims: 484k companies created, 29k active (≈6%), $18.7M ARR (Sep 2026).
  Founder-stated: ~10% of companies ever made $1; month-one churn ≈50%.
  Sources: preuve.ai review (2026-10-14), nanocorp.so, cto.new, marcabraham.com.
- Runtime (founder interview + GitHub org README): agents in loops on the Claude
  Agent SDK, MCP integrations, shared persistent memory per company. Reference
  repo `PolsiaAI/Polsia` (FastAPI + Celery + Next.js 14) shows the older shape:
  9 agents (orchestrator, social, competitor research, business planning, email
  outreach, customer support, ads, code generation, finance), each a
  `claude -p --output-format json` subprocess; morning cycle 06:00 UTC, evening
  cycle 20:00 UTC, sweeps every 2h/3h/6h; 15 tables; `SANDBOX_MODE=true` default.

## 2. Public surface we observed

Frontend is a Vite/React SPA (no `__NEXT_DATA__`). Routes extracted from the bundle:

| Route | Purpose |
| --- | --- |
| `/` | Landing: dark office photo hero, serif headline, orange ticker "POLSIA WORKS ON THOUSANDS OF COMPANIES AT ONCE", a fake terminal log strip (`> Deploying marketing campaign...`), one CTA "GET STARTED", "NO CREDIT CARD REQUIRED · FREE TO START" |
| `/login` | "Continue with Google" or magic link ("No password needed") |
| `/new`, `/new/site` | Create company: "start from scratch" / "surprise me" / "grow my existing business (enter website)" |
| `/dashboard/:companySlug` | The company room |
| `/companies` | Portfolio of companies |
| `/connect`, `/settings/vault`, `/settings/browser/...` | Integrations, secrets vault |
| `/usage/details`, `/fund`, `/payment/*`, `/subscription/*`, `/redeem/task-credits/:token` | Billing, credits |
| `/join/:uuid` | Team invite |
| `/live`, `/changelog`, `/faq`, `/guides`, `/help`, `/about`, `/terms`, `/privacy`, `/acceptable-use`, `/subprocessors` | Public pages |
| `/admin/**` (80+ routes) | Internal ops: control panel (core/business/product/cost/pods/growth/organic/retention), engineering-v2 (health, incidents, modules, templates, module-drift, failed-upgrades, deadloop, app-crons, demand-signals), cycles, workflows/executions, work-items, moderation, costs, support cases |

`/live` currently renders the landing page (route exists in the bundle but the feed
was not served to an anonymous visitor on 2026-10-14).

## 3. API map (from the bundle, `/api/v2/...`)

Grouped by concern. This is the clearest statement of Polsia's feature set.

- **Company**: `companies`, `companies/:id/dashboard-layout`, `mood`,
  `terminal/logs`, `streams/company/:id/events` (SSE), `code-exports`,
  `company-assets`, `company-documents`, `media/autogen`, `faces`.
- **Tasks / work items**: `tasks` (`?status=todo,in_progress,queued`),
  `tasks/plan`, `tasks/recurring`, `tasks/ultra-fix`, `task-notifications`,
  `task-feedback`, `work-items/:id` (`dispatch`, `undo-run`, `recurrence`,
  `reorder`), portfolio variants (`tasks/portfolio`, `reports/portfolio`,
  `documents/portfolio`, `email/portfolio`, `twitter/portfolio`,
  `website/portfolio`, `analytics/portfolio`, `portfolio/moods`).
- **Autonomy ("God mode")**: `companies/:id/auto/start|stop|status`.
- **Chat**: `chat/companies/:id/conversations`, `conversations/:id/messages`,
  `turns/:turn`, `attachments`, `transcriptions`, `proactive-greeting`,
  `streams/chat/:id/events`.
- **Inbox / support / outreach / newsletter**: `inbox/threads/:id/reply`,
  `inbox/sending-domain`, `support-inbox/{start,pause,run-now,custom-prompt}`,
  `outreach/{start,pause,run-once,frequency,prospects,stats,status,custom-prompt,
  retry-domain-verification}`, `newsletter/*`.
- **Social**: `twitter/{start,pause,frequency,tweet-once,tweets,custom-prompt,
  media-opt-in}`, `instagram/{posts,story,reel,...}`, `pinterest`, `reddit/settings`,
  `google-business/advisor-*`.
- **Ads**: Meta `ads/{budget,start-campaign,pause,resume,recover,spend-history,
  activity,status,geo,creative-settings,resume-operations}`, `google-ads/*`.
- **Money**: company-side Stripe `payments/{overview,transactions,:id/refund,
  subscriptions}`; platform billing `billing/{tier-plans,checkout,credit-packs,
  credits/history,auto-topup,usage/summary,usage/prices,entitlements,offer,
  billing-portal,recurring-items}`, `subscription/{add-company,
  buy-task-credits-oneoff,update-task-tier,quantities}`.
- **Hosting**: `hosted-apps/{crons,db-export,redeploy}`, `hosted-app-secrets`,
  `company-domain/{purchase-sessions,add-custom-domain,dns-records,...}`.
- **Account**: `me/{profile,country,language,messaging}`, `personal-assistant`,
  `personal-vault`, `personal-accounts`, `slack/personal/*`, `microsoft/*`,
  `account-erasure`, `email-preferences`, `email-suppression`, `referral`.
- **Growth plumbing**: `onboarding-funnel/{start,claim,drafts}`,
  `quick-start/save-idea`, `track/*`, `ad-conversions/applovin/*`, `waitlist`.

Infra seen in requests: PostHog (`e.polsia.com`), Sentry, Meta Pixel, TikTok
Pixel, Google Ads, AppLovin, Cloudflare. Hosted companies run on
`<slug>.polsia.app` (Next.js + Tailwind + Prisma per the sponsored walkthrough;
Neon + Render + Expo per the Terms).

## 4. Design system (from `index-BKBWcDqw.css`)

- Fonts: `--polsia-font-display: "Editorial Old"` (PP Editorial Old), `--polsia-font-body:
  "Editorial New"`, `--polsia-font-mono: "Suisse Mono"`, plus `BlackletterBit`
  for ornaments. Mono labels are 11px, uppercase, `letter-spacing: 0.06em`.
  Body 16-20px serif; H2 ≈36px serif regular.
- Colors: black `#000`, white `#fff`, grays `#1a1a1a #555 #6a6a6a #888 #aaa #ccc
  #ddd #e5e5e5 #fafafa`; accent "deep" orange `#e65100`; success `#2e7d32`; error
  `#c62828`; warning `#f97316`; link `#2383e2`; status scale (positive/caution/
  warning/danger) with pale backgrounds. Dark mode inverts bg/text; terminal is
  always black on white text.
- Shape: `--polsia-radius-none: 0`, `--polsia-radius-sm: 2px`, hairline 1px
  borders, buttons with a subtle vertical gradient and inset highlight (retro
  desktop feel), `polsia-ascii-spinner`, `retro-chat-dot-blink`, `task-card-pulse`,
  `auto-mode-pulse` animations. Breakpoints: 480/640/768px (+52rem/48rem).
- Feel: 1990s terminal + editorial magazine. Dense, monochrome, one accent.

## 5. The product loop as users experience it

1. Sign in (Google / magic link). Free; two task credits.
2. `/new`: describe idea, or "surprise me", or paste existing website.
3. A terminal streams what the agent is doing ("locked in"). Within ~10 minutes:
   company name, mission statement, market research + competitor map, landing
   page on `<slug>.polsia.app`, company inbox + welcome email, a drafted tweet.
4. Dashboard with eight simultaneous panels: tasks, X, email, documents,
   business, team, website, ads; terminal on top; chat on the right.
5. Three queued tasks (e.g. build onboarding portal, competitive analysis, cold
   outreach to 10 agencies). Clicking a task spends one credit and runs it
   immediately with no confirmation.
6. Nightly cycle: one autonomous task per night included; "Auto/God mode" runs a
   plan-execute-plan loop for 1h-7d ($19/h, cheaper per hour the longer it runs).
7. "Run ads" is one button + a daily budget; Meta Ads through Polsia's shared ad
   account funded by credits/prepaid balance.
8. Pricing (Oct 2026): Standard $20 (1 company, 20 credits), Pro $50 (3 companies,
   50 credits, Meta Ads), Max $100-200 (10 companies); 3% platform fee on customer
   payments, 20% on ad spend; revenue lands in a Polsia balance first.

## 6. Documented failure modes (what North must not repeat)

| Failure (source) | North requirement that prevents it |
| --- | --- |
| No validation step: builds and publicly posts before anyone checks demand (preuve.ai) | ONB-1 clarification questions; Research agent produces a demand check before any K2 action; first public post is a K2 card |
| Tasks marked complete that never deployed; 41/47 "done" with ~21% real success (cto.new) | AGT-2 evidence-only done; verifier re-checks URLs/deploy IDs |
| Credit burn on failed/duplicate actions (Trustpilot via reviews) | AGT-3 two attempts then escalate; cost per task recorded in ledger; budget caps |
| Unapproved outreach in the user's name; cold emails to journalists; posts from the platform's X account during free onboarding (preuve.ai, Trustpilot) | K2 tier for any first contact / public statement; nothing external before a card is answered; no platform-owned social accounts |
| Infra lock-in, code lost after cancellation (cto.new, Trustpilot) | EXP-1 repo in the user's GitHub from day one; data export; 90-day retention |
| Attention overload: hundreds of suggestions, dashboards with eight live panels | Decision quota (3 cards/day), briefing as the home screen, no mandatory chat |
| Platform holds the money, 20% of ad spend (ToS) | Spend only from the user's own accounts; platform never custodies revenue |

## 7. What we deliberately keep from Polsia

- The onboarding speed: first tangible output (market report + landing preview)
  within 24 hours, visible progress via a live terminal/activity stream.
- One place that shows every role working (team view with the last 24h of actions).
- Magic-link + Google sign-in, no passwords.
- A monochrome editorial aesthetic with one accent color and mono labels.
- Portfolio mode (many companies, one briefing) in V2 (MULTI-1).
- A public, shareable company page (opt-in, off by default).
