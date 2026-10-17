# Vertical playbooks and idea-to-playbook routing for an AI-staffed company (as of 2026-10-16)

Scope: per-vertical differentiation of team, tools, plan and metrics, plus the routing mechanism. The generic
0-to-1 playbook, the 30-day journey and the team-proposal design are in
`docs/research/startup-playbook-and-journey.md` and are not repeated here; this note only states where a vertical
*overrides* that base. Method: WebSearch (budget exhausted mid-task), WebFetch of primary vendor pages and docs,
two YouTube transcripts via vidIQ (credits ran out before the newsletter, agency and local-service transcripts
could be pulled), GitHub repo search, and the local copy of `anthropics/knowledge-work-plugins` small-business
skills. Reddit was not fetched. Claims from affiliate/SEO blogs are marked **(secondary)**; figures labelled
**North proposal** are design choices, not findings. Every budget split below is a North proposal because no
source publishes a per-vertical split.

## Q1. Taxonomy: which founder/startup types materially change the playbook?

### Takeaway
A business-model taxonomy with ~10 leaf types is enough; what actually changes the playbook is five axes
(what is sold, who pays, how it is delivered, how customers are acquired, what is built first). Starter Story
and Durable already organise their catalogues by nearly the same cut, which is reassuring for a classifier.

### Cited Findings
- Starter Story groups its idea database by business type with median monthly revenue per group, e.g. Micro SaaS
  829 ideas/$20K, Productized Services 569/$40K, Marketplaces 297/$200K, Freemium & Open Source 166/$30K,
  Consumer iOS apps 79/$40K, Agencies 740/$200K, GPT Wrapper Ideas 176/$20K, Niche Blog 274/$10K, Automation
  Ideas 869/$90K — [Starter Story ideas](https://www.starterstory.com/ideas)
- Durable's homepage routes founders into six service categories: Home Services, Health & Wellness, Professional
  Services, Food & Events, Pet & Auto, Creative & Digital — [Durable](https://durable.com/)
- Rob Walling's stair-step: step 1 is "small bets on someone else's platform" (app-store integrations, small
  ecommerce stores, info products, courses) with "a single marketing approach usually in an ecosystem"; step 3 is
  standalone SaaS; "if you're not a software person, maybe don't try to build software in the early days" —
  [Bootstrapped Founder interview](https://thebootstrappedfounder.com/rob-walling-stair-stepping-into-saas-success/)
- Anthropic's Founder's Playbook keeps four stages (Idea, MVP, Launch, Scale) for every type and frames the founder
  "shifting from individual contributor to orchestrator" — [claude.com](https://claude.com/blog/the-founders-playbook)
- Polsia's reviewer says it "suits validated ideas where execution speed matters more than precision" and
  advises against regulated, technical or high-stakes categories; it asked no intake questions and chose an
  AI-SDR agency itself — [Preuve Polsia review](https://preuve.ai/blog/polsia-review.md)
- RevenueCat: only 17.3% of newly launched subscription apps reach $1K MRR within two years, 4.6% reach $10K;
  median time to $1K is 58 days — [RevenueCat SoSA 2026](https://www.revenuecat.com/state-of-subscription-apps-2026/)
- a16z's open-source framework has three sequential fits — project-community fit (stars, contributors, PRs),
  product-market fit (downloads, usage), value-market fit (revenue) — which no other vertical has —
  [a16z](https://a16z.com/open-source-from-community-to-commercialization/)

### Inferences (North taxonomy proposal)
| id | Leaf type | What is sold | Who pays | Build-first artefact | Acquisition default | Why it is its own playbook |
| --- | --- | --- | --- | --- | --- | --- |
| `ecom_dtc` | E-commerce / dropshipping / DTC | physical goods | consumer | store + product page | paid social, TikTok Shop | product research and ads replace interviews; supplier and refund risk |
| `saas_b2b` | B2B SaaS (sales-assisted) | software subscription | business | landing + demo | outbound, content | design partners, pricing before build |
| `devtool_plg` | Developer tool / PLG / open-source-first | software, usage | developer then company | repo + docs + free tier | SEO/LLM, GitHub, community | three-fit sequence; free-to-paid funnel |
| `consumer_app` | Consumer mobile app | subscription | consumer | TestFlight + paywall | ASO, creators | store-review cycle, D1/D7/D30 and trial-to-paid |
| `marketplace` | Marketplace | transactions (take rate) | both sides | supply list + concierge matching | constrained geo/category | liquidity before product; two funnels |
| `media_newsletter` | Newsletter / media / creator | attention, sponsorships, paid subs | sponsors, readers | first issue + signup page | recommendations, referral, guest posts | growth staged by subscriber count |
| `agency_service` | Agency / productised service | labour outcome | business | offer + case study | warm/cold outreach, Google Maps | offer design (Hormozi) and delivery capacity |
| `local_service` | Local / physical service | on-site service | local consumer/business | Google Business Profile + booking | GBP, reviews, speed-to-lead | geography, phone/text, licences |
| `info_course_community` | Courses / info products / community | knowledge | consumer/prosumer | offer + pre-sale + cohort | audience, email list, Skool discovery | pre-sell before recording |
| `micro_saas_indie` | AI wrapper / micro-SaaS / indie | small software | prosumer | shipped v1 | launch sites, build in public | ship-and-launch cadence, kill fast |
| `hardware` | Hardware | physical product | consumer/business | prototype, pre-order | crowdfunding | out of scope for North v1 (see Gaps) |

Five classification axes to derive the leaf: `offer_kind` (physical | software | content | labour | access),
`payer` (consumer | business | developer | both sides | sponsor), `delivery` (shipped | hosted | on-site |
downloaded), `acquisition_prior` (paid social | search/LLM | outbound | community | local), `first_artifact`
(store | landing | repo | app build | GBP | issue | offer doc). A vertical is a point in that space; modules
attach to axis values, not only to the leaf (section Q6).

### Gaps
- Hardware was not researched (crowdfunding, certification, MOQ); treat as "refuse politely with a reason" in v1.
- No source gives a validated count of how many vertical playbooks a platform needs; Starter Story's 40+ lists are
  marketing buckets, not a taxonomy.

## Q2. Playbook cards per vertical

### Takeaway
The verticals share the base skeleton (frame, ICP, riskiest assumptions, smoke test, first customers, retention)
but differ in what "validated" means, which department leads week 1, which connectors are mandatory, and which
legal rules bite. The cards below give only the overrides; base-doc steps S0-S10 remain the default.

### Cited Findings (evidence the cards rely on)
E-commerce / dropshipping
- Shopify's own guide has nine steps: fit check, niche, competitor research, supplier (delivery speed, inventory
  reliability, returns, performance history), products and pricing with samples, store build, business structure,
  finances (bank account, EIN, sales tax), marketing; metrics to watch: best/worst sellers, ROAS, profit by product,
  traffic sources; Shopify Collective partners "often offer 20-50% profit margins" —
  [Shopify](https://www.shopify.com/blog/how-to-start-dropshipping)
- Practitioner walkthrough (Jordan Welch, 579K views, 2026-01): six steps — AI store builder, Shopify account,
  find product, customise, make ads, launch; winning-product criteria "trending and recently going viral",
  "unique and hard to find in stores", "solve a real problem"; TikTok Shop spy data (units sold last 7 days);
  ChatGPT deep research to "validate" the product; AI image ads; Meta ads at "$30 to $100 a day", broad
  targeting; claims a sale in 24-48h. He also states "we even generated customer testimonial examples with
  chatgpt" for the store — [YouTube _KmXbRiJVyg](https://www.youtube.com/watch?v=_KmXbRiJVyg) (transcript via vidIQ)
- FTC final rule (announced 2024-08-14, effective 60 days after Federal Register publication) bans fake or
  AI-generated reviews and testimonials, incentivised reviews tied to sentiment, undisclosed insider reviews,
  review suppression and fake social-media indicators; civil penalties for knowing violators —
  [FTC](https://www.ftc.gov/news-events/news/press-releases/2024/08/federal-trade-commission-announces-final-rule-banning-fake-reviews-testimonials)
- Meta ad standards: "The products and services promoted in an ad must match those promoted on the landing
  page"; weight-loss/health products must target 18+; deceptive content prohibited —
  [Meta](https://transparency.meta.com/policies/ad-standards/)
B2B SaaS and dev tools
- Supademo founder (Starter Story, 2026-03): "talking to probably a 100 plus founders" before building; first-100
  playbook = (1) capture existing demand with bottom-funnel competitor comparison pages and free tools ("roughly
  20% of all of our traffic and converts like 15 to 20% of all visitors into signup"), (2) "doing things that
  don't scale" by building free demos for founders in public threads, (3) distribution density: "30-40% SEO and
  LLM, 30% word of mouth/watermarks/referrals, 20% building in public on LinkedIn" —
  [YouTube l4WEqPX52Cg](https://www.youtube.com/watch?v=l4WEqPX52Cg) (transcript via vidIQ)
- Walling: B2B SaaS without an audience can use "SEO, content, cold outreach, integrations, in-person events, and
  affiliate programs" — [Bootstrapped Founder](https://thebootstrappedfounder.com/rob-walling-stair-stepping-into-saas-success/)
- a16z open source: project-community fit measured by GitHub stars, collaborators, PRs; product-market fit "by
  downloads and usage"; value-market fit by revenue; models = support/services, open core, SaaS —
  [a16z](https://a16z.com/open-source-from-community-to-commercialization/)
Consumer mobile app
- RevenueCat 2026 medians: download-to-trial 5-6% (Business 9.1%); trial-to-paid 34.2% North America, 43.5%
  Travel, 22.2% Photo & Video; longer trials convert better (17-32 days 42.5% vs ≤4 days 25.5%); download-to-paid
  D35 10.7% hard paywall vs 2.1% freemium; 55% of 3-day-trial cancellations happen on day 0; AI-powered apps churn
  ~30% faster; median monthly revenue one year after launch ≈ $72 —
  [RevenueCat](https://www.revenuecat.com/state-of-subscription-apps-2026/)
- Retention medians (MWM, Apr 2026 catalogue): D1 27.3%, D7 9.2%, D30 3.9%; top decile D30 ≈ 10.9%; Pushwoosh
  reports iOS D7 6.89% / D30 3.10% — figures conflict by population —
  [MWM](https://mwm.ai/glossary/retention) (secondary), [Pushwoosh](https://www.pushwoosh.com/blog/increase-user-retention-rate) (secondary)
Marketplace
- Lenny part 1: "the best way to get big is by first going small"; constrain geography when supply and demand
  meet in person, else category; Uber launch goal "over 30 drivers, shooting for ETA of less than 15 minutes";
  OpenTable "50-100 concentrated restaurants in a city"; Etsy launched with three categories; Thumbtack the
  exception — [Lenny's Newsletter](https://www.lennysnewsletter.com/p/how-to-kickstart-and-scale-a-marketplace)
- Part 2 as summarised by lenny-skills: "all that matters is supply"; pick the top two or three channels to
  bootstrap supply — [skills.sh](https://www.skills.sh/refoundai/lenny-skills/supply-demand-balance) (secondary)
Newsletter / media
- beehiiv staged plan: 0-100 direct outreach; 100-1,000 lead magnets, repurposing, partner creators,
  recommendation networks ("identify one or two channels capable of generating subscribers consistently");
  1,000-5,000 referral program, webinars, SEO, YouTube; 5,000-10,000 paid recommendations and ads; Rundown AI
  bought 10,000+ subs at $2.00 each with 37% open / 9.8% click; Lenny's first 1,000 came from two guest posts —
  [beehiiv guide](https://www.beehiiv.com/blog/the-ultimate-guide-to-growing-a-newsletter-from-0-to-10-000-readers)
- beehiiv monetisation: paid subscriptions, Ad Network, paid recommendations; growth tools: referral programs,
  Recommendations, pop-ups, email gates — [beehiiv features](https://www.beehiiv.com/features)
- Revenue at ~1,000 subscribers "$100 to $2,000+ per month"; baseline "$100-500/month with ads or affiliates";
  one reviewer earned ~$92/month in 10 months — [beehiiv blog](https://beehiivblog.beehiiv.com/p/how-much-money-can-you-make-from-1-000-newsletter-subscribers-in-2025) (vendor), [review](https://behindrankings.com/beehiiv-review/) (secondary)
Agency / productised service
- Hormozi market criteria: pain ("the pain is the pitch"), purchasing power, easy to target ("already has public
  groups, mailing lists, channels"), growing; value-equation steps: dream outcome → list problems → solutions →
  delivery vehicles → trim to highest-value/lowest-cost → bundle; enhancers scarcity, urgency, bonuses,
  guarantees, names — [EcomCrew summary](https://www.ecomcrew.com/100m-offers-book-summary/) (secondary)
- Starter Story: Productized Services median $40K/mo across 569 cases; Agencies $200K/mo across 740 —
  [Starter Story](https://www.starterstory.com/ideas)
- Adam Erhart "Map Gap" method: audit Google Maps listings for missing reviews/phone answering/website, outreach,
  sell reviews/AI receptionist/websites; "10 clients into $5K/month" — [YouTube haB4btatX7Q](https://www.youtube.com/watch?v=haB4btatX7Q) (description only; transcript not pulled)
Local service
- Jobber AI: AI Receptionist answers calls/texts 24/7, books jobs, captures leads "always working within the
  limits you set"; custom report builder; suggested automations; Rewrite; Recommendations blending the business's
  data with "thousands of home service companies" — [Jobber](https://www.getjobber.com/ai/)
- Podium 26.7: Jerry auto re-engages leads on price drops/new inventory, Larry (voice) soft-books jobs, five-minute
  timed pause when a human joins, escalation tasks by rule, QuickBooks class sync, job checklists —
  [Podium](https://www.podium.com/whats-new/26-7)
- GBP checklist (vendor): primary category, service area by ZIP, local number, 20+ photos, direct review link;
  "respond within 5 minutes = 21x" is an unverified marketing claim —
  [schedulingkit](https://schedulingkit.com/checklists/home-services-business-start) (secondary), [pushleads](https://pushleads.com/how-local-service-businesses-convert-google-business-profile-leads-in-under-5-mi/) (secondary, unverified)
Courses / community
- Kajabi Cofounder interviews the creator, then outputs a product roadmap, offers, sales pages and emails "in
  your voice", and price/bundle/upsell recommendations; included in every plan — [Kajabi](https://kajabi.com/cofounder)
- Skool pricing: Hobby $9/mo with 10% transaction fee, Pro $99/mo with 2.9% — [Skool](https://www.skool.com/pricing)
Indie / micro-SaaS
- Pieter Levels (MAKE): ideas from own problems, "micro niche" first; "Build only the core functionality";
  "Don't outsource building"; launch early and repeatedly on Product Hunt, Hacker News, The Next Web, Reddit and
  where the niche hangs out; grow organically, "don't hire without revenue"; ask users for money, no ads/data;
  ethics: no spam, manipulation or fake social — [readmake.com](https://readmake.com/)
- Marc Lou: small public bets, "ship fast, build painkillers not vitamins", launches on PH/Twitter/HN; revenue
  figures range $45K-$100K+/mo across sources — [Indie Hackers](https://www.indiehackers.com/post/how-marc-lou-phs-maker-of-the-year-makes-50k-every-month-with-multiple-products-45074ee30a) (secondary, primary page 403)
- Polsia: ~10% of companies ever made $1 (base doc [C2]).

### Inferences — playbook cards (overrides of the base S0-S10; thresholds are North proposals)
| Field | `ecom_dtc` | `saas_b2b` | `devtool_plg` | `consumer_app` |
| --- | --- | --- | --- | --- |
| Target customer | impulse buyer on social; one hero product | one ICP role in one segment; 3-5 design partners | individual developer, then their team | one job, one segment; iOS first |
| "Validated" means | product spy data (units/7d) + ≥200 targeted ad visitors + ≥5 paid orders at target margin ≥40% after COGS+ads | ≥10 Mom-Test interviews, ≥5 commitments, ≥3 paid design partners or LOIs | project-community fit (stars, contributors) then usage; ≥20 weekly active repos/users | 100+ TestFlight users; D1 ≥25%, D7 ≥10%; trial-to-paid ≥25% in target geo |
| Day 1-7 | niche + 3 product candidates with spy evidence; supplier shortlist (speed, returns); store built (K2 for Shopify plan); 3 AI image ad variants; K2 ad test ≤$50/day | ICP options, interview kit, outreach batch (K2), positioning, pricing form | README + docs + comparison pages; free tool or free tier spec; no interviews required but issue/forum mining | problem interviews + paper prototype; paywall and trial length decision; ASO keyword list |
| Day 8-30 | ad test readout; product page CRO; email/SMS flows; refund policy; kill product under 1.5 ROAS after $300 spend, rotate next candidate | smoke site, demo, design-partner onboarding, first invoice | launch on HN/PH/dev communities; weekly changelog; free→paid wall | TestFlight cohort; store listing; review-guideline check; soft launch in one country |
| Day 31-90 | second product / bundle; UGC via real customers (no incentives tied to sentiment); profit by product weekly | 10 paying; retention + 40% PMF survey | self-serve paid tier; usage-based pricing test | paid acquisition only after D7 ≥10%; creator seeding |
| Departments | Research (product), Growth leads, Design (creatives), Ops/Finance (margins, refunds); Engineering off | Research, Strategy lead, Sales, Engineering (site) | Engineering leads, Growth (SEO/LLM), Design docs | Design + Engineering lead, Growth (ASO), Research |
| Specialist personas | Product Scout, Creative Director (ad variants), Store Builder, Fulfilment & Returns Ops | Customer Discovery Lead, Pricing Strategist, Outbound SDR | DevRel Writer, Docs Engineer, Community Moderator | Mobile PM, Paywall/Retention Analyst, ASO Specialist |
| Connectors | Shopify (sandbox), Meta Ads, TikTok Shop, AutoDS/Zendrop or supplier, Omnisend/Klaviyo, Stripe/Shopify Payments | Gmail, Calendar, Stripe, CRM, Vercel | GitHub, npm/PyPI, docs host, Discord, Plausible | App Store Connect, RevenueCat, TestFlight, Meta/TikTok ads |
| Metrics (source) | ROAS, CPA, profit/product (Shopify analytics + ad platform); refund rate; delivery days | interviews, commitments, design partners, MRR (Stripe) | stars, contributors, downloads, WAU, free→paid (GitHub, registry, product analytics) | installs, trial start, trial→paid, D1/D7/D30 (RevenueCat, store console) |
| Budget split (North proposal) | 55% ads, 15% tools/apps, 15% samples+COGS float, 10% creative, 5% reserve | 40% build/hosting, 30% outreach tools, 20% research, 10% reserve | 50% build, 30% content/docs, 10% community, 10% reserve | 40% build, 25% ads/creators, 20% tools, 15% reserve |
| Main risks / rules | FTC review rule (no generated testimonials); Meta landing-page match; shipping-time disclosure; chargebacks; supplier stockouts; money leaves only the founder's ad account | CAN-SPAM/GDPR on outreach (K2 per batch); over-building before commitments | licence choice; community backlash on relicensing; cloud competition | store review rejection; subscription disclosure rules; AI-app churn (+30%) |
| Reference AI products to copy | Sidekick personas + slash commands; AutoDS spy + auto-fulfil; Minea daily winners; Moby agents w/ approval; Omnisend AI segments | Lindy use-case gallery; Supademo-style free tools | GitHub-native agents; LangGraph templates | RevenueCat benchmarks as thresholds |

| Field | `marketplace` | `media_newsletter` | `agency_service` | `local_service` | `info_course_community` | `micro_saas_indie` |
| --- | --- | --- | --- | --- | --- | --- |
| Target customer | one geo or one category; supply side first | one niche reader; sponsor persona second | one niche with pain + purchasing power + public groups | one service × one service area | people who already pay for the transformation | prosumer with a visible workaround |
| "Validated" means | supply density threshold hit (e.g. 30 suppliers or 50-100 listings) and ≥10 concierge matches completed | ≥100 subscribers from direct outreach, ≥40% open on first 3 issues, 1-2 repeatable channels | ≥3 paying clients from warm/cold outreach with a signed scope; delivery under 60% of price in hours | GBP live, ≥5 real reviews, ≥10 booked jobs, lead reply under 5 min | ≥10 pre-sales of the cohort/course before recording | shipped v1 + launch + ≥10 payers in 30 days, else kill |
| Day 1-7 | pick constraint; supply outreach batch (K2); manual matching sheet | niche, name, signup page, first issue drafted, 50 personal invites (K2) | offer doc via value equation; 3 case-study substitutes (free pilot); outreach list | GBP + booking page; licence/insurance check; review link; phone/text routing | offer + outline; waitlist + pre-sale page (K2 Stripe); audience audit | build v1 with known tools; pricing page; launch post drafts |
| Day 8-30 | demand launch only after density; single-player tools for supply | weekly cadence; recommendations swaps; lead magnet; referral at 1,000 | pilot delivery; testimonial requests (unincentivised); productise scope | respond-to-every-review routine; speed-to-lead automation; first ad test (Local Services) | beta cohort delivery; feedback loop; community seeded (Skool/Circle) | launch on PH/HN/niche; iterate daily; build in public |
| Day 31-90 | second geo/category only after copying what worked | monetise: sponsors or paid tier; ad network | retainers; hire contractor at capacity | second service or area; referral programme | evergreen funnel; upsell/bundle | 2nd product or double down |
| Departments | Sales (supply) leads, Ops, Research | Growth leads, Design, Strategy (sponsors) | Sales leads, Strategy (offer), Ops (delivery) | Ops leads, Growth (GBP/reviews), Sales (speed-to-lead) | Strategy (offer) leads, Growth, Design | Engineering + Growth; everything else off |
| Specialist personas | Supply Acquisition Lead, Liquidity Analyst, Trust & Safety Ops | Editor, Growth Partnerships Lead, Sponsor Sales | Offer Strategist, Outbound Lead, Delivery PM | GBP/Reviews Manager, Dispatcher/Receptionist, Estimator | Curriculum Designer, Launch Manager, Community Host | Shipper, Launch Writer |
| Connectors | Gmail, Sheets, Stripe Connect (payments stay user-owned), Calendar | beehiiv/Kit/Substack, X/LinkedIn, Stripe | Gmail, LinkedIn, Calendar, Stripe, proposal/e-sign | Google Business Profile, Jobber/Thryv/Podium, phone/SMS, QuickBooks | Kajabi/Skool/Circle, Stripe, email | Stripe, GitHub, Vercel, PH |
| Metrics | supply count, fill rate, time-to-match, GMV, take rate | subs, open/click, growth by source, unsub, sponsor CPM | pipeline, close rate, price/hour, utilisation, churn | leads, reply time, booked rate, reviews/rating, repeat | waitlist→pre-sale, cohort completion, refund rate | visitors→signup→paid, MRR, churn, days since last ship |
| Budget split (proposal) | 40% supply incentives (cash never custodied), 25% ops tools, 20% build, 15% reserve | 30% paid recs/ads after 1,000, 25% platform/tools, 25% design/content, 20% reserve | 40% outreach tools/data, 30% delivery tooling, 20% site, 10% reserve | 40% GBP/ads, 30% ops software, 20% site, 10% reserve | 35% ads to warm audience, 30% platform, 25% production, 10% reserve | 50% hosting/AI/APIs, 30% launch assets, 20% reserve |
| Main risks / rules | disintermediation; platform must not custody funds (North rule 6) | FTC endorsement disclosures for sponsors; list hygiene | scope creep; CAN-SPAM; no fake case studies | licences/insurance; review solicitation rules; no fake reviews | refund law; income claims; cohort dates | burnout; kill criteria |
| Reference AI products | — (none found) | beehiiv Recommendations/Ad Network; Kit Creator Network | Lindy role gallery; Hormozi offer skill | Jobber AI Receptionist; Podium Jerry/Larry; Thryv Lead Insights; Durable | Kajabi Cofounder (interview→roadmap→offer→copy→price) | Levels' launch list |

Shared-vs-different estimate: of the base doc's 11 steps and ~25 task types, the cards reuse S0, S1, S2, S5,
S9, S10 and the review/card machinery unchanged (≈60%); `ecom_dtc`, `marketplace`, `local_service` and
`media_newsletter` replace S3-S4 and S6-S8 with vertical modules (≈40%), consistent with the 60/40 brief.

### Gaps
- No per-vertical budget split exists in any source; splits above are proposals to be tuned from ledger data.
- Newsletter open-rate benchmarks conflict (20% "strong" vs 40-60% in vendor case studies); use the founder's own
  first three issues as the baseline.
- Course pre-sale benchmarks (what share of a waitlist buys a cohort) were not found before the search budget ran
  out; `info_course_community` validation thresholds are unanchored.
- Agency and local-service practitioner transcripts could not be pulled (vidIQ credits); only video descriptions
  were used.

## Q3. AI products already serving each vertical, and the features worth copying

### Takeaway
Vertical tools converge on the same four features — a named persona per job, a slash-command/task gallery,
proactive agents that act "with approval" inside the founder's own accounts, and an MCP endpoint — so North's
per-vertical module should expose exactly those four, not re-implement the vendor's product.

### Cited Findings
| Product (vertical) | Features documented | Approval model | Source |
| --- | --- | --- | --- |
| Shopify Sidekick (ecom) | Personas: Designer, Photo editor, Writer, Tech support, Marketer; slash commands `/product-description`, `/pricing-strategy`, `/weekly-summary`, `/low-stock-alert`, `/shipping-audit`, `/social-posts`, `/discount-code`, `/email-campaign`, `/build-collections`, `/marketing-mix`; writes ShopifyQL; creates customers/companies; "included with your Shopify plan. Features and usage limits vary by plan" | admin actions "limited to what each staff member's permissions allow"; secondary sources say it can "take the action, preview it or simply answer" | [Shopify](https://www.shopify.com/sidekick); [getkanal](https://getkanal.com/blog/shopify-sidekick-guide) (secondary) |
| AutoDS (ecom) | "800M+ top-selling products", TikTok/Facebook/Instagram spy, free AI store "based on our top 1% most successful designs", price & stock monitoring, automatic orders and tracking updates, AI title/description, AI video ad generator, "Claude AI chat-to-sell"; channels eBay, Shopify, FB Marketplace, Wix, WooCommerce, Etsy, Amazon, TikTok Shop; $1 trial | automation on by configuration | [AutoDS](https://www.autods.com/) |
| Zendrop (ecom) | AI-built store "preloaded with winning dropshipping products", AI Studio UGC video/image ads, sourcing from "thousands of manufacturers", US 3PL, print-on-demand | n/a | [Zendrop](https://www.zendrop.com/) |
| Minea (ecom) | "80M+ active ads", "10 Winning Products, Every Day", Meta/TikTok/Pinterest ad spy, shop spy (traffic, revenue, apps), AI ad analysis + transcript, screenshot creative search, one-click Shopify store; $49/$99/$199 per month | research only | [Minea](https://www.minea.com/) |
| Triple Whale Moby (ecom) | agents for acquisition, creative planning, budget allocation, retention, inventory, ops; Moby 2 manages ad campaigns, drafts emails, builds landing pages, forecasts inventory, "integrating with Meta, Google, and Shopify to act in accounts with approval"; 35+ tools incl. Deep Dive memo + deck | act with approval | [martechvibe](https://martechvibe.com/?p=50568) (secondary; vendor pages 403) |
| Omnisend (ecom email) | AI subject lines, content suggestions, product recommendations, dynamic content, brand-asset import, AI-built segments from a description, RFM, AI forms, MCP for ChatGPT/Claude | drafts | [Omnisend](https://www.omnisend.com/features/ai/) |
| beehiiv (newsletter) | referral programs, Recommendations, paid recommendations, pop-ups, email gates, Ad Network, paid subscriptions; July 2026 AI Copilot and Community (secondary) | n/a | [beehiiv](https://www.beehiiv.com/features); [skillscouter](https://skillscouter.com/beehiiv-review/) (secondary) |
| Kit (newsletter) | official MCP server (draft emails, query subscribers), AI subject lines, Creator Network cross-promotion | n/a | [tooldirectory](https://tooldirectory.ai/tools/kit-convertkit) (secondary, unverified) |
| Substack | no AI writing features as of April 2026; reader-side AI detector July 2026 | n/a | [inboxreads](https://inboxreads.co/blog/beehiiv-community-substack-ai-detector) (secondary) |
| Thryv (local) | AI-native growth platform (2026-08-04): AI websites, AI Lead Insights, Digital Marketing Score, AI social posts, "Boosts" campaigns managed by experts + AI; 100,000+ SMBs | expert-assisted | [Business Wire](https://secure.businesswire.com/news/home/20260804268074/en/Thryv-Launches-AI-Native-Growth-Platform-for-Small-Businesses) |
| Podium (local) | AI Salesperson/Scheduler/Marketer; Jerry auto re-engagement; Larry voice soft-booking; cross-channel memory; 5-min timed pause when a human joins; escalation tasks by rules; QuickBooks sync; text payments; 200+ integrations; pricing removed from site Q4 2025 | autonomous within rules; human-join pause | [Podium 26.7](https://www.podium.com/whats-new/26-7); [softwareone](https://platform.softwareone.com/product/ai-employee/PCP-2246-4336) (secondary) |
| Jobber AI (local) | AI Receptionist (calls/texts, books, "within the limits you set"), report builder from live data, suggested automations the owner switches on, Rewrite, Voice (100+ tasks), Recommendations from "thousands of home service companies" | owner enables each automation | [Jobber](https://www.getjobber.com/ai/) |
| Durable (local/service) | site in "30 seconds", CRM, bookings, AI image studio, AI assistant for posts/copy, SEO & GEO, reviews, payments; six category entry points | n/a | [Durable](https://durable.com/) |
| Kajabi (courses) | Cofounder (interview → roadmap → offers → pages/emails → pricing), Expert Agents "trained on your content", MCP; Creator Studio video repurposing (secondary) | drafts | [Kajabi AI](https://kajabi.com/ai); [Cofounder](https://kajabi.com/cofounder) |
| Circle (community) | AI Copilot, AI Agents (answer members, moderate), AI Workflows, AI Summaries; 12M users | agents act in-community | [createwith](https://www.createwith.com/tool/circle/updates/circle-reaches-12-million-users-ships-ai-agents-and-custom-app-builder-in-2025) (secondary) |
| Skool (community) | $9 Hobby/10% fee, $99 Pro/2.9%; affiliates; no AI feature listed | n/a | [Skool](https://www.skool.com/pricing) |
| Lindy (horizontal) | use cases grouped by role (Marketing, Sales, Support, Ops/Finance, Product/Eng, Everyday); "Describe the job in your own words and Lindy runs it" | per-action confirmation (base doc [C10]) | [Lindy](https://www.lindy.ai/templates) |
| Polsia (horizontal) | nine agents (orchestrator, social, email outreach, support, ads, finance/Stripe, planning, competitor research, code); first outputs in ~10 min incl. a public X post and cold emails; no intake questions | none | [Preuve](https://preuve.ai/blog/polsia-review.md) |

### Inferences
- Copy for `ecom_dtc`: Sidekick's persona-per-job and slash-command gallery as North task types; AutoDS/Minea's
  "daily winners with units-sold evidence" as the `product_research` artefact with cited data; Moby's "act in
  the founder's ad account with approval" maps 1:1 to a K2 card with a spend cap.
- Copy for `local_service`: Podium's timed pause when a human joins a thread and Jobber's "limits you set" are
  the right model for North's Ops/Sales dials; both run inside the founder's own phone/SMS numbers.
- Copy for `info_course_community`: Kajabi Cofounder's order (interview → roadmap → offer → copy → price) is the
  course playbook's week 1 in one flow.
- Anti-pattern to avoid: Polsia's zero-question intake and public posting before validation; the Welch
  walkthrough's generated testimonials, which the FTC rule forbids.
- Every vendor is adding MCP (Omnisend, Kit, Kajabi); North connectors for these verticals should be MCP-first.

### Gaps
- Triple Whale's own pages returned 403; feature list is from trade press.
- No independent evidence that Sidekick's 2026 "custom app generation" exists (conflicting blogs); not relied on.
- Skool AI, Circle feature depth, Kit's AI and Jobber "Copilot" naming were not confirmed on primary pages.

## Q4. Expert playbooks per vertical worth encoding (steps and exit criteria)

### Takeaway
Most expert playbooks are stage lists without numeric exit criteria; the ones with numbers (Uber 30 drivers /
ETA <15 min, OpenTable 50-100 restaurants, beehiiv's subscriber bands, RevenueCat medians, Supademo's 15-20%
free-tool conversion) should be encoded as default thresholds the founder can edit.

### Cited Findings
| Playbook | Vertical | Concrete steps | Exit criteria stated | Encode as |
| --- | --- | --- | --- | --- |
| Shopify "How to start dropshipping" | ecom | 9 steps (fit, niche, competitors, supplier, products/pricing with samples, store, structure, finances, marketing) | none numeric; monitor ROAS, profit/product | module `ecom.launch_checklist` — [Shopify](https://www.shopify.com/blog/how-to-start-dropshipping) |
| Welch 2026 walkthrough | ecom | 6 steps; 3 product criteria; spy data; AI ads; $30-100/day broad Meta | "sale within 24-48h" (claim) | `ecom.product_scout` thresholds; strip testimonial generation — [YouTube](https://www.youtube.com/watch?v=_KmXbRiJVyg) |
| Walling stair-step / SaaS Playbook | saas, indie | platform-bound small products → multiple → standalone SaaS | revenue replaces founder time (~$8K/mo example) | routing rule: non-technical founder → `agency_service`/`info` or platform app first — [Bootstrapped Founder](https://thebootstrappedfounder.com/rob-walling-stair-stepping-into-saas-success/) |
| Supademo first-100 (Starter Story) | saas/plg | comparison pages, free tools, concierge demos, distribution density | free tools 15-20% visitor→signup | `plg.capture_existing_demand` — [YouTube](https://www.youtube.com/watch?v=l4WEqPX52Cg) |
| a16z open source | devtool | community fit → PMF → value fit; model choice | stars/PRs → downloads/usage → revenue | `oss.three_fits` metric set — [a16z](https://a16z.com/open-source-from-community-to-commercialization/) |
| Lenny marketplace series | marketplace | constrain geo/category; seed supply; 2-3 channels | 30 drivers / ETA<15 min; 50-100 restaurants | `mkt.liquidity_gate` — [Lenny](https://www.lennysnewsletter.com/p/how-to-kickstart-and-scale-a-marketplace) |
| beehiiv 0→10,000 | newsletter | 26 tactics in 4 bands | subscriber bands; "one or two channels" | `media.stage_bands` — [beehiiv](https://www.beehiiv.com/blog/the-ultimate-guide-to-growing-a-newsletter-from-0-to-10-000-readers) |
| Hormozi $100M Offers | agency, courses, local | market criteria; value equation; 6 build steps; 5 enhancers | none numeric | `offer.grand_slam` skill — [EcomCrew](https://www.ecomcrew.com/100m-offers-book-summary/) (secondary) |
| Levels MAKE | indie | idea→build→launch→grow→monetize→automate→exit; launch list | none numeric | `indie.launch_ladder` — [readmake](https://readmake.com/) |
| Kajabi Cofounder flow | courses | interview → roadmap → offer → pages/emails → pricing | none | `course.offer_first` — [Kajabi](https://kajabi.com/cofounder) |
| RevenueCat SoSA 2026 | consumer app | n/a (benchmarks) | trial→paid 25-43%; D35 paid 2.1% freemium / 10.7% hard paywall | `app.benchmarks` — [RevenueCat](https://www.revenuecat.com/state-of-subscription-apps-2026/) |
| Anthropic Founder's Playbook | all | Idea/MVP/Launch/Scale with AI; "Launch-stage operating system" | in PDF (not fetched) | base skeleton naming — [claude.com](https://claude.com/blog/the-founders-playbook) |
| Demand Curve Growth Guide | all/consumer | chapters: competitive analysis, landing pages, ads, onboarding, content, A/B tests | none | `growth.channel_tests` — [Demand Curve](https://www.demandcurve.com/growth/intro) |
| YC Startup School, Mom Test, Sean Ellis | all | already in base doc | 40% very disappointed; 5-7% weekly | base |

### Inferences
- Encode numeric exit criteria as `thresholds[]` with `source_url` and `editable: true`; where the source is a
  single-case claim (Welch "24-48h", Erhart "$5K/month"), store `confidence: anecdotal` so the gate card shows it.
- Two public repos already express growth playbooks as agent-readable data: `fayerman-source/startup-growth-playbook`
  (AGENT.md → playbook.md with 10 strategies → generated plan.md; stage-aware selection of 2-3 strategies, fewer
  pre-PMF) and `Gingiris/gingiris-launch` (Product Hunt launch playbook). Both are MIT-style community files,
  not verified for licence — [startup-growth-playbook](https://github.com/fayerman-source/startup-growth-playbook), [gingiris-launch](https://github.com/Gingiris/gingiris-launch)
- Licensing caveat from the base doc still applies: lenny-skills content belongs to Lenny; Hormozi and Levels
  material must be paraphrased into North-authored skills, not vendored.

### Gaps
- Lenny marketplace parts 2-3 (levers, numbers) were not fetched directly; "~80% started on the constrained side"
  comes from a third-party summary and is unverified.
- Demand Curve's services-growth path returned 404; MicroConf/Walling have no public numeric gates.
- Sean Ellis growth-hacking stages and Starter Story per-type playbooks were not fetched (budget).

## Q5. How existing products route users to a vertical playbook

### Takeaway
Everyone asks 1-9 questions; the useful ones ask about *business type → sub-type → what to generate*, make the
questionnaire skippable, and use answers to pick templates and a starting tool stack. Polsia asks nothing and is
the cautionary example. North's ONB-1 (≤10 min) fits a 4-fixed + ≤3-conditional design.

### Cited Findings
| Product | Questions asked | Count | How answers are used | Source |
| --- | --- | --- | --- | --- |
| Wix ADI | website type → subcategory (examples) → business name → content/features (blog, forms, store, bookings) → build method → business info/logo/socials → theme → homepage design → pages | 9 screens | category drives theme options and features | [Elegant Themes](https://www.elegantthemes.com/blog/business/wix-adi-review) (secondary) |
| Shopify signup | optional "setup questionnaire" that "provides setup suggestions for your industry"; "Skip customized setup" available; third parties report "online, in person, or both" | optional | industry-specific setup suggestions | [Shopify Help](https://help.shopify.com/en/manual/intro-to-shopify/initial-setup/setup-overview); [TrueProfit](https://trueprofit.io/blog/how-to-sell-on-shopify) (secondary) |
| Durable | business type (6 categories), name, location (per reviews) | ~3 | template + content in "30 seconds" | [Durable](https://durable.com/); [Yahoo review](https://tech.yahoo.com/ai/articles/durable-website-builder-review-132729072.html) (secondary) |
| HubSpot | "onboarding survey to collect basic information" + sample data + email verification | not listed | product tours | [Appcues](https://goodux.appcues.com/blog/hubspots-new-user-onboarding) |
| involve.me (pattern) | industry, company size, intended use | 3 | picks templates per customer | [involve.me](https://involve.me/blog/case-study-how-we-use-an-onboarding-survey-in-a-saas-product) |
| ConsultEvo (pattern) | top SaaS flows ask 2-5 questions; company size and role common | 2-5 | segmentation | [ConsultEvo](https://consultevo.com/hubspot-saas-onboarding-guide-2/) (secondary) |
| Anthropic small-business plugin `smb-onboard` | headaches (money/customers/scheduling/organising) → tools used per category → 7 interview questions (industry, size, top-3 headaches, tools, growth goals, brand look, output format); "compress to three: industry, headaches, tools — but never fewer" | 7 (min 3) | diagnostic assembles a 3-5 skill starting stack: "A contractor gets proposal-builder and contract-review ... a shop gets inventory-planner ... a consultancy gets speed-to-lead" | local copy of [knowledge-work-plugins small-business](https://github.com/anthropics/knowledge-work-plugins/tree/main/small-business) |
| Anthropic `smb-router` | free-text intent → routing table → "Pick the single best match, not a list"; task words vs automation words disambiguation; new owner → onboarding | 0 | routes to one skill/command, asks one disambiguating question when a brief's existence is unclear | same |
| Lindy | none; gallery by role | 0 | "Describe the job in your own words" | [Lindy](https://www.lindy.ai/templates) |
| Polsia | `/new`: describe idea, "surprise me", or paste a website; reviewer: "asked no questions" | 0-1 | picks a business itself; posts publicly in ~10 min | North teardown `docs/research/polsia-teardown.md`; [Preuve](https://preuve.ai/blog/polsia-review.md) |
| Kajabi Cofounder | conversational interview, no setup | open | roadmap, offers, copy, pricing | [Kajabi](https://kajabi.com/cofounder) |

### Inferences (North routing design)
1. **Classifier first, questions second.** The Chief of Staff classifies the free-text idea on the five axes
   (Q1) with a confidence per axis; a question is asked only for an axis under 0.7 confidence. Fixed questions
   (always, ≤4): (a) "What will customers pay for?" (physical product / software / content / my time / access
   to others), (b) "Who pays?" (consumers / businesses / developers / both sides / sponsors), (c) "Do you already
   have an audience, a list, a store or a repo?" (yes + link / no), (d) "Can you build software yourself?"
   (yes / with AI tools / no). Conditional (≤3, only on low confidence): delivery (shipped / on-site / hosted),
   geography (one city / one country / global), launch asset (store / landing / app / repo / GBP / issue).
   Total ≤7, matching `smb-onboard`'s 7 and under Wix's 9; skip is allowed as in Shopify.
2. **Walling rule as a router guard.** `builds_software = no` + `offer_kind = software` → propose
   `agency_service`, `info_course_community` or a platform-bound app before standalone SaaS, with a one-line why.
3. **Output = routing card**, not a hidden decision: "Type: dropshipping store (0.86). Alternatives: DTC brand,
   marketplace. Because: physical goods, consumer, no audience, paid social." Founder confirms or swaps in the
   onboarding flow (no K2 card consumed, like the team proposal).
4. **Re-route at phase gates**: evidence that contradicts the type (e.g. a "SaaS" that sells only via calls)
   makes the Chief of Staff propose a type change as a review item, mirroring AgentVerse re-recruiting (base doc).
5. **Never ask what the model can read**: if a URL (store, repo, newsletter) is given, fetch it and pre-fill the
   axes, as Polsia's "paste existing website" does.

### Gaps
- HubSpot's and Shopify's exact question wording was not retrievable (needs a live signup); the Shopify "online /
  in person / both" item is from a third party.

## Q6. Modularising playbooks: formats, composition and a schema proposal

### Takeaway
Four public formats cover the needs — Agent Skills (`SKILL.md`, progressive disclosure, `metadata` map) for
know-how, CrewAI JSONC/YAML for role bundles with `{variable}` interpolation, LangGraph templates for
"configurable fields in the graph", and repo-level `AGENT.md → playbook.md → plan.md` for stage-aware plan
generation. A North playbook should be a base document plus vertical overlays plus founder patches, validated
with Zod, where modules attach to taxonomy axes rather than to one vertical.

### Cited Findings
- Agent Skills spec: a skill is a directory with `SKILL.md` (YAML frontmatter `name` ≤64 chars, `description`
  ≤1024, optional `license`, `compatibility`, `metadata` string map, experimental `allowed-tools`) plus
  `scripts/`, `references/`, `assets/`; progressive disclosure — metadata ~100 tokens at startup, body <5,000
  tokens on activation, resources on demand; "Keep your main SKILL.md under 500 lines"; validate with
  `skills-ref validate` — [agentskills.io](https://agentskills.io/specification)
- CrewAI: each agent in `agents/<name>.jsonc` with `role`, `goal`, `backstory`, `llm`, `tools`; `crew.jsonc`
  lists members and tasks (`name`, `description`, `expected_output`, `agent`); `{topic}` placeholders with
  defaults under `inputs`; classic `config/agents.yaml` still supported — [CrewAI docs](https://docs.crewai.com/en/concepts/agents)
- LangGraph templates are cloned repos (RAG, ReAct, Data Enrichment, Empty) that keep provider choices out of
  code by "making certain fields configurable in the graph itself" — [LangChain](https://www.langchain.com/blog/launching-langgraph-templates)
- OpenAI Agent Builder: typed edges between nodes, templates, publish creates "a new major version that acts as
  a snapshot", Code view exports to the Agents SDK; the product is scheduled to shut down on 2026-11-30 —
  [OpenAI docs](https://developers.openai.com/api/docs/guides/agent-builder)
- `startup-growth-playbook`: `AGENT.md` bootstrap, `playbook.md` with 10 strategies each carrying implementation
  steps and agent tasks, `startup-template.md` for plan structure; phases Discover → Select (2-3 strategies by
  stage, fewer pre-PMF) → Plan → Execute → Handoff; output tree `marketing/{plan.md,content,seo,tools,outreach,
  aeo,artifacts}` — [GitHub](https://github.com/fayerman-source/startup-growth-playbook)
- `smb-onboard` stores a `## Business context` block (industry, size, headaches, tools, goals, brand, locale) that
  "every other skill benefits" from, and derives a 3-5 skill starting stack per business type — local copy of
  [knowledge-work-plugins](https://github.com/anthropics/knowledge-work-plugins/tree/main/small-business)
- Base doc: AutoAgents/AgentVerse recruit a task-specific team and re-plan at gates; MetaGPT shows role SOPs with
  structured artefacts beat free chat ([T1]-[T3] there).

### Inferences — schema proposal (YAML shown; store as JSON in `playbooks` table, validate with Zod)
```yaml
# packages/core/src/playbooks/schema.ts  (Zod)   — files under agents/playbooks/
PlaybookModule:                      # reusable unit; ~40 modules cover 10 verticals
  id: ecom.product_scout             # namespace.name; namespace = core | <axis value> | <vertical>
  kind: stage | task_bundle | persona | connector_set | metric_set | rule_set | threshold_set
  applies_to:                        # attach by axis, not only by vertical
    offer_kind: [physical]           # any axis value; empty = universal
    payer: [consumer]
  requires: [core.frame, core.assumption_map]   # DAG edges
  provides: [artifact:product_candidates]
  personas: [research.product_scout] # from agents/personas/*.yaml (role fixes tools + max_action_tier)
  skills: [ecom-product-research, evidence-citations]   # SKILL.md names (agentskills.io spec)
  task_types: [product_research]     # packages/core/src/tasks/types.ts
  evidence_rules: [{ task: product_research, needs: [source_url, units_sold_7d] }]
  cards:                             # K2 templates this module may raise
    - { kind: spend, template: ad_test, cap_field: budget.ads_daily }
  thresholds:
    - { metric: roas, op: ">=", default: 1.5, source_url: "https://www.shopify.com/blog/how-to-start-dropshipping", confidence: north_default, editable: true }
  rules: [{ id: no_generated_testimonials, cite: "https://www.ftc.gov/...", enforce: critic+gate }]
  params: { product_count: 3, ad_daily_cap: 50 }       # {interpolation} inside skills, CrewAI-style
  version: "1.2.0"
  license: MIT

Playbook:                            # composed per company; immutable versions, append-only like actions
  id: ecom_dtc@1.0.0
  base: core@1.0.0                   # the shared 60%: S0, S1, S2, S5, S9, S10, review + card machinery
  overlays: [ecom.product_scout, ecom.launch_checklist, ecom.ad_test, growth.paid_social, ops.margins_refunds]
  removes: [core.interview_kit]      # explicit, so the gate card can say "interviews skipped: dropshipping"
  stages:                            # ordered; each stage lists module ids and its gate
    - { id: scout, modules: [ecom.product_scout], gate: { all_of: [units_sold_7d>=300, candidates>=3] } }
    - { id: build, modules: [ecom.launch_checklist, design.brand], gate: { deploy_id, form_test } }
    - { id: test,  modules: [ecom.ad_test], gate: { visitors>=200, orders>=5, roas>=1.5 }, stop: { roas<1.0 after spend>=300 } }
  departments: { research: on, strategy: off, design: review_drafts, engineering: off, growth: autopilot, sales: off, ops: on }
  connectors: { required: [shopify, meta_ads, stripe], optional: [tiktok_shop, autods, omnisend], mode: sandbox }
  metrics: [roas, cpa, profit_per_product, refund_rate, delivery_days]
  budget_split: { ads: 0.55, tools: 0.15, samples: 0.15, creative: 0.10, reserve: 0.05 }
  reference_products: [shopify_sidekick, autods, minea, triple_whale_moby]
  founder_patch: []                  # JSON Patch ops applied last; see Q7
```
Composition order: `core` → axis modules (by `applies_to`) → vertical overlays → `removes` → founder patch.
Resolution rules: (1) a module may only add cards whose tier ≤ the role's `max_action_tier`; (2) thresholds merge
by `metric` with founder values winning; (3) `departments` can be switched off but a stage whose gate needs a
department's artefact fails validation ("Growth off but stage `test` needs `ad_test`"); (4) every module carries
`version` and the company stores the resolved playbook snapshot, so a later module update becomes a review item,
not a silent change (mirrors OpenAI's publish-snapshot and the base doc's append-only rule).
Why this split works: the axis attachment is what lets `media_newsletter` and `info_course_community` share
`growth.audience_first` while `ecom_dtc` and `local_service` share `ops.reviews_compliance`; the vertical overlay
only adds what no axis explains (supplier ops, liquidity gate, GBP).

### Gaps
- No public standard exists for "playbook as data" beyond CrewAI configs and repo conventions; the schema above is
  a North design, not an adopted format.
- Agent Skills `allowed-tools` is experimental; North must keep tool allow-lists in role YAML, not in SKILL.md.

## Q7. Letting the founder edit the proposed team and playbook

### Takeaway
Reuse the base doc's constrained-generation team step; add a visible routing card, per-stage toggles, and a
JSON-Patch-style `founder_patch` so edits are data, replayable and never raise an action tier.

### Cited Findings
- `smb-onboard`: "Show the owner the full profile before writing. Wait for explicit approval"; "Never overwrite
  existing context silently ... show current vs. proposed" — local copy of [knowledge-work-plugins](https://github.com/anthropics/knowledge-work-plugins/tree/main/small-business)
- Jobber: owner "turn[s] on the ones you want" among suggested automations; AI Receptionist "within the limits you
  set" — [Jobber](https://www.getjobber.com/ai/)
- Lindy per-action confirmation and Relevance AI's "Let agent decide" mode (base doc [C10] [C12]); the base doc
  rejects agent-chosen approval modes.
- Polsia: tasks "started on click with no confirmation step" — [Preuve](https://preuve.ai/blog/polsia-review.md)

### Inferences (design)
| Edit surface | What the founder can change | Stored as | Guard |
| --- | --- | --- | --- |
| Routing card (onboarding) | confirm type, pick an alternative, add a one-line correction | `company.playbook_id` + `routing_log` (append-only) | re-run composition; show diff of stages/departments |
| Team step (base doc) | toggle departments, swap personas from catalog, dial autopilot/review, rename | `agents` rows | tier never rises; stage-gate validation warns |
| Stage strip | skip a stage with a reason, reorder non-dependent stages, edit thresholds inline | `founder_patch` ops `{op: replace, path: /stages/2/gate/orders, value: 3}` | thresholds show `source_url`; skipped validation stages mark later evidence as weaker |
| Connectors | choose vendor per category, sandbox/live | `integrations` | live keys only by founder (rule 5) |
| Budget | edit the split; daily caps per card kind | `budget_split`, `caps` | sum = 1; caps ≤ budget |
| Later | "switch playbook" proposed by Chief of Staff at gates | new snapshot version | review item, not K2 |

Every patch is applied at composition time, so re-proposals at gates re-apply founder intent instead of
discarding it (the base doc's "re-propose at phase gates" needs this to be non-annoying).

### Gaps
- No usability data on how many founders edit a proposed plan; Marblism/Sintra complaints (base doc) suggest
  edits must stay under 2 per step.

## Sources used but not cited above
- Shopify Sidekick coverage (conflicting rollout claims, unverified): https://craftshift.com/shopify-sidekick-launch-date-features-2026/ ; https://www.ringly.io/blog/ai-sidekick-shopify
- AutoDS reviews (secondary): https://www.trendtrack.io/blog-post/autods-review-2026 ; https://branvas.com/blogs/news/zendrop-vs-autods
- Triple Whale announcements (secondary): https://salestechstar.com/predictive-ai-artificial-intelligence/triple-whale-unveils-first-agent-powered-intelligence-platform-for-brands-to-optimize-their-entire-business/
- Kajabi reviews (secondary): https://skillscouter.com/kajabi-review/ ; Circle AI Copilot: https://www.createwith.com/tool/circle/updates/circle-launches-ai-copilot-to-streamline-community-building-and-course-creation
- Marc Lou analyses (secondary): https://lofimarketing.substack.com/p/shipfasts-45kmonth-strategy-the-framework
- Hormozi $100M Leads "core four" (secondary): https://the-linkedin-lead-machine.beehiiv.com/p/the-hormozi-100m-client-machine
- Marketplace summaries (secondary): https://echai.ventures/startingup/first-customers/i-run-a-two-sided-marketplace-do-i-get-my-first-customers-by-starting-with-supply-or-demand-and-how-do-i-avoid-the-empty-restaurant-problem
- Agent Skills adoption commentary (secondary): https://www.useparagon.com/blog/what-are-agent-skills
- YouTube practitioner videos located but not transcribed (vidIQ credits): Codie Sanchez 30-day newsletter https://www.youtube.com/watch?v=oRpjoHJcX4s ; Nate Herk first AI-automation client https://www.youtube.com/watch?v=9dA1VB8V8oo ; Nathan Nazareth Meta ads for beginners https://www.youtube.com/watch?v=VF2uMUqlaDg
