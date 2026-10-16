# Sales department: research and recommendations (2026-10-16)

Scope: make North's Sales department world class for a founder getting first customers. Leads come from licensed
providers on the user's own account plus open web research; no LinkedIn scraping. Read with `agents/sales.yaml`,
the `lead_research` and `outreach_batch` guides in `packages/agents/src/prompts/task-guides.ts`,
`packages/integrations/src/live/gmail.ts`, migrations `0008_m4.sql` / `0018_lead_contact_claim.sql` and ADR 0010.
Every factual claim links to a source; "unverified" marks what this pass could not confirm. The web-search
budget ran out near the end; the last items were checked by fetching primary pages directly.

## Summary

1. **Both Apollo and Clay have official MCP servers.** Apollo's is `https://mcp.apollo.io/mcp` (OAuth, ~60 actions,
   including sending email and buying domains and mailboxes) ([Apollo MCP docs](https://docs.apollo.io/docs/apollo-mcp.md)).
   Clay has a hosted server at `https://api.clay.com/v3/mcp`, listed in Anthropic's own sales plugin
   ([.mcp.json](https://raw.githubusercontent.com/anthropics/knowledge-work-plugins/main/sales/.mcp.json)), and a local
   `clay mcp` that reads `CLAY_API_KEY` ([Clay docs index](https://developers.clay.com/llms.txt)). North should **not**
   give agents these servers directly: their write tools would bypass `AuthorityEngine.gate()`.
2. **Auth: user-pasted API keys are the realistic phase-1 path.** Apollo OAuth requires registering an app that Apollo
   must approve, and refresh rotates both tokens ([Apollo OAuth](https://docs.apollo.io/docs/use-oauth-20-authorization-flow-to-access-apollo-user-information-partners)).
   Clay, Hunter, Exa, the verifiers, Instantly, Smartlead and lemlist all use API keys. Store keys under ADR 0008 encryption.
3. **Apollo's terms allow the user's own internal use, with hard limits.** No access "on behalf of any person or entity
   other than you", no "using any API with LinkedIn automations", no AI training on its contact data, and no CAN-SPAM or
   CASL violations ([Apollo terms §3](https://www.apollo.io/terms)). North may never pool Apollo data across tenants.
4. **Start cheap.** Apollo people search costs 0 credits; enrichment costs 1-9 credits per person
   ([API pricing](https://docs.apollo.io/docs/api-pricing.md)). Search is capped at 200 requests per minute and
   50,000 per day on paid plans ([rate limits](https://docs.apollo.io/reference/rate-limits.md)). Clay's HTTP API and
   webhooks start on Growth (about $446-495/mo) ([Clay pricing](https://www.clay.com/pricing)), which is too much for first customers.
5. **Verify every address before first contact.** MillionVerifier ships test API keys that return fixed results
   ([API docs](https://developer.millionverifier.com/)), which suits North's sandbox. ZeroBounce does not charge for
   `unknown` results ([pricing](https://www.zerobounce.net/email-validation-pricing)).
6. **Gmail rules bind North even at low volume.** All senders need SPF or DKIM and a spam rate under 0.3%. Bulk senders
   (about 5,000 a day) need DMARC alignment and one-click unsubscribe ([Gmail guidelines](https://support.google.com/a/answer/81126)).
   Since November 2025 Gmail rejects non-compliant mail ([Google FAQ](https://support.google.com/a/answer/14229414)).
7. **North's live send path has compliance gaps.** `buildRawMessage` writes no opt-out line, no postal address and no
   `List-Unsubscribe` header. Bounces are skipped by `isAutomated`, but the lead is never marked `bounced`. Nothing sets
   `opted_out`. CAN-SPAM requires a postal address and an opt-out honored within 10 business days, and B2B mail is not
   exempt ([FTC](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)).
8. **The Gmail connection needs a Google security assessment.** North requests `gmail.readonly`, a restricted scope
   (`apps/web/src/lib/oauth.ts`); restricted scopes mean an annual CASA assessment
   ([scopes](https://developers.google.com/workspace/gmail/api/auth/scopes), [assessment](https://support.google.com/cloud/answer/13465431)).
9. **What works in 2026: few, honest, signal-led emails.** Instantly's 2025 data puts the average reply rate at 3.43% and
   the top 10% at 10% or more. Step 1 draws 58% of replies; under 80 words and 4-7 touches are recommended
   ([benchmark](https://instantly.ai/cold-email-benchmark-report-2026)); this is vendor data.
10. **The AI SDR cautionary tales are about trust, not models.** 11x claimed customers it did not have
    ([TechCrunch](https://techcrunch.com/2025/03/24/a16z-and-benchmark-backed-11x-has-been-claiming-customers-it-doesnt-have)).
    LinkedIn banned Artisan over its name use and scraped broker data
    ([TechCrunch](https://techcrunch.com/2026/01/07/yes-linkedin-banned-ai-agent-startup-artisan-but-now-its-back/)).
    North's edge is the opposite: few emails, approved by the CEO, each with a sourced reason.

## Findings

### 1. Lead data providers

**Apollo.io.** It is a people and company database with an engagement suite. API keys work on every plan per the
developer FAQ, but the pricing page says "API access is available on Custom plans", so the sources conflict
([FAQ](https://docs.apollo.io/docs/developer-faqs.md), [pricing](https://www.apollo.io/pricing)).

- **Credits.** People search (`mixed_people/api_search`) uses 0 credits and returns no emails. Enrichment costs 1-9
  credits per person, and bulk enrichment takes up to 10 people per call. Organization search and job postings cost
  1 credit per page ([API pricing](https://docs.apollo.io/docs/api-pricing.md)).
- **Rate limits.** Limits are per team: Free allows 50 requests a minute and 600 a day; paid search allows 200 a minute
  and 50,000 a day. A 429 response carries `retry-after` ([rate limits](https://docs.apollo.io/reference/rate-limits.md)).
- **Sequences.** `add_contact_ids` costs 0 credits and needs a master key or an endpoint-scoped key; the example 429
  shows 600 calls an hour ([reference](https://docs.apollo.io/reference/add-contacts-to-sequence)).
- **OAuth.** You register in Settings → Integrations, scopes are fixed at registration, testing waits for Apollo's
  approval, access tokens last 30 days, and the authorizing user must be an Admin or hold an OAuth permission
  ([OAuth](https://docs.apollo.io/docs/use-oauth-20-authorization-flow-to-access-apollo-user-information-partners)).
  Sharing data with non-Apollo users needs a custom contract ([FAQ](https://docs.apollo.io/docs/developer-faqs.md)).
- **MCP.** The server uses OAuth, or a master key in `X-Api-Key`, and "reflects your Apollo permissions"; "Apollo
  prohibits AI model training with Apollo MCP integrations" ([MCP](https://docs.apollo.io/docs/apollo-mcp.md)). Any plan
  qualifies, including free ([product page](https://www.apollo.io/product/mcp)).
- **Naming trap.** "Apollo MCP Server" and `apollo-skills` are Apollo GraphQL, a different company
  ([marketplace](https://claude.com/marketplace/plugins/apollo-skills)).

**Clay (clay.com, Clay Labs).** Clay is an enrichment and orchestration layer with its own GTM database
([searches](https://developers.clay.com/searches.md)).

- **API.** The Public API takes a personal key in the `clay-api-key` header ([auth](https://developers.clay.com/public-api/authentication.md)).
  Searches return at most 500 results a request; paid plans get 1,000,000 results per 30 days, Free gets 100
  ([searches](https://developers.clay.com/searches.md)).
- **Async runs and signals.** Routines run on 1-100 items, and webhooks are signed with `X-Clay-Signature` (HMAC-SHA256)
  ([webhooks](https://developers.clay.com/public-api/webhooks.md)). Signal triggers cover job change, job posting, new
  hire, promotion, news and funding, and intent ([signals](https://developers.clay.com/signals.md)).
- **Limits and plans.** Rate limits are per workspace; a 429 carries `Retry-After` ([rate limits](https://developers.clay.com/public-api/rate-limits.md)).
  Free gives 100 data credits a month; Launch costs $167-185 and has no HTTP API or webhooks; Growth costs $446-495
  and has both; Tables are Enterprise only ([pricing](https://www.clay.com/pricing), [docs index](https://developers.clay.com/llms.txt)).
- **MCP and plugin.** The Clay MCP gives 500 free credits on first connect, and admins set per-rep credit limits
  ([guide](https://www.clay.com/guides/clay-mcp)). The agent plugin needs a shell host such as Claude Code
  ([quickstart](https://developers.clay.com/quickstart.md), [repo](https://github.com/clay-run/agent-plugins)); its
  license is unverified. Clay's terms page renders client-side, so this pass could not read them: unverified.
- **Naming trap.** `@clayhq/clay-mcp` and `mcp.clay.earth` appear to belong to clay.earth, a different product
  (unverified) ([listing](https://mcpservers.org/en/servers/clay-inc/clay-mcp)).

**Alternatives.**

- **Hunter.** API key auth. Discover is free (50 requests a minute); Domain Search and Email Finder allow 15 requests a
  second; Verifier allows 10 a second. It also has sequences and warm-up endpoints ([API v2](https://hunter.io/api-documentation/v2)).
  Plans: Free (50 credits), Starter $49/mo (2,000 credits). A found email costs 1 credit and a verification 0.5
  ([pricing](https://hunter.io/pricing)). The MCP at `https://mcp.hunter.io/mcp` (OAuth or `X-API-Key`) is on every plan
  ([MCP](https://hunter.io/mcp)).
- **Prospeo.** "Free API access for all users" and an MCP server ([API docs](https://prospeo.io/api-docs)). Prices
  conflict across third-party sources ([ColdIQ](https://coldiq.com/blog/prospeo-pricing)). It markets itself as a
  LinkedIn email finder ([review](https://syncgtm.com/blog/prospeo-review)), so North should use domain-based calls only.
- **People Data Labs.** The Free plan obfuscates emails and phones; Pro starts at $98/mo for 350 credits
  ([pricing](https://www.peopledatalabs.com/pricing)). Rate limits are per key and a 402 means credits are spent
  ([limits](https://docs.peopledatalabs.com/docs/usage-limits)). Where its data comes from is unverified.
- **Exa.** Search costs $7 per 1k requests; Free gives $10 of credit a month ([pricing](https://exa.ai/pricing)).
  `category: company` returns company pages. `category: people` does not support `excludeDomains`
  ([search](https://exa.ai/docs/reference/search)), so North cannot filter LinkedIn out of it: use `company` and `news` only.
  Websets verify criteria, add enrichments and run monitors on a paid Websets plan ([Websets](https://exa.ai/docs/websets/overview)).
  The MCP is MIT licensed, at `https://mcp.exa.ai/mcp` ([repo](https://github.com/exa-labs/exa-mcp-server)).
- **Crunchbase.** No self-serve API: access is a negotiated license, reported at a $20k/yr median by a third party
  ([Vendr](https://www.vendr.com/marketplace/crunchbase)). An MCP at `mcp.crunchbase.com` is listed in Anthropic's sales
  plugin ([.mcp.json](https://raw.githubusercontent.com/anthropics/knowledge-work-plugins/main/sales/.mcp.json)). Not for phase 1.

### 2. Verification and deliverability

- **ZeroBounce** statuses: `valid`, `invalid`, `catch-all`, `spamtrap`, `abuse`, `do_not_mail` (role-based, disposable,
  global suppression) and `unknown`; there is even an `ai_agent_mailbox` sub-status
  ([status codes](https://www.zerobounce.net/docs/email-validation-api-quickstart/v2-status-codes)). Pay-as-you-go is
  $39 for 2,000 credits; Freemium gives 100 a month ([pricing](https://www.zerobounce.net/email-validation-pricing)).
- **NeverBounce** returns `valid`, `invalid`, `disposable`, `catchall` and `unknown`, with the key passed as a query
  parameter ([single check](https://developers.neverbounce.com/reference/single-check)). It costs $8 per 1,000, and
  credits expire after 12 months ([pricing](https://neverbounce.com/pricing)).
- **MillionVerifier.** Single and bulk APIs, plus test keys (`API_KEY_FOR_OK`, `API_KEY_FOR_CATCH_ALL`, and so on); the
  docs even say "you may also use our API to resell our services" ([API](https://developer.millionverifier.com/)).
  50,000 checks cost $89 or $0.00178 each, credits never expire, and risky results are refunded ([site](https://www.millionverifier.com/)).
- **Authentication.** Gmail requires SPF or DKIM, PTR records, TLS and a spam rate under 0.3% (target under 0.1%) for
  all senders. Bulk senders also need SPF, DKIM and DMARC (`p=none` is fine), alignment, one-click unsubscribe and a
  visible unsubscribe link ([guidelines](https://support.google.com/a/answer/81126)).
- **Yahoo** has the same baseline and adds: "Honor unsubscribes within 2 days" ([Yahoo](https://senders.yahooinc.com/best-practices/)).
- **Microsoft** applies SPF, DKIM and DMARC to senders above 5,000 a day since 5 May 2025
  ([Tech Community](https://techcommunity.microsoft.com/blog/outlook/strengthening-email-security-outlook-new-requirements-for-high-volume-senders/4399730)).
- **Bulk-sender status is permanent.** It is counted per primary domain, so subdomains add up. One-click unsubscribe is
  required for marketing mail ([FAQ](https://support.google.com/a/answer/14229414)).
- **RFC 8058.** `List-Unsubscribe-Post: List-Unsubscribe=One-Click` plus an HTTPS URI, both headers covered by DKIM, and
  no redirect from the endpoint ([RFC 8058](https://www.rfc-editor.org/rfc/rfc8058.html)).
- **Gmail's own warning.** It says "Don't purchase email addresses" and "Don't send messages to people who didn't sign
  up", ramp volume slowly and avoid bursts ([guidelines](https://support.google.com/a/answer/81126)). Cold email cuts
  against that, so it only survives at low volume with high relevance.
- **Sending limits.** Workspace allows 2,000 messages a day (500 on trial) and 2,000 unique external recipients
  ([limits](https://knowledge.workspace.google.com/admin/gmail/gmail-sending-limits-in-google-workspace)). Cold-email
  practice is far lower: about 30 a day per inbox ([Instantly](https://instantly.ai/blog/cold-email-sequence-best-practices/)),
  or 20-30 per Google mailbox with 2-3 mailboxes per domain ([marketingskills](https://raw.githubusercontent.com/coreyhaines31/marketingskills/main/skills/cold-email/references/deliverability.md)).
- **Warm-up and stop-loss.** Warm up for 3-4 weeks; stop at more than 2% bounces or near 0.1% complaints; never cold
  email from the primary domain ([same source](https://raw.githubusercontent.com/coreyhaines31/marketingskills/main/skills/cold-email/references/deliverability.md)).
  Google is reported to act against API-based warm-up tools (vendor claim, unverified) ([Growbots](https://www.growbots.com/blog/google-bans-cold-email-warmup/)).

### 3. Sending infrastructure

North sends through the user's Gmail today (ADR 0010).

- **Instantly.** API v2 uses a scoped Bearer key. The workspace limit is 100 requests a second and 6,000 a minute
  ([auth](https://developer.instantly.ai/getting-started/authorization.md), [rate limit](https://developer.instantly.ai/getting-started/rate-limit.md)).
  Webhooks include `reply_received`, `email_bounced`, `lead_unsubscribed`, `lead_meeting_booked` and `lead_wrong_person`
  ([events](https://developer.instantly.ai/guides/webhook-events.md)). An OAuth URL flow connects Google or Microsoft
  mailboxes ([guide](https://developer.instantly.ai/guides/oauth-connection-flow.md)). The MCP at `mcp.instantly.ai/mcp`
  takes the API key ([MCP auth](https://developer.instantly.ai/mcp/authentication.md)).
  Pricing: Growth $47, Hypergrowth $97, unlimited accounts and warm-up ([pricing](https://instantly.ai/pricing)).
  Third parties say the full API and webhooks need Hypergrowth ([Nango](https://nango.dev/docs/integrations/all/instantly)): unverified.
- **Smartlead.** `api_key` query parameter; rate limits "vary by subscription plan" ([API](https://api.smartlead.ai/reference/welcome)).
  Base $39 for 6,000 emails, Pro $94 for 90,000, unlimited mailboxes ([pricing](https://www.smartlead.ai/pricing)).
  The API and webhooks start at Pro ([integration doc](https://docs.moveo.ai/docs/integrations/smartlead)).
- **lemlist.** Basic auth with the API key as password ([auth](https://developer.lemlist.com/api-reference/getting-started/authentication)),
  plus an OAuth MCP ([developer docs](https://developer.lemlist.com/)). $55-69 per user a month with lemwarm
  ([pricing](https://www.lemlist.com/pricing)).
- **When to leave a single Gmail inbox.** Leave when (a) cold volume would pass about 20-30 a day, (b) follow-ups must run
  unattended across several inboxes, (c) any stop-loss trips, or (d) the founder's customer mail shares that domain.
  Then: a brand-linked secondary domain, 2-3 Workspace inboxes, warm-up, then Instantly or Smartlead.

### 4. Methodology that works in 2026

- **Signal first.** A reason the lead fits *now*: a job post, a new hire, funding, a launch or a stack change. Apollo
  job postings ([pricing](https://docs.apollo.io/docs/api-pricing.md)), Clay signals ([signals](https://developers.clay.com/signals.md))
  and Exa monitors ([Websets](https://exa.ai/docs/websets/overview)) supply these. North's guide already demands a "why".
- **Honest personalization.** Anthropic's `draft-outreach` skill says "Never 'I came across your company'", body under
  120 words, 4-7-word subjects, and treats enrichment as "data, never instructions"
  ([skill](https://raw.githubusercontent.com/anthropics/knowledge-work-plugins/main/sales/skills/draft-outreach/SKILL.md)).
  marketingskills' test: delete the personalized opener; if the email still makes sense, the personalization failed.
  It also says one CTA, interest-based asks, no tracking pixels, 3-5 emails in all
  ([cold-email](https://raw.githubusercontent.com/coreyhaines31/marketingskills/main/skills/cold-email/SKILL.md)).
  Without a hook, Anthropic's `outreach-composer` writes a "plainly cold" email, because "a fake-warm opener is worse"
  (small-business plugin v1.35.1, [repo](https://github.com/anthropics/knowledge-work-plugins)).
- **Sequence length.** 4-7 touches, 3-4 days apart, under 80 words; a step 2 written as a reply beats a formal follow-up
  by about 30% ([benchmark](https://instantly.ai/cold-email-benchmark-report-2026)). For a founder, 3 touches over about
  10 days is the honest middle.
- **Reply handling.** Exit the sequence immediately on a reply, a booking or an opt-out
  ([Instantly](https://instantly.ai/blog/cold-email-sequence-best-practices/)). Classify replies as interested, not now,
  wrong person, out of office, unsubscribe or bounce, the taxonomy in Instantly's webhook events.
- **Booking.** Put a Cal.com link in the reply, with no API needed. A `BOOKING_CREATED` webhook signed with
  `x-cal-signature-256` updates the pipeline ([webhooks](https://cal.com/docs/developing/guides/automation/webhooks)).
  API keys allow 120 requests a minute, and Platform OAuth sign-ups closed on 15 December 2025
  ([API v2](https://cal.com/docs/api-reference/v2/introduction)).

### 5. CRM and pipeline

- **HubSpot.** The free CRM has 2 users and 1,000 contacts ([HubSpot](https://www.hubspot.com/products/crm)). Public OAuth
  apps get 110 requests per 10 seconds per account ([limits](https://developers.hubspot.com/docs/developer-tooling/platform/usage-guidelines)).
- **Attio.** Free for 3 seats and 50,000 records ([pricing](https://attio.com/pricing)). It offers OAuth for multi-workspace
  apps and API keys for one workspace ([auth](https://docs.attio.com/rest-api/guides/authentication)).
- **Pipedrive.** A daily token budget of 30,000 × plan multiplier × seats; OAuth apps get higher burst limits
  ([rate limits](https://pipedrive.readme.io/docs/core-api-concepts-rate-limiting)).
- **What a solo founder needs.** Stages (new → contacted → replied → meeting → proposal → won/lost), the next step and
  its date, the full thread, and a reply-rate metric. North's internal `leads` table plus an append-only
  `pipeline_events` table covers this; HubSpot becomes an optional one-way mirror later.

### 6. Legal

- **US (CAN-SPAM).** Accurate headers and subject, an ad disclosure, a valid physical postal address, a working opt-out
  for 30 days that is honored within 10 business days, and no exemption for B2B. Penalties reach $53,088 per email
  ([FTC](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)).
- **UK (PECR).** "You can email or text any corporate body", but "sole traders and some partnerships are treated as
  individuals" and need consent; the guidance is under review after the Data (Use and Access) Act
  ([ICO](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guide-to-pecr/electronic-and-telephone-marketing/electronic-mail-marketing/)).
  The Act raises PECR fines to £17.5M or 4% of turnover; the commencement date is unverified
  ([Mayer Brown](https://www.mayerbrown.com/en/insights/publications/2025/06/the-data-use-and-access-act-pecr-reform-rules-relating-to-electronic-marketing-and-cookies-in-the-uk)).
- **EU (GDPR).** Recital 47 "does not mean that direct marketing always constitutes a legitimate interest"; a balancing
  test is needed ([Morgan Lewis on EDPB 1/2024](https://www.morganlewis.com/blogs/sourcingatmorganlewis/2024/10/gdpr-when-can-data-controllers-rely-on-legitimate-interests-for-data-processing-new-guidelines-from-the-edpb)).
  The source of the data and the legitimate interest must be disclosed "at the latest at the time of the first
  communication" ([Art. 14](https://gdpr-info.eu/art-14-gdpr/)). The right to object must be shown then, and processing
  stops on objection ([Art. 21](https://gdpr-info.eu/art-21-gdpr/)). National ePrivacy law can still forbid cold B2B
  email: in Germany it needs prior consent ([IHK](https://www.ihk.de/bodensee-oberschwaben/recht/werbung-und-vertrieb/was-ist-erlaubt-1943228)).
- **Canada (CASL).** Consent is implied when the address was "conspicuously published", with no statement refusing
  messages, and the message relates to the person's role. The unsubscribe must stay valid 60 days and be honored within
  10 business days ([CASL s.10-11](https://laws-lois.justice.gc.ca/eng/acts/E-1.6/page-2.html)). The penalty ceiling is
  unverified (the CRTC page returned 403).
- **Google platform rules.** The Limited Use policy says "no surprises": disclose every action taken on the user's behalf
  ([User Data Policy](https://developers.google.com/terms/api-services-user-data-policy)).

### 7. Skill libraries and AI SDR products

- **[anthropics/knowledge-work-plugins](https://github.com/anthropics/knowledge-work-plugins)** (Apache-2.0). The `sales`
  plugin has 36 skills, including `draft-outreach`, `account-research`, `lead-triage`, `pipeline-review`,
  `handle-objection` and `schedule-meeting` ([tree](https://github.com/anthropics/knowledge-work-plugins/tree/main/sales/skills)).
  `small-business` adds `lead-finder` (40-60 researched companies, "Do not pad the list"), `outreach-composer` (a voice
  profile learned from sent mail; every send queued for approval) and `crm-autopilot`. Best fit for North: vendor these.
- **[coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills)** (MIT, about 55k stars, commits on
  2026-10-15). `cold-email` v2.2.0 with a deliverability reference, plus `prospecting`, `revops` and `emails`. Vendor
  `cold-email` and its references.
- **[clay-run/agent-plugins](https://github.com/clay-run/agent-plugins)**. The license is not stated, so do not vendor it yet.
  Registries such as claudskills.com only aggregate other repos; skip them.
- **11x.** Listed ZoomInfo and Airtable as customers after trials; former staff put churn at 70-80%
  ([TechCrunch](https://techcrunch.com/2025/03/24/a16z-and-benchmark-backed-11x-has-been-claiming-customers-it-doesnt-have)).
- **Artisan.** Banned by LinkedIn in December 2025 over its use of LinkedIn's name and data brokers that scraped the
  site; reinstated after two weeks ([TechCrunch](https://techcrunch.com/2026/01/07/yes-linkedin-banned-ai-agent-startup-artisan-but-now-its-back/)).
- **Clay Claygent and Apollo AI.** Both are vendor agents inside their suites (Apollo's MCP even buys domains and
  mailboxes) ([Apollo MCP](https://docs.apollo.io/docs/apollo-mcp.md)). Their documented failure modes are
  domain burn from volume, unverified lists and fake personalization; North avoids all three by design (below).

### 8. LinkedIn

- **User Agreement §8.2.** Bans tools "to scrape or copy the Services, including profiles", and "bots or other
  unauthorized automated methods", including automated messages and invites ([User Agreement](https://www.linkedin.com/legal/user-agreement)).
  Members using such tools risk "having their accounts restricted or shut down" ([help](https://www.linkedin.com/help/linkedin/answer/a1341387)).
- **No Sales Navigator export.** "We currently don't offer the option to export account and lead information from Sales
  Navigator into a CSV or XLS file" ([help](https://www.linkedin.com/help/sales-navigator/answer/a102031)). CRM sync
  needs Advanced Plus and only Salesforce and Dynamics get write-back ([CRM help](https://www.linkedin.com/help/sales-navigator/answer/a106005)).
  "Manual export" therefore means the founder reading profiles and typing what they choose into North's CSV upload.
- **Partner-only APIs.** The SNAP APIs need partner approval ([Microsoft Learn](https://learn.microsoft.com/en-gb/linkedin/shared/authentication/getting-access)).
- **Apollo bans "using any API with LinkedIn automations"** ([terms](https://www.apollo.io/terms)).
- **What North does.** It sends no LinkedIn message itself. It may suggest "connect manually with X" as a to-do in the
  brief, and LinkedIn *organic posting* belongs to Growth through official APIs.

## Comparison tables

| Provider | Auth for a SaaS | Entry cost | Limits | MCP | Terms notes | North use |
| --- | --- | --- | --- | --- | --- | --- |
| Apollo | API key (master for some); OAuth needs approval | Free; search 0 credits; enrich 1-9 credits | 200/min, 50k/day search | Yes, OAuth | No LinkedIn automation, no AI training, internal use | Phase 1 primary: search + enrich |
| Clay | Personal API key; MCP OAuth | Free 100 credits; Growth ~$446-495 for API | Per workspace, 429 | Yes, hosted + local | Terms unverified | Phase 2: signals, waterfalls |
| Hunter | API key; MCP OAuth/key | Free 50; $49/2,000 | 15/s finder, 10/s verify | Yes | — | Fallback finder + domain discovery |
| Exa | API key | $10/mo free; $7/1k | Undisclosed | Yes (MIT) | Avoid `people` category | Company and news discovery |
| PDL | API key | Free obfuscated; $98/350 credits | Per key | Unverified | Provenance unverified | Skip phase 1 |
| Crunchbase | Sales license | ~$20k/yr (third party) | Gated | Listed | Order-form terms | Skip |

| Verifier | Price | Results | Sandbox | Pick |
| --- | --- | --- | --- | --- |
| MillionVerifier | $89 / 50k, no expiry | ok, catch_all, unknown, disposable, invalid | Fixed-result test keys | Default |
| ZeroBounce | $39 / 2k; 100 free/mo | Rich sub-statuses (role, trap, abuse) | Unverified | Premium option |
| NeverBounce | $8 / 1k, 12-month expiry | 5 codes | Unverified | Alternative |

| Sender | Price | API plan | Auth | MCP | When |
| --- | --- | --- | --- | --- | --- |
| User's Gmail (now) | Workspace seat | Gmail API | OAuth (restricted scope) | — | Under ~20-30 cold/day |
| Instantly | $47-97/mo | Hypergrowth (third party) | Scoped Bearer key | Yes, key | Multi-inbox + warm-up |
| Smartlead | $39-94/mo | Pro | Query key | — | Same, cheaper |
| lemlist | $55-69/user | All | Basic auth key | Yes, OAuth | Multichannel; LinkedIn steps off |

## Recommendations for North (ranked)

1. **Compliance and suppression in code before any more live sending** (`packages/core`, `packages/db`, `packages/integrations`).
   - New migration `0019_sales_compliance.sql`: an append-only `suppressions` table (company_id, email, domain, reason
     `opt_out|bounce|complaint|manual|legal_block`, source action id). Leads gain `country`, `source_provider`,
     `source_url`, `signal` and `lawful_basis`, plus a `published_address_url` for CASL. There is also an append-only
     `lead_verifications` table (provider, status, sub_status, ref, checked_at).
   - New `packages/core/src/outreach/policy.ts`, called from `gate.ts` for `email.send.*`. It refuses when the address
     or domain is suppressed; the verification is not `valid` or older than 30 days; the country is unknown or
     consent-only (DE, AT and other UWG-style EU states, UK sole traders); the footer is missing; or the inbox's daily cap is reached.
   - `gmail.ts` `buildRawMessage`: append the footer (sender name, company, postal address from company settings, a
     "reply 'no' and I won't write again" line, and for EU/UK a one-line source-of-data plus right-to-object notice
     linking to a privacy page). Add `List-Unsubscribe: <mailto:…>, <https://…/u/{token}>` and `List-Unsubscribe-Post`.
     The worker's `/u/{token}` endpoint writes a suppression and never redirects (RFC 8058). Whether Google's DKIM
     signature covers these headers is unverified: test it.
   - `apps/worker/src/services/replies.ts`: mark bounces `bounced` and suppress them (today they are only skipped).
     Classify reply text. Opt-out phrases write a suppression right away (K0), well inside the 2-day and 10-day limits.
2. **Licensed-provider adapters behind North's own tools, never raw vendor MCP** (`packages/integrations/src/live/`).
   - Add `apollo.ts` (people search, bulk enrich, org job postings), `hunter.ts`, `exa.ts`, `millionverifier.ts`, each
     with a sandbox twin under `sandbox/` driven by fixtures and MillionVerifier's test keys. That fits the under-$100 dev budget.
   - Expose them to agents as in-process MCP tools such as `leads.search_provider`, `leads.enrich`, `leads.verify`
     (`packages/agents/src/runtime/`), like `memory_search`. Credit-spending calls run inside a per-task credit cap.
   - New ADR "user-pasted API keys": a `connections` row with kind `api_key`, encrypted under ADR 0008, validated with a
     cheap identity call; providers added to `CONNECTION_PROVIDERS` in `packages/core/src/connections.ts`.
   - Keep Apollo-sourced personal data out of pgvector memory and every cross-tenant cache (Apollo §3).
3. **Split `agents/sales.yaml` into specialist personas**, with a draft → critique → revise loop (see the table).
   - Update the `lead_research` guide to allow "licensed providers on the user's connection" and require
     `source_provider`, `source_url` and `signal` for each lead.
   - Add task types `reply_triage` and `pipeline_review` to `packages/core` `TaskType` and `task-guides.ts`.
4. **Approve sequences, not single emails.** The first-contact card approves step 1 and up to two fixed-text follow-ups
   (days 3-4 and 8-10), one card per batch as today. Follow-ups run as K1 and are cancelled automatically by any reply,
   bounce, opt-out or booking (`step.waitForEvent` in Inngest).
   - Let batch size grow with health: 5 → 10 → 20, never above the inbox cap (default 20 a day). Two clean weeks earn
     the next step; a stop-loss trip drops one step and opens a K1 notice.
5. **Deliverability guard as code, plus an agent for advice.**
   - New `packages/core/src/outreach/deliverability.ts`: DNS checks (`node:dns` `resolveTxt` for SPF, DMARC, and the
     DKIM selector when known) at connect time and weekly. Live first contact is refused without DMARC.
   - Stop-loss: more than 2% hard bounces in a batch or any spam complaint pauses sending (K1). The send window is
     08:30-10:30 in the recipient's time zone, sends are spaced 3-8 minutes apart, and opens are not tracked.
6. **Pipeline: internal first.** An append-only `pipeline_events` table (stage changes with evidence refs) plus a
   PipelineBoard on the company page. A signed Cal.com `BOOKING_CREATED` webhook in `apps/worker` moves a lead to
   `meeting`; its evidence is the booking `uid`. HubSpot or Attio mirroring comes later behind the gate.
7. **Gmail scope and verification plan.** Keep `gmail.send`. Plan the CASA assessment for `gmail.readonly` before public
   launch; reply classification needs message bodies, so `gmail.metadata` would not be enough. List the AI processing
   of replies in the privacy policy (Limited Use, "no surprises").
8. **Vendor skills** (pinned SHAs with license check) into `packages/agents/skills/`: Anthropic `draft-outreach`,
   `lead-triage`, `pipeline-review`, `handle-objection`, `lead-finder`, `outreach-composer` (Apache-2.0), and
   marketingskills `cold-email` + `references/deliverability.md` (MIT). North-authored: `north-lead-sourcing-policy`,
   `north-compliance-footer`, `north-reply-triage`, `north-sales-critic-rubric`.

### Specialist personas

| Persona | Skills | Tools / connectors | Output | Evidence of done | Tier |
| --- | --- | --- | --- | --- | --- |
| Lead Researcher | lead-finder, north-lead-sourcing-policy | apollo search/enrich, hunter, exa (company/news), web.fetch, memory.search, leads.write | LeadList: ≤50 leads, each with signal + source_url | Rows stored with provider refs; each source_url fetches 200; none suppressed | K0 (credit spend in task cap; above it K2) |
| Deliverability Guard (mostly code) | cold-email deliverability ref | DNS, verifier API, send counters | Health report, caps, pauses | Verification ids per lead; DNS report artifact | K0 checks; K1 pause notice; raising caps or adding a domain K2 |
| SDR Copywriter | draft-outreach, outreach-composer, cold-email, north-compliance-footer | memory.search (voice, thesis), email.draft | EmailSequence: 2-3 variants per batch, 3 steps | Draft version that passed the critic; footer present | K0 drafts |
| Sales Critic | north-sales-critic-rubric | none (reads drafts and lead rows) | Critique with scores: specificity test, claim check against memory, ≤90 words, one ask, no AI tells | Critique artifact linked to the draft version; score ≥ threshold | K0 |
| Pipeline Manager / Reply Handler | lead-triage, north-reply-triage, handle-objection, pipeline-review | email.replies, email.send (reply), crm.read/write, Cal.com webhook | PipelineUpdate, reply drafts, weekly pipeline review | Gmail reply message id; booking uid; stage event row | K1 in-thread reply; K2 for price or terms commitments; suppression writes K0 |

First contact stays K2, one card per batch, as the founder decided. Under "Review drafts", reply drafts go to the review
queue, which does not spend the 3-card quota. Changing the postal address or footer, or enabling a consent-only region,
is K3. Live keys are entered by the founder only.

### What the founder signs up for, in order

1. **Domain DNS on the existing Workspace**: SPF, DKIM and DMARC `p=none` with `rua` (free). This is needed for customer
   mail anyway, and North's guard checks it.
2. **A verifier**: MillionVerifier (100 free credits, then $89 per 50k with no expiry), or ZeroBounce's 100 free a month.
3. **Apollo Free**: people search costs 0 credits; enrichment uses the free allowance. Paste the API key into North.
4. **Cal.com**: a free booking link (individual plan pricing unverified), plus a webhook to North.
5. **Hunter Free (50 credits) and Exa ($10/mo free)**: discovery and fallback finding.
6. **Only after 2-3 clean weeks and demand above about 20 a day**: a secondary domain with 2-3 inboxes, 3-4 weeks of
   warm-up, then Instantly Hypergrowth ($97) or Smartlead Pro ($94).
7. **Later**: Clay Launch or Growth for signals at scale, and HubSpot Free as a mirror.

Month-1 cost beyond Workspace is about $0-90; North's own dev and test costs stay at $0 through the sandbox adapters.

## Risks

- **Unclear whether Apollo allows North's use.** §3(d)(3) bans access "on behalf of any person or entity other than you".
  A user-owned key used for the user's own company is the safest reading, but Apollo has not confirmed it: ask Apollo
  Partnerships before marketing "Apollo built in".
- **Domain burn.** One bad batch from the founder's primary Workspace domain can hurt their customer mail too. Mitigation:
  verification, caps, stop-loss, and a secondary domain before volume.
- **Restricted-scope review.** The CASA assessment adds time and effort before public launch, and the yearly
  revalidation recurs (cost not stated by Google).
- **Region misclassification.** A wrong `country` sends to a consent-only jurisdiction. Default to block when unknown.
- **Prompt injection through enrichment and replies.** Treat them as data inside data blocks (CLAUDE.md, Anthropic skill rule).
- **Vendor drift.** Clay's pricing changed in March 2026 and Instantly retired API v1 in January 2026 (third party)
  ([Emelia](https://emelia.io/software/instantly)). Pin adapters to documented versions.

## Open questions for the founder

1. Is the target market US, UK, EU or Canada? This sets which regions open at launch; EU and DE default to blocked.
2. Which postal address goes in every email (CAN-SPAM)? A virtual mailbox is common.
3. Is first contact OK from the primary domain at 5-20 a day, or should a secondary domain come before the first batch?
4. Should North ask Apollo for partner OAuth now (approval wait), or ship with pasted keys?
5. Which verification budget per lead, and should a catch-all ever be sent (as a separate K2 option)?
6. Under Autopilot, may the Pipeline Manager send in-thread replies (K1) that propose meeting times?

## Sources

- Apollo: [OAuth](https://docs.apollo.io/docs/use-oauth-20-authorization-flow-to-access-apollo-user-information-partners) · [FAQ](https://docs.apollo.io/docs/developer-faqs.md) · [API pricing](https://docs.apollo.io/docs/api-pricing.md) · [rate limits](https://docs.apollo.io/reference/rate-limits.md) · [sequence endpoint](https://docs.apollo.io/reference/add-contacts-to-sequence) · [MCP](https://docs.apollo.io/docs/apollo-mcp.md) · [MCP product](https://www.apollo.io/product/mcp) · [pricing](https://www.apollo.io/pricing) · [terms](https://www.apollo.io/terms)
- Clay: [docs index](https://developers.clay.com/llms.txt) · [auth](https://developers.clay.com/public-api/authentication.md) · [rate limits](https://developers.clay.com/public-api/rate-limits.md) · [webhooks](https://developers.clay.com/public-api/webhooks.md) · [searches](https://developers.clay.com/searches.md) · [signals](https://developers.clay.com/signals.md) · [quickstart](https://developers.clay.com/quickstart.md) · [MCP guide](https://www.clay.com/guides/clay-mcp) · [pricing](https://www.clay.com/pricing) · [agent-plugins](https://github.com/clay-run/agent-plugins) · [clay.earth listing](https://mcpservers.org/en/servers/clay-inc/clay-mcp)
- Alternatives: [Hunter API](https://hunter.io/api-documentation/v2) · [Hunter pricing](https://hunter.io/pricing) · [Hunter MCP](https://hunter.io/mcp) · [Prospeo API](https://prospeo.io/api-docs) · [ColdIQ on Prospeo](https://coldiq.com/blog/prospeo-pricing) · [SyncGTM on Prospeo](https://syncgtm.com/blog/prospeo-review) · [PDL pricing](https://www.peopledatalabs.com/pricing) · [PDL limits](https://docs.peopledatalabs.com/docs/usage-limits) · [Exa pricing](https://exa.ai/pricing) · [Exa search](https://exa.ai/docs/reference/search) · [Exa Websets](https://exa.ai/docs/websets/overview) · [Exa MCP](https://github.com/exa-labs/exa-mcp-server) · [Vendr Crunchbase](https://www.vendr.com/marketplace/crunchbase)
- Verification: [ZeroBounce status codes](https://www.zerobounce.net/docs/email-validation-api-quickstart/v2-status-codes) · [ZeroBounce pricing](https://www.zerobounce.net/email-validation-pricing) · [NeverBounce API](https://developers.neverbounce.com/reference/single-check) · [NeverBounce pricing](https://neverbounce.com/pricing) · [MillionVerifier API](https://developer.millionverifier.com/) · [MillionVerifier](https://www.millionverifier.com/)
- Deliverability: [Gmail guidelines](https://support.google.com/a/answer/81126) · [Gmail FAQ](https://support.google.com/a/answer/14229414) · [Workspace limits](https://knowledge.workspace.google.com/admin/gmail/gmail-sending-limits-in-google-workspace) · [Yahoo](https://senders.yahooinc.com/best-practices/) · [Microsoft](https://techcommunity.microsoft.com/blog/outlook/strengthening-email-security-outlook-new-requirements-for-high-volume-senders/4399730) · [RFC 8058](https://www.rfc-editor.org/rfc/rfc8058.html) · [Spam Resource, Nov 2025](https://www.spamresource.com/2025/11/google-warns-sender-requirements.html) · [Growbots on warm-up](https://www.growbots.com/blog/google-bans-cold-email-warmup/)
- Google platform: [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes) · [security assessment](https://support.google.com/cloud/answer/13465431) · [User Data Policy](https://developers.google.com/terms/api-services-user-data-policy)
- Sending: [Instantly auth](https://developer.instantly.ai/getting-started/authorization.md) · [Instantly rate limit](https://developer.instantly.ai/getting-started/rate-limit.md) · [webhook events](https://developer.instantly.ai/guides/webhook-events.md) · [OAuth flow](https://developer.instantly.ai/guides/oauth-connection-flow.md) · [Instantly MCP](https://developer.instantly.ai/mcp/authentication.md) · [Instantly pricing](https://instantly.ai/pricing) · [Nango on Instantly](https://nango.dev/docs/integrations/all/instantly) · [Emelia on Instantly](https://emelia.io/software/instantly) · [Smartlead API](https://api.smartlead.ai/reference/welcome) · [Smartlead pricing](https://www.smartlead.ai/pricing) · [Moveo on Smartlead](https://docs.moveo.ai/docs/integrations/smartlead) · [lemlist auth](https://developer.lemlist.com/api-reference/getting-started/authentication) · [lemlist docs](https://developer.lemlist.com/) · [lemlist pricing](https://www.lemlist.com/pricing)
- Methodology: [Instantly benchmark 2026](https://instantly.ai/cold-email-benchmark-report-2026) · [Instantly sequences](https://instantly.ai/blog/cold-email-sequence-best-practices/) · [marketingskills cold-email](https://raw.githubusercontent.com/coreyhaines31/marketingskills/main/skills/cold-email/SKILL.md) · [deliverability ref](https://raw.githubusercontent.com/coreyhaines31/marketingskills/main/skills/cold-email/references/deliverability.md) · [Cal.com API v2](https://cal.com/docs/api-reference/v2/introduction) · [Cal.com webhooks](https://cal.com/docs/developing/guides/automation/webhooks)
- CRM: [HubSpot CRM](https://www.hubspot.com/products/crm) · [HubSpot limits](https://developers.hubspot.com/docs/developer-tooling/platform/usage-guidelines) · [Attio pricing](https://attio.com/pricing) · [Attio auth](https://docs.attio.com/rest-api/guides/authentication) · [Pipedrive limits](https://pipedrive.readme.io/docs/core-api-concepts-rate-limiting)
- Legal: [FTC CAN-SPAM](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business) · [ICO PECR](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guide-to-pecr/electronic-and-telephone-marketing/electronic-mail-marketing/) · [Mayer Brown DUAA](https://www.mayerbrown.com/en/insights/publications/2025/06/the-data-use-and-access-act-pecr-reform-rules-relating-to-electronic-marketing-and-cookies-in-the-uk) · [GDPR Art. 14](https://gdpr-info.eu/art-14-gdpr/) · [GDPR Art. 21](https://gdpr-info.eu/art-21-gdpr/) · [Morgan Lewis EDPB](https://www.morganlewis.com/blogs/sourcingatmorganlewis/2024/10/gdpr-when-can-data-controllers-rely-on-legitimate-interests-for-data-processing-new-guidelines-from-the-edpb) · [IHK on UWG](https://www.ihk.de/bodensee-oberschwaben/recht/werbung-und-vertrieb/was-ist-erlaubt-1943228) · [CASL](https://laws-lois.justice.gc.ca/eng/acts/E-1.6/page-2.html)
- Skills and AI SDRs: [knowledge-work-plugins](https://github.com/anthropics/knowledge-work-plugins) · [sales skills tree](https://github.com/anthropics/knowledge-work-plugins/tree/main/sales/skills) · [sales .mcp.json](https://raw.githubusercontent.com/anthropics/knowledge-work-plugins/main/sales/.mcp.json) · [draft-outreach](https://raw.githubusercontent.com/anthropics/knowledge-work-plugins/main/sales/skills/draft-outreach/SKILL.md) · [marketingskills](https://github.com/coreyhaines31/marketingskills) · [apollo-skills (GraphQL)](https://claude.com/marketplace/plugins/apollo-skills) · [TechCrunch 11x](https://techcrunch.com/2025/03/24/a16z-and-benchmark-backed-11x-has-been-claiming-customers-it-doesnt-have) · [TechCrunch Artisan](https://techcrunch.com/2026/01/07/yes-linkedin-banned-ai-agent-startup-artisan-but-now-its-back/)
- LinkedIn: [User Agreement](https://www.linkedin.com/legal/user-agreement) · [prohibited software](https://www.linkedin.com/help/linkedin/answer/a1341387) · [no export](https://www.linkedin.com/help/sales-navigator/answer/a102031) · [CRM sync](https://www.linkedin.com/help/sales-navigator/answer/a106005) · [SNAP access](https://learn.microsoft.com/en-gb/linkedin/shared/authentication/getting-access)
