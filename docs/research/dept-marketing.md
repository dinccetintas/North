# Marketing department: research and recommendations (2026-10-16)

Scope: make North's Marketing department world class across Meta ads + Instagram, TikTok short
video, YouTube (with vidIQ), SEO and LinkedIn/X organic, inside a dev budget under $100/month.
Every claim carries a source number; the list is at the end. "Secondary" marks a third-party
source; "unverified" marks something I could not confirm from a primary source.

## Summary

1. **Higgsfield is two separate products.** The **Higgsfield API** uses a key ID plus a secret,
   runs server-side only, bills pay-as-you-go, has an estimate endpoint and webhooks, and keeps
   outputs for at least 7 days [1][2][3][4]. The **Higgsfield MCP** (`https://mcp.higgsfield.ai/mcp`)
   signs in with OAuth and spends the user's plan credits. Unlimited plans and free generations
   never apply through MCP, the CLI or other automation [7][8][9].
2. **No documented Higgsfield-to-Meta workflow exists.** Ads Studio makes *static* ads only
   (4 credits each, up to 20 per product per run), and you upload them to the ad platform
   yourself [14]. The MCP has no Meta tool [16]. North's value is closing that loop:
   generate, store, upload to Meta, create the ad paused, preview, then a K2 card to go live.
3. **Higgsfield's terms block the "North credits" trial plan as designed.** You own your outputs
   and may sell them [11]. But the terms forbid reselling or redistributing Developer Access,
   offering it "on a standalone basis", acting as a "pass-through or service bureau", and sharing
   accounts. The licence is limited to "personal or internal business purposes" [12]. Get
   Higgsfield's written approval or a partner agreement before billing users for generations
   made on North's account.
4. **Meta now ships an official hosted Ads MCP** (`https://mcp.facebook.com/ads`) [40][41]. Its
   create tools make campaigns, ad sets and ads **paused**, and `ads_activate_entity` "starts
   spending budget" [42]. North should let agents use only its read tools (reporting, Ad Library
   search, previews). Every write stays in North's adapter, behind `AuthorityEngine.gate()`.
5. **Bug: the current Meta adapter targets a retired API version.** `meta-ads.ts` pins
   `graph.facebook.com/v21.0`. Marketing API v21.0 was deprecated on 2025-09-09 [46]; the current
   version is v25.0 [44], and v26.0 shipped on 2026-07-29 [45]. The adapter also cannot attach an
   image or a video: it sends `link_data` with text only.
6. **Remotion is free for North today** because the free licence covers companies of up to three
   people [17][18]. Version 4.0.536 was released on 2026-10-16 [21], it has official Agent Skills
   [20], and a 1-minute render on Lambda costs about $0.017 [19]. Pick Remotion, rendering on the
   Fly worker. HyperFrames (HeyGen, Apache-2.0) is the licence-free fallback [22]. Reject nexrender
   (needs an After Effects install) and CapCut (no official editing API found) [26][27].
7. **vidIQ MCP fits the free tier.** It has 52 tools [28], works on every plan including Free
   (150 credits a month), and most research calls cost 5 credits [29][31]. An API key gives
   read-only access [30]. Signing in with OAuth also allows owner-approved edits to the user's
   videos and Instagram Reel publishing. It cannot upload new YouTube videos and does not
   support TikTok [29].
8. **YouTube Data API changes:** since 2026-06-01 `videos.insert` has its own bucket of 100 calls
   a day [34][35], and `status.containsSyntheticMedia` sets the AI disclosure [33]. The current
   reference says unverified projects are "not restricted to private viewing mode" [33], which
   contradicts the 2020 rule [35]; one test upload settles it. **Google OAuth apps in "Testing"
   get 7-day refresh tokens** [38], which also breaks the staging Gmail connection every week.
9. **TikTok blocks public posting until the app is audited.** An unaudited Direct Post client
   can only post `SELF_ONLY`, for at most 5 users in 24 hours, and only to private accounts.
   The audit also rejects apps limited to "test or internal use" [60]. "Upload to drafts"
   (`video.upload`) instead hands the video to the user, who finishes the post in the TikTok app
   [61]. That makes it a cheap K1 action. Higgsfield's TikTok publishing needs a human to submit
   its publish widget, so North cannot use it headlessly [16].
10. **AI disclosure can now be set through the API on every channel North targets.**
    Instagram uses `is_ai_generated` [53], TikTok `is_aigc` [62] and YouTube
    `containsSyntheticMedia` [33]. Since 2026-08-31, Instagram cuts the reach of profiles that
    feature an undisclosed AI-generated person [56]. Under the FTC rule, AI-written fake reviews
    and fake follower counts are unlawful [84]. For skills, vendor a subset of
    `coreyhaines31/marketingskills` (MIT, 50 skills, last commit 2026-10-15) [77] and Anthropic's
    marketing plugin (Apache-2.0) [80].

## Findings

### 1. Higgsfield (generation; the founder's current stack)

**Products.** These are visible in the MCP's tool surface [16], the MCP page [7] and the Ads Studio launch post [14]:

| Product | What it does |
| --- | --- |
| Image and video generation | 30+ models (Nano Banana Pro, Seedance 2.x, Kling 3, GPT Image 2, Soul 2.0) |
| Ads Studio | Builds a brand from its URL (`ads_studio_create_brand`), then makes static ad concepts at 1:1, 9:16, 16:9 or 3:4 with objectives sales, leads, traffic, awareness or engagement. You quote before you generate. |
| Marketing Studio | Template gallery widget: UGC, product shots, motion, posters, marketplace |
| Shorts Studio | Restyles one uploaded source video (4 to 120 s) into short clips, 720p only, with a `get_cost` estimate |
| AI Influencer | Character sheets, with a "prepare and quote" step before spending |
| Virality Predictor | Scores hooks, retention risk and engagement |
| TikTok publish | Direct post or drafts, finished by the user in a widget |
| Other | Upscale, reframe, background removal, voice, dubbing, 3D |

**API.** Base URL `https://api.higgsfield.ai`, header `Authorization: Key <id>:<secret>`, never
called from a browser [1][2]. Requests are asynchronous: you get a `request_id`, then poll or
receive a webhook [2]. Outputs are kept at least 7 days, so copy them to your own storage [3][4].
Billing is a pay-as-you-go balance: failed or NSFW-flagged requests are free [3], credits expire
after a year, and an estimate endpoint quotes the cost before you submit [4]. Concurrency is set
per account (`400 "Maximum number of concurrent requests (4)"`, no `Retry-After`) [5]. Official
Python and Node SDKs exist [3]; organizations share a workspace but offer no on-behalf-of flow [6].

**MCP.** OAuth with "no API key"; any MCP-compatible client may connect, and API keys belong to
"a separate developer product" [8]. MCP, CLI, Canvas and Supercomputer generations always deduct
credits. "Unlimited is designed for personal, human use only", and "automation tools, scripting,
credential sharing, and reselling access are strictly prohibited" [9][10]. The tools carry their
own approval steps: `ads_studio_generate` is quoted first, then re-sent with `expected_credits`
and a stable `idempotency_key` [16]. That maps onto North's budget guard and idempotent actions.

**Pricing.** Higgsfield's own pricing page renders client-side. Secondary sources list:

| Plan | Price | Credits per month |
| --- | --- | --- |
| Free | $0 | none |
| Starter | about $19 (annual billing) | 270 |
| Plus | $47 annual / $59 monthly | 1,200 |
| Ultra | $99 annual / $129 monthly | 3,000 |

Paid plans include commercial use [15]. Subscription credits do not roll over, and credit packs
expire after 90 days [10]. Ads Studio prices a single ad at 4 credits, which is $0.20 at $0.05
per credit [14].

**Terms (effective 2026-08-27 [13])** [11][12]. Higgsfield claims no ownership of inputs or
outputs and does not prohibit selling outputs (§4.4); it may train on your content unless an
enterprise agreement excludes that [11][13]. §11 covers API, MCP and CLI use: keys are "for your
use only" (§11.3); you answer for your End Users and may not resell Developer Access, offer it "on
a standalone basis" or act as a "pass-through or service bureau" without independent value
(§11.5); agent activity counts as yours (§11.12); you may pick any third-party MCP client
(§11.13). §2.4 forbids sharing accounts or creating them for others; §1.5 forbids spreading
requests across accounts.

**For North:** "serious use on the user's own account" is clean with North as a third-party MCP
client under the user's own OAuth grant (§11.13). "Trials on a North platform account billed as
North credits" sits close to §11.5 and the resale ban, so treat it as blocked until Higgsfield
confirms in writing. Unverified: whether `mcp.higgsfield.ai` accepts dynamic client registration
from any client (North's web app needs it to run the OAuth flow).

### 2. Programmatic video: Remotion and alternatives

| Tool | License / cost | Agent support | Rendering | Fit for North |
| --- | --- | --- | --- | --- |
| **Remotion** 4.0.536, released 2026-10-16 [21] | Free for individuals and companies of up to 3 people, commercial use included [17][18]. At 4 or more people, Automators pay $0.01 per render with a $100/month minimum, and Enterprise starts at $500/month [17]. | Official Agent Skills, including `/remotion-best-practices`, `/remotion-render`, `/remotion-captions` and `/remotion-saas`, installed with `npx skills add remotion-dev/skills` [20]. The skills' licence is unstated, so verify before vendoring. | Local `@remotion/renderer`, Lambda (1-minute video about $0.017, 10-minute HD about $0.10) [19], or Cloud Run | **Pick.** It is React, the same stack as `apps/web`, so brand tokens and components can be shared between the site and videos. |
| **HyperFrames** (heygen-com) [22] | Apache-2.0; 65k stars | Claude Code plugin, plus `npx skills add heygen-com/hyperframes` (21 skills) | HTML + GSAP/CSS/Three.js through headless Chrome and FFmpeg; Lambda or HeyGen cloud | **Fallback** if Remotion's licence starts to cost money. Releases list is empty, so it is young. |
| Shotstack [23] | Pay-as-you-go: $10 for 50 minutes. Starter $39/month for 250 minutes. 10 free credits; sandbox on every plan. | REST plus Node/Python SDKs; no MCP listed | Hosted JSON timeline | Works, but adds per-minute cost and a second template language. |
| Creatomate [24] | 50-credit free trial. Paid prices are not shown on the page; third-party listings range from $29 to $54/month (secondary). About 14 credits per minute of 720p video. | REST API on every plan; no MCP listed | Hosted templates | Reasonable for template feeds; not needed. |
| HeyGen API [25] | Pay-as-you-go wallet. Free API credits ended in Feb 2026 (secondary; per-minute rates unverified). | REST | Avatar video | Only for avatar or UGC-style video, and it triggers AI-person disclosure. |
| nexrender [26] | MIT; `@nexrender/cli` 1.63.3 (2026-02-25) | None | Needs a licensed After Effects install | **Reject**: it cannot run on Fly or Lambda. |
| CapCut [27] | No official public editing API found; only reverse-engineered community projects | n/a | n/a | **Reject** for terms risk. |

**Budget pick for dev (under $100/month total):** Remotion rendered on the existing Fly worker
($0 licence, machine time only), Lambda for parallel bursts at a few cents per video minute [19].
Higgsfield generates AI shots; Remotion adds the brand layer (captions, logo end card, safe zones,
aspect-ratio variants), so nothing is paid twice.

### 3. vidIQ and the YouTube Data API

**vidIQ MCP** [28][29][30][32]. Server `https://mcp.vidiq.com/mcp`; OAuth gives the full
toolset, an API key from vidIQ settings is read-only, and every plan has access (Free 150 credits
a month, Boost 2,000, Max 6,000; paid prices secondary [31]). Most research calls cost 5 credits,
short-form analysis 10, full Video Watch 25 and thumbnail generation 22; no rollover [29].
- **Research:** `vidiq_outliers` (videos beating their channel's average; semantic search over
  6 months of English long-form), `vidiq_similar_videos`, `vidiq_similar_thumbnails`,
  `vidiq_keyword_research` (research, questions, matching_terms, rising, country) and
  `vidiq_instagram_tiktok_outlier_search` for public Instagram and TikTok posts [32].
- **Scoring and generation:** `vidiq_score_title`, `vidiq_score_thumbnail`,
  `vidiq_generate_titles`, `vidiq_generate_thumbnail` [32].
- **Writes** (OAuth sign-in plus user approval): `vidiq_update_video`,
  `vidiq_update_video_thumbnail`, `vidiq_reply_to_comment`, `vidiq_instagram_publish_reel`. It
  cannot upload new YouTube videos and does not support TikTok [29][32].

**YouTube Data API v3.** 10,000 units a day in the default bucket; since 2026-06-01
`videos.insert` and `search.list` each have their own 100-calls/day bucket [34][35]. The
documented upload cost fell from about 1,600 to about 100 units on 2025-12-04 [35].
`thumbnails.set` costs 50 units and takes files up to 50 MB since 2026-09-14 [34][35].
`videos.insert` accepts up to 256 GB and sets `selfDeclaredMadeForKids`, `containsSyntheticMedia`
and `publishAt` [33]. The reference (updated 2026-10-15) says unverified projects are not
restricted to private [33]; the 2020 history entry says they are locked private until an audit,
with no recorded reversal [35]. A Google OAuth app in Testing gets 7-day refresh tokens [38];
sensitive-scope verification needs a privacy policy on the app's domain, a demo video and domain
verification [39]. Whether the YouTube scopes count as sensitive is unverified (check the console).

### 4. Meta Marketing API, Instagram publishing and the Ads MCP

**Creatives.** Upload video to `act_<id>/advideos` and use `video_id` plus a thumbnail in
`object_story_spec.video_data`; images are referenced by `image_hash` from the ad account's image
library [48]. The Ads CLI uploads files itself and builds link, video, photo-post and Dynamic
Creative ads; DCO takes up to 5 each of titles, bodies, descriptions and CTAs [43].

**Advantage+ creative** is set per feature in `degrees_of_freedom_spec.creative_features_spec`
with `OPT_IN`/`OPT_OUT`; the bundled "standard enhancements" opt-in is deprecated from v22.0 [47].
Features labelled AI-generated (`image_background_gen`, `image_animation`, `video_uncrop`,
`translate_voiceover` and others) should be created `PAUSED`, previewed, then activated [47].
North should send `OPT_OUT` by default and allow opt-in only with a preview on the card.

**Review and access.** Ad review usually takes under 24 hours, and live ads can be re-reviewed;
banned content includes personal-attribute claims, deceptive practices and offers that don't
match the landing page [52]. The sandbox ad account (one per app) delivers nothing, needs no
funding, works only through the API and has no Insights [49]. Standard ("Limited") access covers
your own ad account; other people's accounts need advanced ("Full") access: App Review per
permission, 500+ calls in 15 days under 15% errors, and business verification for sensitive data
[50]. Apps used only by people with a role on the app skip App Review [51].

**Instagram publishing** [53]: create a container (`/<IG_ID>/media`, `media_type=REELS`, a
public `video_url`), then `/media_publish`. Instagram Login needs `instagram_business_basic` and
`instagram_business_content_publish`. The page states both 100 and 50 posts per 24 hours, so read
`content_publishing_limit` at run time. Trial Reels (`trial_params`) are supported, and
`is_ai_generated=true` sets the AI label.

**Official Ads MCP** [40][41][42]: tools for reporting, ad creation, catalog, datasets, help, A/B
tests and lift studies, and activity logs. Auth is Facebook Login for Business through your own
Meta app (use case "Create & manage ads with ads MCP server") or a user token with
`ads_mcp_management`, `ads_read`, `ads_management`, `business_management`, `pages_show_list` and
`instagram_basic`. Useful: `ads_library_search` (competitors), `ads_get_ad_preview`,
`ads_get_ad_entities` (reporting), `ads_boost_ig_post`. Media can be listed, not uploaded. Open
beta since 2026-04-29 (secondary [85]). Meta ships a version about every four months and supports
a deprecated one at least 90 days [44], so pin the version in one tested constant.

### 5. TikTok: Content Posting API and Ads

**Direct Post** needs the `video.publish` scope and a `creator_info` query first [59]. Required
UX: the creator's nickname, a privacy dropdown with no default, interaction toggles off by
default, a commercial-content disclosure (Your brand / Branded content), the music-usage consent
line, and no added watermarks or logos [60]. Unaudited clients post `SELF_ONLY`, for at most 5
users per 24 hours, to private accounts only; each creator gets about 15 posts a day across all
clients [60]. `post_info` carries `brand_content_toggle`, `brand_organic_toggle` and `is_aigc`;
6 requests per minute per token [62].

**Upload to drafts** (`video.upload`, `/v2/post/publish/inbox/video/init/`) allows 5 pending
shares per 24 hours, and the user finishes the post in the app [61]. The **sandbox** takes up to
10 accounts you own and allows no public posting [63]. **TikTok Ads (API for Business)** needs a
TikTok for Business account, developer registration and a developer app (MIT SDK) [64]; the
portal renders client-side, so sandbox and approval details are unverified here. Realistic AI
content must be labelled, and C2PA-tagged uploads are auto-labelled (both secondary [65]). Treat
organic TikTok as phase 1 and TikTok Ads as phase 2.

### 6. SEO data, content workflow, LinkedIn and X

**SEO data sources:**

| Source | Access | Cost | Use in North |
| --- | --- | --- | --- |
| Google Search Console API | OAuth on the user's property | Free; Search Analytics 1,200 QPM per site; URL Inspection 2,000/day per site [69] | Ground truth: queries, clicks, indexing status as evidence |
| DataForSEO [66] | API login; MCP integration offered | Pay-as-you-go, $50 minimum deposit (never expires), $1 trial; SERP from $0.0006, Keywords Data from $0.0012/task, Labs $0.012 + $0.00012/item | **Keyword data pick** for the dev budget |
| Ahrefs API v3 / MCP [67] | API key / OAuth (MCP) | Lite plan up; units shared between API and MCP; at least 50 units per call; extra units Enterprise-only | Phase 2, if the user already pays for Ahrefs |
| Semrush API [68] | API units bought on top of a Business-level plan (secondary, conflicting) | $450-550/month plus units | Skip |
| vidIQ keyword research [32] | MCP | 5 credits per call | YouTube search demand |

**Google's spam rules and AI content:** "scaled content abuse" (pages made "for the primary
purpose of manipulating search rankings", including "using generative AI tools... without adding
value"), doorway abuse and site reputation abuse are banned (updated 2026-08-28) [70]. AI content
is fine if it adds value, is fact-checked and has reviewed metadata; Merchant Center requires IPTC
`TrainedAlgorithmicMedia` on AI images [71].

**Content workflow for North:** a keyword cluster (DataForSEO + GSC) produces a brief (intent,
SERP gaps, first-hand data to include). Then a draft, a critic pass, publishing to the user's
site repo through a PR (`repo.pull_request`, K1), and evidence: the URL plus GSC URL Inspection
status.

**Programmatic SEO guardrails:** every page needs its own unique data; a weekly page cap; new
pages start `noindex` until the critic passes them; never publish third-party content on someone
else's domain.

**LinkedIn.** The self-serve "Share on LinkedIn" product grants `w_member_social` (posting as the
person), at 150 requests per member per day [72]. The Posts API (`/rest/posts`) replaces
`ugcPosts` and needs the `Linkedin-Version` header; version 202511 sunsets on 2026-11-16 [73].
Posting as a company page needs `w_organization_social`, which requires the Community Management
API (Development tier, then Standard) and a page role [73][74].

**X.** Pay-per-use with prepaid credits: a post costs $0.015, a post with a URL **$0.20** [75].
The free tier effectively ended for new developers in Feb 2026, and legacy Basic and Pro plans
are being retired (secondary [76]).

### 7. Skill libraries and creative-testing method

| Library | License | Signal | Take for North |
| --- | --- | --- | --- |
| coreyhaines31/marketingskills [77] | MIT | 55k stars, 50 skills, commit 2026-10-15 (release 2.11.37) | Vendor `ad-creative`, `ads`, `copywriting`, `copy-editing`, `social`, `video`, `content-strategy`, `seo-audit`, `programmatic-seo`, `ai-seo`, `schema`, `ab-testing`, `marketing-psychology`, `launch`, `analytics`. Strip partner promotions and CLI write paths. |
| anthropics/knowledge-work-plugins `marketing` [80] | Apache-2.0 | 29.8k stars | Skills `brand-voice`, `content-creation`, `campaign-planning`, `competitive-analysis`, `performance-analytics` |
| remotion-dev skills [20] | Unstated (check before vendoring) | Official | `/remotion-best-practices`, `/remotion-captions`, `/remotion-render` for the video producer |
| AgriciDaniel/claude-ads [81] | MIT | 10k stars | Vendor the audit checklists only. Its Python adapters write to ad platforms and would bypass `gate()`. |
| alirezarezvani/claude-skills [82] | MIT | 28.3k stars; ~49 marketing skills with Python tools | Overlaps; review later |

**Copywriting and creative method** (from the vendored skills, which match standard practice):
pick 3-5 angles, each tied to a different motivation (pain, outcome, social proof, curiosity,
comparison, urgency, identity, contrarian). Ground them in verbatim customer language and earlier
winners, keep a **learnings ledger** so tested angles are never proposed again, and write
falsifiable hypotheses [78]. Test in order: concept/angle, hook/headline, visual, body, CTA; one
variable per cycle, at least 1,000 impressions before judging [78][79]. Spend 70% on proven work
and 30% on tests, raise budgets at most 20% every 3-5 days, and end each weekly check with HOLD,
FIX, TEST or INVESTIGATE [79].

**Why this fits Meta's delivery:** Meta's retrieval engine Andromeda is built for a large
increase in creative volume, driven by Advantage+ and generative AI. Meta says more diverse ad
candidates improve results, and image generation lifted conversions about 7% [58]. So test
distinct concepts, not small tweaks.

**Creative fatigue:** frequency rising together with falling CTR and rising CPA is a common
heuristic, but it comes from secondary sources, not Meta. At North's small budgets, single-cell
A/B tests are underpowered. Use DCO or flexible creative (up to 5 of each asset [43]) inside
one ad set, and keep Meta A/B studies (exposed in the Ads MCP [40]) for larger spends.

### 8. Platform policies: disclosure, fake accounts, fake reviews

**AI labels by platform:**

| Platform | Rule | How it is set |
| --- | --- | --- |
| Meta | "AI info" labels come from detected industry-standard indicators or from the user's own disclosure [54]. Ads made with Meta's generative tools get an automatic AI disclosure in "About this ad", and third-party AI is detected via C2PA (secondary [55]). | `is_ai_generated` on Instagram containers [53] |
| Instagram profiles | Renamed "AI-generated profile" on 2026-08-31. Profiles featuring an AI person that are caught unlabelled can lose recommendation eligibility [56]. | Profile label |
| TikTok | Realistic AI content must be labelled; TikTok auto-labels uploads with C2PA credentials (secondary [65]). | `is_aigc` [62] |
| YouTube | Disclose realistic altered or synthetic content. Repeated non-disclosure can mean removal or YPP suspension [36]. | `containsSyntheticMedia` [33] |

**Fake accounts and engagement:** Meta bans inauthentic assets used to mislead about identity or
origin [57]; YouTube bans automated inflation of metrics and sub4sub [37].

**FTC rule** (effective 2024-10-21, 60 days after Federal Register publication): bans
AI-generated or fake reviews and testimonials, undisclosed insider reviews, review suppression
and buying fake followers or views [84].

**Consequence for North:** an AI influencer persona is allowed only on a labelled account owned
by the user, never as a fake customer. Testimonials need a verifiable source (a real email,
form or review URL) stored as evidence.

## Recommendations for North (ranked)

1. **Fix the Meta adapter before any live run** (`packages/integrations/src/live/meta-ads.ts`,
   `growth-types.ts`): move `META_GRAPH_API` to v26.0 (or v25.0) with one test per version.
   Create campaign, ad set and ad `PAUSED`, fetch a preview (`/generatepreviews`) as evidence on
   the K2 card, and activate only on approval. Add `creative.assets` (`adimages` returning
   `image_hash`; `advideos` then `video_data`), default every Advantage+ AI feature to `OPT_OUT`,
   and add an `aiGenerated` flag.
2. **Treat MCP servers as adapters (write an ADR 0017).** Add
   `packages/integrations/src/live/mcp-client.ts`, a remote MCP client using the user's OAuth
   bearer token (stored per ADR 0008), for `meta_ads_mcp`, `higgsfield` and `vidiq`. Agents get
   per-vendor *read-only* tool allowlists through `packages/agents/src/runtime/claude-agent-sdk.ts`.
   Write tools (`ads_activate_entity`, `ads_studio_generate`, `vidiq_update_video`,
   `vidiq_instagram_publish_reel`) are called only by the worker, after `gate()`.
3. **Higgsfield adapter** (`live/higgsfield.ts`, `sandbox/video.ts`): the user's own account via
   MCP OAuth, and a North dev account via the API key (internal use only). Flow: quote, budget
   guard, generate with `idempotency_key` and `expected_credits`, webhook or poll, then copy to
   Supabase Storage within 7 days with checksum and `request_id` as evidence. Credits spent go to
   `ledger_entries` (append-only).
4. **New action kinds and tiers** (`packages/core/src/authority/action.ts`, `connections.ts`):
   `generation.spend` (`spendsMoney`, category `tools`), `ads.creative.upload` (K1: paused objects
   in the user's account), `social.upload.draft` (K1: TikTok inbox, YouTube private) and
   `video.metadata.update` (K1 inside an approved test plan). `social.publish` (K2) and
   `content.publish.approved` (K1) stay as they are. New providers: `higgsfield`, `vidiq`,
   `google` (YouTube + Search Console), `tiktok`, `linkedin`, `x`.
5. **Video package** (`packages/video`, new): Remotion compositions sharing brand tokens with
   `apps/web`, rendered by an Inngest function on the Fly worker (`apps/worker/src/inngest`).
   Output 9:16, 1:1 and 16:9 variants with burned-in captions and safe zones, verified with
   ffprobe (duration, fps 23-60, size limits for TikTok, Reels and Shorts).
6. **Split `agents/growth.yaml` into a Marketing department** with the personas below. Add task
   guides in `packages/agents/src/prompts/task-guides.ts`: `creative_brief`, `ad_variant_set`,
   `video_script`, `content_calendar`, `seo_brief`, `critic_report`. Creatives default to
   "Review drafts" in the review queue, which does not count against the 3-card quota.
7. **Vendor skills** with pinned SHAs and license files under a `skills/vendor/` tree (layout set
   by the skills research), plus North-authored `north-meta-creative-pipeline`,
   `north-platform-disclosure` (§8), `north-creative-testing` (§7), `north-youtube-vidiq`,
   `north-seo-brief` and `north-marketing-critic`.
8. **Google OAuth:** publish the consent screen or start verification early. On staging, the
   ADR 0010 refresh path will otherwise hit 7-day token expiry for Gmail, YouTube and Search
   Console [38].

### Specialist personas

Draft-tier actions (research, drafts, quotes and local renders) are K0 for every persona.

| Persona | Skills | Tools / connectors | Outputs | Evidence of done | K1 | K2 |
| --- | --- | --- | --- | --- | --- | --- |
| Performance marketer | `ads`, `ab-testing`, `analytics`, claude-ads checklists, `north-creative-testing` | Meta Marketing API (adapter), Ads MCP read tools, PostHog | CampaignSpec, test plan, weekly HOLD/FIX/TEST/INVESTIGATE report | Campaign, ad set and ad IDs; preview URL; `effective_status`; insights snapshot in the ledger | `ads.pause`, `ads.creative.upload` (paused) | `ads.start`, `ads.budget.change`, `budget.cap.raise` |
| Creative director | `ad-creative`, `copywriting`, `marketing-psychology`, `brand-voice` | Higgsfield (Ads Studio, Virality Predictor), Meta Ad Library search | 3-5 angles × hooks; 2-3 creative directions; learnings ledger | Variant files in Storage with Higgsfield job IDs; reviewer's pick recorded | `generation.spend` within the approved cap | Approving the monthly generation cap |
| Video producer | `video`, Remotion skills, `north-platform-disclosure` | Remotion (worker), Higgsfield video and Shorts Studio | Script, storyboard, MP4s per aspect ratio, captions | MP4 checksum, ffprobe report, render log, `is_aigc`/`is_ai_generated` set | `generation.spend` within the cap | None (publishing belongs to the social manager) |
| Social media manager | `social`, `content-strategy`, `launch` | Instagram Graph, TikTok Content Posting, LinkedIn Share, X, vidIQ IG/TikTok outliers | ContentCalendar, post drafts | Platform post IDs or permalinks (`media_publish` ID, TikTok `publish_id` status, LinkedIn `x-restli-id`, tweet ID) | `social.upload.draft`, `content.publish.approved` (approved calendar) | `social.publish` (anything new and public), approving the calendar, custom comment replies |
| YouTube strategist | `north-youtube-vidiq`, `copywriting` | vidIQ MCP, YouTube Data API | Outlier report, keyword map, 5 scored titles, thumbnails | vidIQ scores saved; `videoId`; `containsSyntheticMedia` set | Private or unlisted upload; metadata change inside an approved test | Making a video public outside the calendar |
| SEO strategist | `seo-audit`, `programmatic-seo`, `ai-seo`, `schema`, `site-architecture` | GSC API, DataForSEO, GitHub (site repo) | Keyword clusters, briefs, pages | PR merged, live URL, URL Inspection "indexed" | `repo.pull_request` | `deploy.production` of a new page batch |
| Marketing critic | `copy-editing`, `north-marketing-critic`, `brand-voice` | Playwright screenshots of previews, platform spec tables | critic_report: pass/fail per rule (claims, landing-page match, disclosure, character limits, AI tells, fake-proof check) | Report plus screenshots attached to the draft; a failed check blocks the card | None | None (gates other personas' drafts) |

### Connector priority (build order)

1. **Meta Marketing API + Instagram publishing.** One Meta app, development mode, the founder
   as a tester, a sandbox ad account.
2. **Meta Ads MCP**, read-only for reporting and the Ad Library.
3. **Higgsfield** (MCP OAuth for the user's account; API key for North's dev account).
4. **Remotion** (a package, not a connector).
5. **YouTube Data API + vidIQ MCP** (start with the read-only API key).
6. **Google Search Console + DataForSEO.**
7. **TikTok Content Posting** (drafts mode first, then the audit).
8. **LinkedIn "Share on LinkedIn"** for member posts, and **X** pay-per-use.
9. **Deferred:** TikTok Ads, LinkedIn Community Management (company pages), Ahrefs, HeyGen.
   Upload-Post (free tier of 10 uploads a month without TikTok; Basic $16-24/month) is an optional
   shortcut that says no Meta or TikTok app review is needed [83].

### What the founder must sign up for

| Item | What to do | Lead time | Dev cost |
| --- | --- | --- | --- |
| Meta developer app | Add the Marketing API, Instagram API (Instagram Login) and the "ads MCP server" use case; development mode with the founder as a role user, so no review is needed [51] | Same day | $0 |
| Meta sandbox ad account | Marketing API > Tools; one per app [49] | Same day | $0 |
| Real Meta ad account + Page + IG professional account | The founder's own accounts, for live acceptance tests | 1 day | Ad spend capped by North |
| Meta Business Verification + App Review (advanced access) | Only when non-role users connect [50] | Days to weeks (unverified) | $0 |
| Higgsfield account | A paid plan for commercial use [15]; MCP OAuth; console API key for the dev account [1] | Same day | About $10-20/month in credits |
| Higgsfield written approval | Ask whether North may bill users for trial generations made on North's account (§11.5) | Unknown | $0 |
| vidIQ account | Free plan; create a read-only API key [30] | Same day | $0 (150 credits) |
| Google Cloud project | OAuth consent screen, YouTube Data API, Search Console API; sensitive-scope verification (privacy policy, demo video, domain) [39] | Same day in Testing; verification takes weeks (unverified) | $0 |
| TikTok developer app | Content Posting API, sandbox with up to 10 own accounts [63]; audit once North has public users [60] | Same day; audit unknown | $0 |
| LinkedIn developer app | Add "Share on LinkedIn" (self-serve) [72] | Same day | $0 |
| X developer account | Buy pay-per-use credits [75] | Same day | About $5 |
| DataForSEO | $50 minimum deposit, which never expires [66] | Same day | $50 one-time (optional) |

**Dev spend estimate for marketing tools:** about $15-30/month recurring (Higgsfield credits
plus X) and a one-time $50 DataForSEO deposit. Remotion, the Meta and TikTok sandboxes, YouTube,
GSC and vidIQ Free cost nothing. The rest of the $100 goes to the Claude API.

## Risks

- **Terms:** North-account Higgsfield trials resold as North credits may breach §11.5 and §2.4
  [12]. Unlimited plans never apply through MCP, so per-generation costs are real [9].
- **Unsafe vendor tools:** MCP write tools can bypass the gate if exposed to agents. Meta's
  `ads_activate_entity` spends money [42]. Vendored ad skills with their own API adapters do the
  same [81].
- **API churn:** Meta versions about every four months [44], LinkedIn monthly versions [73], X
  pricing changed twice in 2026 [76], and YouTube's quota model moved in June 2026 [35].
- **Platform enforcement:** a missing AI label means lost reach on Instagram [56], penalties on
  YouTube [36] and auto-labels on TikTok. Scaled SEO pages risk a spam-policy action [70].
- **Review gates:** the TikTok audit rejects internal-only apps [60]. Meta advanced access needs
  500 calls in 15 days and business verification [50]. Both can stall going live.
- **Asset loss:** Higgsfield outputs can disappear after 7 days [3]. vidIQ media links expire in
  about 12 hours [29]. Copy everything to Storage immediately.
- **Unverified items:** Higgsfield MCP dynamic client registration; YouTube's private-lock rule;
  TikTok Ads sandbox details; exact Higgsfield and vidIQ paid prices (secondary sources).

## Open questions for the founder

1. Will you ask Higgsfield for a partner agreement covering North-account trials, or should
   trials use your own Higgsfield account only?
2. Should North post as you (LinkedIn member, your X handle) or as a company page, which needs
   Community Management API review?
3. Allow AI-generated people (AI Influencer, avatars) at all? If yes, only on labelled
   accounts [56].
4. A monthly generation cap (for example $20) approved once by a K2 card, so each generation
   after that is K1?
5. Fund a $50 DataForSEO deposit now, or start SEO on Search Console data only?
6. TikTok: drafts mode (you finish each post in the app) until the audit, acceptable?

## Sources

**Higgsfield:** [1] https://docs.higgsfield.ai/docs/authentication · [2] https://docs.higgsfield.ai/docs/how-to/introduction.md · [3] https://docs.higgsfield.ai/docs/help/faq.md · [4] https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md · [5] https://docs.higgsfield.ai/docs/concepts/rate-limits.md · [6] https://docs.higgsfield.ai/docs/llms.txt and https://docs.higgsfield.ai/docs/organizations.md · [7] https://higgsfield.ai/mcp · [8] https://higgsfield.ai/creator-hub/help-center/mcp-cli/what-is-higgsfield-mcp · [9] https://higgsfield.ai/creator-hub/help-center/credits/what-are-unlimited-models-and-which-plans-include-them · [10] https://higgsfield.ai/creator-hub/help-center/credits/how-credits-work · [11] https://higgsfield.ai/creator-hub/help-center/account-and-privacy/who-owns-my-generations-and-can-i-use-them-commercially · [12] https://higgsfield.ai/terms-of-use-agreement · [13] https://higgsfield.ai/blog/terms-of-use-privacy-policy-update · [14] https://higgsfield.ai/blog/higgsfield-ads-studio · [15] (secondary) https://creatify.ai/blog/higgsfield-pricing-(2026)-plans-and-what-you-ll-actually-pay and https://www.krea.ai/blog/higgsfield-pricing-explained-2026-unlimited-credits-and-real-monthly-costs · [16] Higgsfield MCP tool definitions (`ads_studio_quote`, `ads_studio_generate`, `ads_studio_create_brand`, `shorts_studio_create`, `tiktok_prepare_publish`, `virality_predictor`, `ai_influencer_prepare`), read from the connected server `https://mcp.higgsfield.ai/mcp` on 2026-10-16

**Video:** [17] https://www.remotion.pro/license · [18] https://github.com/remotion-dev/remotion/blob/main/LICENSE.md · [19] https://www.remotion.dev/docs/lambda/cost-example · [20] https://www.remotion.dev/docs/ai/skills · [21] https://registry.npmjs.org/remotion · [22] https://github.com/heygen-com/hyperframes · [23] https://shotstack.io/pricing/ · [24] https://creatomate.com/pricing · [25] (secondary) https://diyai.io/ai-tools/video-generation/heygen-pricing/ · [26] https://github.com/inlife/nexrender and https://registry.npmjs.org/@nexrender/cli · [27] (unofficial) https://github.com/Losering/CapCutAPI

**vidIQ and YouTube:** [28] https://vidiq.com/claude · [29] https://support.vidiq.com/en/articles/15082430 · [30] https://vidiq.com/codex/ · [31] https://vidiq.com/pricing/ and (secondary) https://1of10.com/blog/vidiq-pricing/ · [32] vidIQ MCP tool definitions (`vidiq_outliers`, `vidiq_keyword_research`, `vidiq_instagram_tiktok_outlier_search`, `vidiq_score_title`, `vidiq_update_video`, `vidiq_instagram_publish_reel`, `vidiq_video_upload`, `vidiq_balance`), read from `https://mcp.vidiq.com/mcp` on 2026-10-16 · [33] https://developers.google.com/youtube/v3/docs/videos/insert · [34] https://developers.google.com/youtube/v3/determine_quota_cost · [35] https://developers.google.com/youtube/v3/revision_history · [36] https://support.google.com/youtube/answer/14328491 · [37] https://support.google.com/youtube/answer/3399767 · [38] https://developers.google.com/identity/protocols/oauth2 · [39] https://support.google.com/cloud/answer/13464321

**Meta:** [40] https://developers.facebook.com/documentation/ads-commerce/ads-ai-connectors/ads-mcp-server/ads-mcp-server-overview · [41] https://developers.facebook.com/documentation/ads-commerce/ads-ai-connectors/ads-mcp-server/ads-mcp-server-get-started · [42] https://developers.facebook.com/documentation/ads-commerce/ads-ai-connectors/ads-mcp-server/ads-mcp-server-tools-ad-creation-and-management.md · [43] https://developers.facebook.com/documentation/ads-commerce/ads-ai-connectors/ads-cli/ad-creatives.md · [44] https://developers.facebook.com/documentation/ads-commerce/marketing-api/overview/versioning.md · [45] https://developers.facebook.com/blog/post/2026/07/29/introducing-graph-api-v26-and-marketing-api-v26/ · [46] https://developers.facebook.com/blog/post/2025/08/11/instagram-marketing-api-update/ · [47] https://developers.facebook.com/documentation/ads-commerce/marketing-api/creative/advantage-creative/get-started.md · [48] https://developers.facebook.com/documentation/ads-commerce/marketing-api/guides/videoads.md · [49] https://developers.secure.facebook.com/blog/post/2023/06/21/marketing-api-sandbox-capability-now-re-enabled · [50] https://developers.facebook.com/documentation/ads-commerce/marketing-api/get-started/authorization · [51] https://developers.facebook.com/docs/resp-plat-initiatives/individual-processes/app-review · [52] https://transparency.meta.com/policies/ad-standards/ · [53] https://developers.facebook.com/docs/instagram-platform/content-publishing/ · [54] https://transparency.meta.com/governance/tracking-impact/labeling-ai-content · [55] (secondary) https://socialmediatoday.com/news/meta-adds-updated-disclosure-tags-for-ai-generated-ads/824658 · [56] https://techcrunch.com/?p=3158959 (TechCrunch, 2026-08-31) · [57] https://transparency.meta.com/policies/community-standards/inauthentic-behavior/ · [58] https://engineering.fb.com/2024/12/02/production-engineering/meta-andromeda-advantage-automation-next-gen-personalized-ads-retrieval-engine/

**TikTok:** [59] https://developers.tiktok.com/doc/content-posting-api-get-started · [60] https://developers.tiktok.com/doc/content-sharing-guidelines · [61] https://developers.tiktok.com/doc/content-posting-api-reference-upload-video · [62] https://developers.tiktok.com/doc/content-posting-api-reference-direct-post · [63] https://developers.tiktok.com/doc/add-a-sandbox · [64] https://github.com/tiktok/tiktok-business-api-sdk · [65] (secondary) https://www.mediapost.com/publications/article/383640/ahead-of-ceo-testimony-tiktok-updates-community-g.html and https://zdnet.com.au/article/tiktok-is-the-first-social-media-platform-to-implement-content-credentials-heres-what-it-means-for-you/

**SEO, LinkedIn and X:** [66] https://dataforseo.com/pricing · [67] https://help.ahrefs.com/en/articles/13913559-getting-started-with-ahrefs-mcp and https://help.ahrefs.com/en/articles/6559232-about-api-v3 · [68] (secondary) https://ryandoser.com/semrush-api-pricing/ · [69] https://developers.google.com/webmaster-tools/limits · [70] https://developers.google.com/search/docs/essentials/spam-policies · [71] https://developers.google.com/search/docs/fundamentals/using-gen-ai-content · [72] https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin · [73] https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api · [74] https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-api-migration-guide · [75] https://docs.x.com/x-api/getting-started/pricing · [76] (secondary) https://roboin.io/article/en/2026/02/08/x-transitions-api-to-pay-per-use-model-ending-free-plan/

**Skills and other:** [77] https://github.com/coreyhaines31/marketingskills and https://github.com/coreyhaines31/marketingskills/commits/main · [78] https://github.com/coreyhaines31/marketingskills/blob/main/skills/ad-creative/SKILL.md · [79] https://github.com/coreyhaines31/marketingskills/blob/main/skills/ads/SKILL.md · [80] https://github.com/anthropics/knowledge-work-plugins and https://github.com/anthropics/knowledge-work-plugins/tree/main/marketing · [81] https://github.com/AgriciDaniel/claude-ads · [82] https://github.com/alirezarezvani/claude-skills · [83] https://www.upload-post.com/llms-full.txt and https://docs.upload-post.com/guides/ai-content-labeling · [84] https://www.ftc.gov/news-events/news/press-releases/2024/08/federal-trade-commission-announces-final-rule-banning-fake-reviews-testimonials · [85] (secondary) https://pasqualepillitteri.it/en/news/1707/official-meta-ads-mcp-claude-29-tools-2026
