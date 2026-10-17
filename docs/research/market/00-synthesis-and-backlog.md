# Sell verified outcomes, not autonomous staff

Research synthesis for North · 2026-10-16 · sources: the eight research notes
`01`-`08` in this folder (marketing, sales, engineering, design,
company/ops platforms, connectors, vertical playbooks, multi-agent literature), read against
`docs/SPEC.md`, `CONTEXT.md` and the M7-M13 studio-phase design. Claims without a primary or
named secondary source in the notes were dropped; "unverified" marks what the notes could not
confirm.

## Yönetici özeti

**Ana bulgu.** Pazarda North'un tamamını yapan tek bir ürün yok. Pazarlama (Jasper, Klaviyo
Composer, Omneky, Pomelli), satış (11x, Artisan, AiSDR, Clay, Apollo), yazılım (Lovable, Replit,
Devin, Claude Code), tasarım (Claude Design, Figma Make, Higgsfield) ve "şirketi çalıştıran"
platformlar (Polsia, Lindy, Managed Agents) birbirinden bağımsız olarak **aynı şekle**
yakınsadı: bir marka/bağlam nesnesi → brief → 2-3 (veya onlarca) varyant → puan ya da eleştirmen
→ tek bir inceleme yüzeyi → yayın → ölçüm. Otonomi, çıktı başına değil, baştan verilen bir
"sözleşme" ile tanımlanıyor (hedef + bütçe bandı + korkuluklar + otonomi seviyesi; Salesforce
Goals Agent, Lindy "dış etkisi olan her şey onay bekler"). **Hiçbir üründe günlük karar kotası
yok**; para dışında bir "dikkat bütçesi" fikri yalnızca North'ta var ve bu, ürünün
pazarlanabilir farkı.

**Kategorinin ekonomisi kanıtlanmamış.** Tek kamuya açık veri Polsia: şirketlerin ~%10'u bir
dolar kazanmış, ilk iki ayda ~%50 kayıp, Trustpilot 3.3/5
([Crevio](https://crevio.co/blog/is-polsia-legit)). Manus Trustpilot 1.2/5, şikâyetlerin tamamı
yanan krediler ve faturalar ([preuve.ai](https://preuve.ai/blog/manus-ai-review)). Pazarın en
büyük üç şikâyeti (öngörülemeyen kredi faturası, gizli otonomi, iptal edememe) North'un zaten
tasarımda olan defter, kart ve sandbox kurallarıyla doğrudan çözülüyor; eksik olan bunları
**kartın üstünde göstermek**.

**Literatür North'un mimarisini doğruluyor, bir eksiği işaret ediyor.** MAST (NeurIPS 2025)
1.642 izde %41-87 başarısızlık buldu; en büyük tek kazanım görev-hedef doğrulama adımı (+%15,6)
([arXiv 2503.13657](https://arxiv.org/html/2503.13657v3)). Google/DeepMind ölçekleme çalışması
merkezî orkestratörde hata büyümesini 4,4x, bağımsız ajanlarda 17,2x ölçtü; sıralı işlerde çoklu
ajan %39-70 kötüleşiyor ([arXiv 2512.08296](https://arxiv.org/html/2512.08296v1)). Sonuç: Chief
of Staff'ı dağıtıcıdan **doğrulayan planlayıcıya** çevirmek (görev defteri + ilerleme defteri +
her departman çıktısını ayrı bir çağrıyla doğrulama) en yüksek getirili tek değişiklik. Aynı
modelle aynı bağlamda çalışan "CEO eleştirmeni" işe yaramıyor (Project Vend 2)
([Anthropic](https://www.anthropic.com/news/project-vend-2)).

**Bağlayıcı katmanı.** Hiçbir entegrasyon platformu onay/katman satmıyor;
`AuthorityEngine.gate()` için hazır ikame yok. Öneri: üç şeritli taşıma (para/reklam/kod için
yerel adaptörler; Notion/Slack/Linear/Stripe/Shopify için satıcının kendi uzak MCP sunucuları;
uzun kuyruk için Composio "self-managed credentials" ya da Nango) ve her bağlayıcının yetenek,
yön ve risk katmanını **veri olarak** tutan bir `connector_manifests` + `connector_capabilities`
modeli. Ajan başına ≤20 ertelenmemiş araç; gerisi araç aramasıyla (Anthropic: 30-50 araçtan
sonra seçim doğruluğu düşüyor, araç araması bağlamı ~%85 azaltıyor) ([Tool
search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool)).

**Dikey playbook'lar.** On yapraklı bir taksonomi (dropshipping, B2B SaaS, devtool, tüketici
uygulaması, pazar yeri, bülten, ajans, yerel hizmet, kurs/topluluk, mikro-SaaS) ve beş
sınıflandırma ekseni (ne satılıyor, kim ödüyor, nasıl teslim ediliyor, edinim kanalı, ilk
artefakt) yeterli. Playbook'ların ~%60'ı ortak; dropshipping, pazar yeri, yerel hizmet ve bülten
doğrulama ve yapım adımlarını değiştiriyor. Yönlendirme: önce sınıflandırıcı, güveni 0,7
altındaki eksen için soru (en fazla 7 soru), görünür bir "yönlendirme kartı", ve Walling kuralı
(yazılım yazamayan kurucu → önce ajans/kurs/platform-içi ürün) ([Bootstrapped
Founder](https://thebootstrappedfounder.com/rob-walling-stair-stepping-into-saas-success/)).

**İlk 10 öneri (öncelik sırasıyla; detay bölüm 7):** (1) Chief of Staff görev ve ilerleme
defteri + doğrulama adımı; (2) bağlayıcı manifesti ve yetenek tablosu, katmanlar veri olarak;
(3) beklenen-pişmanlık ile kart bütçesi dağıtımı ve kart cevaplarından öğrenilen varsayılanlar;
(4) departman sözleşme kartı (hedef + bütçe bandı + kanal listesi + otonomi + durma kuralı,
haftada bir K2); (5) canlı çalışma görünümünde maliyet sayacı ve eşikte "devam / topla"
duraklaması; (6) Play nesnesi (sinyal → araştırma → taslak → kart → dizi → geri yazım, sürümlü,
durma kuralları); (7) dikey taksonomi, yönlendirme kartı ve playbook şeması; (8) marka kiti
kilit durumları ve kanıt etiketleri; (9) MCP istemci hijyeni (CIMD, araç listesi sabitleme,
kuarantina); (10) pass^k ile "North-Company" değerlendirme seti.

**Kurucu kararı gerektirenler:** ilk yapımda "North tarafından yönetilen" bekleme listesi arka
ucu mu, kullanıcının kendi Supabase'i mi (spec ikincisini seçti; pazar birincisini yapıyor);
sözleşme kartının K-katman anlamını nasıl değiştireceği; Composio mu Nango mu ve AB veri
yerleşimi; ilk üç dikey; eleştirmenin en yüksek puanlı varyantı otomatik seçip seçemeyeceği;
bilinen kişilere yanıtlarda otomatik pilot; konumlandırma cümlesi ("parasını ve adını sen
olmadan harcamayan şirket").

---

**BLUF.** North should stop trying to out-automate the market and instead productise what no
competitor has: a founder-owned, evidence-only, quota-bounded company whose agents earn
autonomy. Every category the notes examined has converged on the same request-to-outcome spine
(context object → brief → variants → score or critic → one review surface → publish → measure),
and the agentic leaders grant autonomy once, up front, as a contract of goal, budget band,
guardrails and autonomy level rather than per output
([Salesforce](https://www.salesforce.com/blog/?p=145255),
[Lindy](https://www.lindy.ai/pricing)). No product in any category publishes a daily decision
quota, so North's 3-cards-a-day rule is a differentiator to market, not a constraint to
apologise for. The literature says the mechanism that makes a multi-agent company work is a
centralised orchestrator that verifies sub-outputs, keeps ledgers and bounds communication
(error amplification 4.4x centralised vs 17.2x independent; a verification step worth +15.6%),
and that same-model "CEO" critics rubber-stamp ([arXiv
2512.08296](https://arxiv.org/html/2512.08296v1), [arXiv
2503.13657](https://arxiv.org/html/2503.13657v3),
[Anthropic](https://www.anthropic.com/news/project-vend-2)). The connector layer has no
off-the-shelf substitute for the gate, so North should build the manifest and the money/ads/code
adapters and buy OAuth plumbing and the long tail. Vertical playbooks differ in what "validated"
means and which department leads week one, not in the card machinery, so a ten-leaf taxonomy
with axis-attached modules and a visible routing card is enough. The M7-M13 plan already covers
most of the studio-level features the market has; the backlog below adds twenty-seven new items on
top of it (plus fifteen that extend planned ones), of which six belong inside M7-M9, eight inside
M10-M12, and thirteen in three new milestones (M14 connector platform, M15 playbooks and routing,
M16 Chief of Staff v2).

## Every category converged on one spine, and the leaders sell autonomy as a contract

The most useful finding across the five product notes is structural, not a feature list. In
marketing, Jasper IQ, HubSpot's Context tab, Salesforce's Unified Brand Center and Google's free
Pomelli all begin with a brand object (voice, visual guidelines, knowledge, audiences) that
feeds a brief, which fans out to N variants, which a score or critic gates, which a single
surface (inbox, grid, calendar) presents for approval ([Jasper](https://www.jasper.ai/agents),
[HubSpot KB](https://knowledge.hubspot.com/ai/use-breeze?tab=suite), [Google
blog](https://blog.google/technology/google-labs/pomelli/)). Pomelli is the sharpest reference
for a solo founder: URL or three product photos → "Business DNA" (tone, fonts, palette, imagery)
→ catalogue → an auto-written brief the user confirms → five images, animatable to video → a
Brand Book PDF, all free and without an account
([walkthrough](https://www.youtube.com/watch?v=DvsKFckdfE0)). Klaviyo Composer adds the other
half of the loop: "what should I focus on?" audits live campaigns, flows and segments, returns a
ranked list of revenue opportunities with the fix pre-built, and "nothing goes live without
approval" ([Klaviyo newsroom](https://www.klaviyo.com/newsroom/CRM-agents)). Sales products run
the same nine-stage loop (ICP → list → enrich → signal → research → sequence → reply → book →
CRM write-back) and every "autonomous AI SDR" quietly added a copilot mode in 2025-26:
Reply.io's Jason "drafts every step and waits for your approval", HubSpot Breeze offers "review
and edit AI-drafted emails before they are sent", Instantly queues drafts in a Human-in-the-Loop
mode ([Mailtrap/Reply](https://mailtrap.io/blog/reply-io-review/),
[HubSpot](https://www.hubspot.com/products/sales/ai-prospecting-agent),
[Instantly](https://instantly.ai/blog/instantly-ai-reply-agent-vs-smartlead-lemlist-reply-io/)).

Engineering tools split into two spines that North sits between. Consumer builders (Lovable,
Bolt, v0, Replit, Base44) converge on a read-only Plan mode that asks questions and produces an
approvable, versioned plan, an effort-billed Build mode, a live preview with element-pinned
comments, a version per message with one-click revert, an agent-chosen browser self-test and a
security scan at publish ([Lovable plan mode](https://docs.lovable.dev/features/plan-mode),
[Base44 chat modes](https://docs.base44.com/Building-your-app/AI-chat-modes), [Replit app
testing](https://docs.replit.com/replitai/app-testing)). Cloud coding agents (Devin, Cursor,
Codex, Claude Code, Copilot, Jules) converge on an isolated VM, plan approval, a diff with
inline comments, a PR as the deliverable, artifacts (screenshots, video) as proof and
event-driven auto-fix of CI and review comments
([Cursor](https://cursor.com/docs/cloud-agent/capabilities), [Claude
Code](https://code.claude.com/docs/en/claude-code-on-the-web)). The consumer builders never
expose a PR; the engineer tools never expose a hosted preview with comments. Because North keeps
the user's repo, a Vercel preview and a decision card, it must offer both surfaces. The 2026
integration default is "built-in first, bring-your-own second": Lovable Cloud, Bolt Database and
v0's Marketplace provision the database silently, Lovable and Base44 create the Stripe account
or key for the user, and the only writes that still ask are migrations, data changes and access
widening ([Lovable cloud](https://docs.lovable.dev/features/cloud), [Lovable
payments](https://docs.lovable.dev/features/payments), [Base44
changelog](https://docs.base44.com/changelog/product)). Asking a founder to create a Supabase
and a Stripe account before the first preview would be the weakest onboarding in the category.

Design products encode the agency pattern as data: a brand or design-system contract (Stitch's
nine-section DESIGN.md, Figma's Guidelines.md, Higgsfield's Brand Lock JSON with per-field
`fixed / proposed / unknown` lock states and `measured / inferred` evidence labels), exactly
three candidates per slot (palette → logo → type → direction), one approval per slot, dependency
invalidation when an upstream slot changes, and anchored comments that become the next version
([VoltAgent DESIGN.md](https://github.com/VoltAgent/awesome-design-md), [Figma
help](https://help.figma.com/hc/en-us/articles/33665861260823), Higgsfield MCP bundle).
Designers praise two review mechanics above all: agent-invented sliders for taste (Claude
Design, Open Design) and comments pinned to a preview element ([Flux
Academy](https://www.youtube.com/watch?v=fRAUuluAirM), [Open
Design](https://github.com/nexu-io/open-design)); they condemn prompt-only editing ("drag and
drop is just faster", broken pages billed anyway) ([Steve Builds
Websites](https://www.youtube.com/watch?v=wbyPMZ6Y6Qw)).

The whole-company layer is where the autonomy claims live and where the evidence is worst. Only
Polsia, Manus, Genspark and Beam sell "the agent runs it"; Lindy, Relevance, Zapier, Gumloop,
Make, Copilot Studio and Agentforce are workflow builders with a chat skin. Every surviving
product uses the same three-mode permission switch (`always_allow` / `always_ask` / `auto`) with
read-versus-write defaults, which Claude Managed Agents makes explicit per tool with MCP
toolsets defaulting to ask ([permission
policies](https://platform.claude.com/docs/en/managed-agents/permission-policies), [Gumloop
HITL](https://docs.gumloop.com/core-concepts/human_in_the_loop.md)). Managed Agents also gives
the cleanest budget primitive in the market: a hard session budget in cents, a `budget_reached`
pause that still accepts approvals, and the rule that "a pending ask outranks the cap"
([Budgets](https://platform.claude.com/docs/en/managed-agents/budgets)). The unit economics of
the category are unproven: Polsia's founder said about 10% of companies made at least a dollar
and about half churn in each of the first two months, while its Trustpilot sits at 3.3/5 with
complaints about credits consumed on work of unclear price and tasks "reported done when they
aren't" ([Crevio](https://crevio.co/blog/is-polsia-legit)). Manus shows 1.2/5 on Trustpilot with
94% one-star reviews about billing ([preuve.ai](https://preuve.ai/blog/manus-ai-review)). Reddit
marketers "recommend general LLMs like ChatGPT and Claude far more than dedicated marketing
platforms" and are "deeply skeptical of AI SDR tools"
([zplatform](https://zplatform.ai/guides/best-reddit-communities-ai-marketing/)).

The table below condenses how the category leaders turn a request into an outcome, so the
backlog can name the exact mechanism to copy.

| Stage | Marketing leader | Sales leader | Engineering leader | Design leader | Company leader |
|---|---|---|---|---|---|
| Intake | Pomelli: URL or 3 photos → DNA; Klaviyo: "what should I focus on?" | AiSDR: URL → full campaign play; Apollo: plain-English ICP | Lovable/Base44: plan mode asks 1-2 compact question cards | Higgsfield: 4-question gap checklist + 3 taste axes | Lindy: describe the job; Polsia: no questions (cautionary) |
| Plan/brief | Pomelli writes the brief, user confirms; Salesforce: goal + budget + guardrails + autonomy | Clay Workflow: trigger → audience → steps → branch → write-back | Lovable: versioned plan, section comments; Jules: timer auto-approve | Relume: brief → sitemap → wireframes → style guide, approved per stage | Managed Agents `deployment.md`: cron + budget + first message |
| Variants | Omneky: hundreds per brief; Pomelli: 5 images | 11x: one message per contact from Deep Research | Replit canvas "Explore"; Lovable Drafts | Exactly 3 per slot (Higgsfield, Stitch) | — |
| Score/critic | AdCreative Conversion Score; Surfer Content Score ≥ N before "done" | Lavender email grade; Clay score threshold → Slack review | Lovable Quick security scan; Devin test recording pass/fail | Impeccable: Nielsen 0-4, P0-P3, "design specificity" verdict | Beam "output evaluation"; Digits AI quality review |
| Review surface | HubSpot agent inbox; AirOps grid with review column | Copilot mode; locks on tone/CTA (Artisan) | Preview toolbar (select, comment, draw); diff with inline comments | Side-by-side directions; pinned comments; sliders | Gumloop choice cards; Slack approve/reject |
| Publish | Omneky Ad Launcher to 5 networks; Meta paused-first | Sequence from user's own mailbox | PR (draft/full); publish dialog with scan | Hand-off bundle (DESIGN.md + tokens + HTML) | Routine with dry run (Lindy) |
| Measure/learn | Klaviyo daily self-check; AirOps "learns from each run" | Amplemarket learns from dismissals; per-run traces (Clay) | CI auto-fix; session logs linked from commits | Critique → revise_artifact items | Managed Agents "dreams" rebuild memory |

Sources: [Google blog](https://blog.google/technology/google-labs/pomelli/),
[Klaviyo](https://www.klaviyo.com/newsroom/CRM-agents), [AiSDR](https://aisdr.com/features/),
[Apollo](https://www.apollo.io/insights/ai-assistant-for-outbound-teams-needing-speed), [Clay
Workflows](https://www.clay.com/blog/introducing-workflows), [Lovable
changelog](https://docs.lovable.dev/changelog), [Jules](https://jules.google/docs/review-plan/),
[Omneky](https://www.omneky.com/llms.txt), [11x](https://www.11x.ai/worker/alice),
[Impeccable](https://github.com/pbakaus/impeccable/blob/main/skill/reference/critique.md),
[AirOps](https://www.airops.com/pricing), [Artisan](https://www.artisan.co/llms-full.txt),
[Lindy routines](https://docs.lindy.ai/teammate/routines),
[Dreams](https://platform.claude.com/docs/en/managed-agents/dreams).

Two inferences follow. First, the market prices autonomy at the agent-salary end ($36k-45k a
year for 11x, quote-only for Artisan and Regie) and is being undercut by outcome pricing ($1 per
recommended lead at HubSpot, $1.50 per prospect at AiSDR, $0.99 per outcome at Intercom Fin)
([SyncGTM](https://syncgtm.com/blog/11x-ai-review),
[HubSpot](https://www.hubspot.com/products/sales/ai-prospecting-agent), [AiSDR
pricing](https://aisdr.com/pricing), [Fin pricing](https://fin.ai/pricing)). North's cost
structure (user's own keys and accounts, founder approval) belongs at the usage end, and its
ledger can show "this week's plan costs about $X" on the contract card, turning the category's
loudest complaint into a feature. Second, the only vendors that log *why* a message was sent
(11x's signal-fired action with Deep Research, Clay's per-run traces with Claygent reasoning)
are doing what North's Evidence model already requires; that is a differentiator to show, not
table stakes to build.

## North already plans the studio; the gaps are the contract, the cost meter and the verifier

Read against the M7-M13 design, most studio-level features the market has are already in the
plan: a review queue outside the decision quota (REV-1), 2-3 variants by fork with a separate
critic and code-decided hard gates (LOOP-1/2), anchored comments producing one revision with
diff and revert (REV-2), a live work view (LIVE-1), 1:1 agent chat with "Add to context"
(CHAT-2), the team proposal and per-department dial (TEAM-1/2), validation-first onboarding
(VAL-1..3), the brand kit as verified files with `tokens.json` and `DESIGN.md` (DSN-1),
paused-first Meta campaigns with previews on the card (MKT-1), licensed lead providers behind
North tools with a deliverability guard and per-batch sequences (SLS-1..4), and the lesson model
that turns card answers and comments into active preferences (LRN-1..12). The notes confirm each
of those choices against a named product and should be cited in the ADRs the design lists
(0017-0025).

What the plan lacks, in order of leverage, is the following. The **agentic contract** that every
leader uses to grant autonomy once: Salesforce's Goals Agent takes goal, budget, guardrails "and
the level of autonomy the marketer grants"; Lindy's written rule is that "anything with outside
impact waits for approval" while read-only lookups do not
([360degreecloud](https://360degreecloud.com/blog/salesforce-just-introduced-4-new-ai-agents-for-marketing-what-does-it-mean-for-you/),
[Lindy](https://www.lindy.ai/pricing)). North has the review dial (Autopilot vs Review drafts)
and a one-time monthly generation cap card, but no single K2 card that approves a department's
week: goal, budget band, channel allowlist, autonomy level and stop rule. Without it the 3-card
quota caps outreach at three contacts a day and marketing at three posts; with it, one card
unlocks a week of K0/K1 work inside the band, and the sales note's arithmetic (one card = one
play run of at most 20 contacts, reply cards separate) becomes possible
([GTMLens](https://gtmlens.com/bp-why-ai-sdrs-fail-three-patterns/)).

The **cost meter with a pause**: LIVE-1 records tokens and cost so far, but no product in the
engineering note survives on a silent cap. Lovable pauses at 20 credits by default with
"Continue" or "Wrap up", shows live time and credits while running, and lets the user set an
auto-top-up spend limit; Replit asks for confirmation before any paid action; Managed Agents
pause with `budget_reached` and still accept approvals ([Lovable agent
mode](https://docs.lovable.dev/features/agent-mode), [Replit
billing](https://docs.replit.com/billing/ai-billing),
[Budgets](https://platform.claude.com/docs/en/managed-agents/budgets)). Unexplained burn is the
top complaint on every credit-metered product's review page, from Lovable's 1,834 Trustpilot
reviews ("the free credit runs out very quickly") to Lindy ("trivial tasks can burn up credits
quick") ([Trustpilot](https://www.trustpilot.com/review/lovable.dev),
[CostBench](https://www.costbench.com/software/ai-automation/lindy/)). North should expose
`maxBudgetUsd` as a visible meter on the live view and the mobile one-liner, pause at 80% with a
K1 "continue / wrap up" item, and never charge a failed attempt.

The **editable plan card with timeout auto-approve** for Engineering: Lovable keeps plan
versions in `.lovable/plan/`, lets the user highlight a section to change only that part, and
approves a specific version; Base44 rations clarifying questions to "one or two compact cards";
Jules auto-approves the plan on a timer when the user leaves ([Lovable
changelog](https://docs.lovable.dev/changelog), [Base44
changelog](https://docs.base44.com/changelog/product),
[Jules](https://jules.google/docs/review-plan/)). North plans `feature_list.json` in the repo
for the later app phase; the UX lesson is one compact card per build, sections editable,
defaults pre-filled, auto-proceed at the deadline, which fits DEC-2's "safe default applies"
rule exactly.

The **Growth weekly readout**: Klaviyo's "what should I focus on?" and Isenberg's weekly "growth
cockpit" memo (what content worked, which objection recurred, which test won, what to test next)
turn measurement into the next card instead of a dashboard
([Klaviyo](https://www.klaviyo.com/newsroom/CRM-agents),
[Isenberg](https://www.youtube.com/watch?v=8ZC1G1ezN5o)). PLN-2 already rewrites the plan from
the ledger on Mondays; the addition is a founder-facing ranked list of three opportunities with
the fix pre-built, folded into that week's contract card so it costs no extra quota.

The **grid review surface** for batches: AirOps Grids (rows = pages, columns = agent steps, with
"Content Review & Quality Scores", "Human Review & Approvals" and version history) and Jasper
Grid are how one glance approves twenty creatives or ten SEO briefs ([AirOps
pricing](https://www.airops.com/pricing), [Jasper pricing](https://www.jasper.ai/pricing)).
M11's creative pipeline will produce 10-20 ads per run per Higgsfield's Ads Studio model
([Higgsfield blog](https://higgsfield.ai/blog/higgsfield-ads-studio)); a list-shaped review
queue will not survive that volume, and no vendor documents how batch approval interacts with
per-row edits, so North must design it (edit a row → re-run the critic on that row only).

Smaller adoptions with clear evidence: **brand-kit lock states and evidence labels**
(Higgsfield's `fixed / proposed / not_applicable / unknown` per field, `source-declared /
measured / visually-observed / inferred`, at least two "avoid" rules, per-format `applications`
overrides) added to DSN-1's Zod `BrandKit`, plus staged approvals with dependency invalidation
(palette change → regenerate the three logo candidates) stored as data on kit slots;
**agent-generated knobs** (3-4 sliders per artifact that re-render without an agent run) and
editable text and image slots so trivial edits never cost a prompt; **a "design specificity"
fail** in the Design Critic ("could an unrelated product use this unchanged?") alongside the
slop-tell list (uniform large radii, purple-blue glow gradients, tracked uppercase labels, fake
badges, Inter everywhere)
([Impeccable](https://github.com/pbakaus/impeccable/blob/main/skill/reference/critique.md),
[noqta](https://noqta.tn/en/blog/ai-design-slop-overused-ui-patterns-fix-2026)); **critique
output in the A List Apart shape** (marker, area, observation, impact, request; one finding per
comment) so findings map one-to-one to `revise_artifact` work items ([A List
Apart](https://alistapart.com/article/async-design-critique-giving-feedback/)); **security scan
at publish with block-on-critical as the default** (Lovable blocks only for Enterprise by
default; Base44 creates a checkpoint before any auto-fix) shown as grouped findings on the
go-live card ([Lovable security](https://docs.lovable.dev/features/security)); **artifacts as
proof on the go-live card** (Cursor attaches screenshots, video and logs to the PR; Devin
returns an edited recording with pass/fail cards) so the card embeds gate scores, the Playwright
recording and the synthetic signup row
([Cursor](https://cursor.com/docs/cloud-agent/capabilities),
[Devin](https://docs.devin.ai/work-with-devin/testing-and-recordings)); and
**voice-from-evidence** (Martell's "read my last 50 sent messages → style guide → test on a real
draft"; Lately learns from what performed) so the founder's voice guide is Evidence-backed from
Gmail instead of a form ([Martell](https://www.youtube.com/watch?v=Bm84BAtOfQw),
[Lately](https://www.lately.ai/)).

For Sales the notes add five things to SLS-1..4. A **Play record** as versioned data (Clay
Workflows is the most explicit model: audience, trigger kind, steps, branching, write-back,
per-run traces, record-level cost, each run pinned to the play version it started on) with
`AuthorityEngine.gate()` as the mandatory `approve` step for first contact
([Clay](https://www.clay.com/blog/introducing-workflows)). **Signal-fired plays with weights and
thresholds** (11x layers "several open SDR roles plus a recent VP Sales departure"; firstsales:
route prospects into sequences "only when a qualifying signal fires, not on a fixed schedule")
so the card's "why" is machine-checkable ([11x
signals](https://www.11x.ai/platform/data-lead-generation/signals-and-triggers),
[firstsales](https://firstsales.io/blog/ai-sdr-mistakes/)). **Stop rules as data** from Unify's
founder guide (opt-out → stop; bounce rate above a few percent → pause and re-verify; drafts
going out unread → restore review; no reply after 3 touches → change angle; OOO → pause until
return plus two days; weak-fit list over ~100 → cut)
([Unify](https://www.unifygtm.com/explore/how-to-do-founder-led-sales)). A **reply SLA**
(positive reply → a K0 reply item within four hours; the human owns the conversation) because
"the meeting booking should be the handoff, not the endpoint" and the Cal.com booking should
carry thread, research and signal into the pipeline record
([GTMLens](https://gtmlens.com/bp-why-ai-sdrs-fail-three-patterns/)). And **tone and CTA locks
plus escalation rules** on the Play (Artisan) so a batch approval is safe without reading every
follow-up ([Artisan](https://www.artisan.co/llms-full.txt)). The practitioner numbers behind the
volume defaults are consistent: an operator study of ~1.5M emails found AI-SDR-style sending
produced "roughly 6.4x the volume with roughly 38% lower reply rates"; GTMLens' working patterns
cap at 50-200 named accounts and 60-80 emails a day with a human on replies; SaaStr advises that
"the first 1,000 emails need to be manually reviewed"
([OneAway](https://oneaway.io/blog/ai-sdr-tools-2026),
[GTMLens](https://gtmlens.com/bp-why-ai-sdrs-fail-three-patterns/),
[SaaStr](https://www.saastr.com/dear-saastr-i-want-to-roll-out-an-ai-sdr-how-do-i-start)).
North's M12 defaults (batch 5 → 10 → 20, 20 per inbox per day) sit inside those bounds.

For Ops and Finance the one-person feature set is small and well attested: Ramp's "approves when
it's safe, escalates when it's not" with "no money ever moves without a human confirmation" is
North's K1/K2 split written as a policy ([Ramp](https://ramp.com/intelligence)); Digits'
six-step agentic close (collect, book, reconcile, schedule, review, report) with an AI quality
review before the human sees it is the template for a weekly close routine
([Digits](https://digits.com/pricing)); Datadog Bits and Sentry Seer end an investigation in a
proposed PR with hypotheses labelled validated, invalidated or inconclusive, never an auto-fix,
which is PRO-2's shape with a better report format
([Datadog](https://www.datadoghq.com/blog/bits-ai-sre/),
[Sentry](https://docs.sentry.io/product/ai-in-sentry/seer/)); and Fin's four billable outcomes
(resolution, procedure handoff, disqualification, self-serve routing) give the ledger a
vocabulary that charges or counts only verified outcomes ([Fin
pricing](https://fin.ai/pricing)). Exa and Parallel price research per request with known tiers,
so the Research agent's calls can be ledger lines rather than hidden token spend
([Exa](https://exa.ai/pricing), [Parallel](https://parallel.ai/pricing)).

## Build the gate and the manifest, buy OAuth plumbing and the long tail

No integration platform sells approval or tiering on the buyer's behalf. Composio, Nango,
Arcade, Klavis, Pipedream Connect and Merge Agent Handler are "agent-native" in the sense that
they sell per-end-user OAuth, JSON-Schema tool definitions, a hosted remote MCP endpoint and a
managed-OAuth-app option that spares the buyer Google and Meta app review; the closest things to
write-safety are Merge's DLP rules and Zapier's per-action toggles
([Composio](https://composio.dev/pricing), [Nango](https://nango.dev/pricing),
[Merge](https://www.merge.dev/agent-handler), [Zapier MCP](https://zapier.com/mcp)).
`AuthorityEngine.gate()` therefore has no substitute and stays in-house whatever the buy
decision. The economics favour buying the plumbing: at 1,000 founders with 5 connections each
and 300K tool calls a month, Composio works out at roughly $89 a month ($29 plus $0.0003 per
call over the free allowance), Nango pay-as-you-go at about $1,450 ($0.29 per connection),
Pipedream Startup at about $1,899 and Arcade at about $3,000, while Apideck and Unified.to start
at $599-750 a month before scale; Composio's and Nango's free tiers cover an MVP under 100
founders ([Composio](https://composio.dev/pricing), [Nango](https://nango.dev/pricing),
[Pipedream](https://pipedream.com/pricing), [Arcade](https://arcade.dev/blog/pricing-updates),
[Apideck](https://www.apideck.com/pricing), [Unified.to](https://unified.to/pricing)).
Composio's "self-managed credentials" mode, in which it "never stores or refreshes" tokens, and
Nango's BYOC or self-host are the only aggregator modes compatible with the SPEC guarantee that
tokens stay encrypted in North's Vault; neither vendor has an EU region by default (Nango states
"no EU-hosted cloud yet"; Composio's residency is "not stated"), so EU founders' data should not
transit the aggregator until that changes.

The recommended shape is a **three-lane transport behind one contract surface**. North's typed
provider contracts (`AdsProvider`, `OutreachMailProvider` and the rest of the eleven in
`packages/integrations`) remain the only thing agents and the gate ever see; underneath, native
adapters serve the money, ads and code core (Stripe, Meta, Google Ads, Gmail, GitHub, Vercel),
vendor-run remote MCP servers serve collaboration and commerce tools (Notion, Slack, Linear,
Stripe's `mcp.stripe.com`, Shopify's UCP, QuickBooks), and one aggregator serves the long tail.
Community stdio MCP servers are never used: the `modelcontextprotocol/servers` repo now keeps
only seven reference servers and has archived GitHub, Slack, Google Drive, Sentry and Postgres
([servers repo](https://github.com/modelcontextprotocol/servers)), and Invariant Labs showed
hidden instructions in tool descriptions reading `~/.cursor/mcp.json` and an SSH key, with "rug
pulls" after approval and cross-server shadowing
([Invariant](https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks)).
Stripe is the model of a cooperative provider: generic `stripe_api_read / write / search` tools
over an allow-listed method set keep the context small, and it "requires human confirmation
before it takes certain `stripe_api_write` actions, such as refunds and outbound payments"
through an approval URL whose token lasts 24 hours, with MCP switchable per live and sandbox
environment ([Stripe MCP](https://docs.stripe.com/mcp)). A K2 card that stores that provider
token, with the retry as a new gated action, exceeds the market norm, since nobody else shows
the user a diff of what a write will do before it runs except ChatGPT's action-definition diff.

Tiers, scopes and sandbox modes should become **data**, not code. The connector note proposes
`connector_manifests` (provider, version, transport, `auth_kind` in `oauth_user / api_key_user /
platform_key`, `oauth_client` in `north_registered / cimd / aggregator_managed`, minimum and
optional scopes, `sandbox_mode` in `provider_sandbox / north_mock / none`, `tool_pin_hash`) and
`connector_capabilities` (capability key, contract method, `direction` in `read / write / money
/ publish`, default `risk_tier`, `requires_card`, `reversible`, `external_confirmation`, daily
rate limit, payload schema), with `connections` gaining `manifest_id`, granted scopes, `mode`
(sandbox by default), `token_audience` and rotation timestamps, and `agent_tool_bundles` holding
a per-role allowlist with at most 20 `non_deferred` entries. The gate then computes the tier as
`max(cap.risk_tier, predicates(payload))`, forces K2 for any money or publish write while a
connection is in sandbox, requires the provider token where the capability says so, and appends
the action row with manifest version and pin hash. This also makes DEC-3's "don't ask again"
rules safe: an `auto_rule` binds to a `capability_key` and a payload predicate, so a rule
learned for `meta_ads.pause` can never widen to `meta_ads.set_budget`, and money capabilities
are excluded from auto-rules altogether. The M7-M13 design already states that vendor MCP write
tools run in the worker after `gate()` (MCP-1) and that pasted keys get a `connections.kind` of
`api_key`; the manifest generalises both into one declarative model, which is why the note
scores it at one to two engineering weeks rather than a rewrite.

Tool exposure has hard numbers. Anthropic says "Claude's ability to pick the right tool degrades
once you exceed 30-50 available tools", that a typical multi-server setup consumes about 55K
tokens of definitions, that tool search cuts that by over 85% and lifted MCP-eval accuracy from
49% to 74% on Opus 4 and 79.5% to 88.1% on Opus 4.5, with `defer_loading` available per server
or per tool and up to 10,000 deferred tools per request; OpenAI's guide says to "aim for fewer
than 20 functions available at the start of a turn" ([Tool
search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool),
[Advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use),
[OpenAI](https://developers.openai.com/docs/guides/function-calling)). Presenting MCP servers as
a code API tree the agent reads stubs from took one example from 150,000 to 2,000 tokens ([Code
execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp)). North's
coarse contracts are already the Stripe pattern of few generic tools over a scoped allowlist;
keep them as the agent-facing surface, start every task with at most 20 non-deferred tools, and
reach the long tail through server-side tool search, which costs nothing extra under the Agent
SDK.

MCP client hygiene is now a spec matter. The 2026-07-28 authorization spec mandates OAuth 2.1
with PKCE, RFC 8707 resource indicators and RFC 9728 protected-resource metadata, prefers Client
ID Metadata Documents and deprecates Dynamic Client Registration, forbids token passthrough and
describes scope step-up through `insufficient_scope` ([MCP
Authorization](https://modelcontextprotocol.io/specification/latest/basic/authorization),
[Security Best
Practices](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices)).
The practical consequence showed up in the research session itself: hosted servers for Asana,
PagerDuty, HubSpot, Xero and Zoom refused a DCR-only client. North should host a CIMD document,
keep pre-registered client IDs for Google, Meta, HubSpot and Xero, validate `iss` and
`resource`, pin tool lists with Claude's `mcp_tool_listing` and quarantine a server whose
description hash changes, and apply the lethal-trifecta partition: tasks that ingest untrusted
content (inbox triage, Reddit and competitor reads) run with `direction=read` bundles only, and
any write they propose becomes a card
([Willison](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/), [MCP
connector](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector)). OWASP's Top 10
for Agentic Applications (ASI02 tool misuse, ASI03 identity and privilege abuse, ASI06 memory
poisoning) names the same mitigations: per-task function allowlists, human approval for refunds,
account changes and external data transfers, and a distinct identity with short-lived
credentials per agent
([OWASP](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/)).

Which connectors come next is a reach-times-value question. Sourced usage data exists for three
verticals only: Zapier's popular-apps ordering (Google Sheets, Gmail, Slack, Google Calendar,
Drive, HubSpot, Facebook Lead Ads, Notion, Mailchimp, Stripe), Shopify's most-installed apps
(Judge.me, Klaviyo, Klarna messaging, Shopify Inbox, PageFly, Loox, Microsoft Clarity) and a YC
stack teardown (Next.js on Vercel, Stripe, Linear, Slack, Notion; Vercel on about 25.6% of YC
sites) ([Zapier apps](https://zapier.com/apps),
[Koala](https://koala-apps.io/blog/shopify-store-benchmarks/),
[cut-the-saas](https://cut-the-saas.com/teardowns/yc-company-tool-stack)). Four tools appear in
every vertical with evidence (Gmail/Workspace, Google Sheets, Stripe or Square, Zapier). The
waves that follow are Wave 1 (Google Calendar, Sheets and Drive read plus Sheets append, Slack
posts to the founder's own workspace, Notion read and artifact write, Linear issues), all
read-mostly and K0/K1 and all available through existing vendor MCP servers at about two to
three days each; Wave 2 (Shopify via UCP or Admin with a dev store, Klaviyo with send at K2,
QuickBooks or Xero read with the QBO sandbox, HubSpot with a pre-registered client, Mailchimp or
Beehiiv at K2 send), where the aggregator starts to pay; Wave 3 (Calendly, Typeform, Airtable,
YouTube and Instagram publishing, Square and Google Business Profile), with social publishing
read-only until a policy review as SPEC already does for Reddit. Any write that touches money
(Stripe refunds, QuickBooks invoices, Square) stays K2 with an external approval artifact and
never a stored "always allow".

## Ten leaf types and five axes route a founder's idea to a playbook

A business-model taxonomy with about ten leaves is enough, because what changes the playbook is
five axes rather than the label: `offer_kind` (physical, software, content, labour, access),
`payer` (consumer, business, developer, both sides, sponsor), `delivery` (shipped, hosted,
on-site, downloaded), `acquisition_prior` (paid social, search or LLM, outbound, community,
local) and `first_artifact` (store, landing, repo, app build, Google Business Profile, issue,
offer doc). Starter Story's idea database and Durable's six service categories already cut the
world nearly this way, and Starter Story's median monthly revenue per group (Micro SaaS $20K
across 829 ideas, Productized Services $40K, Agencies $200K, Niche Blog $10K) shows the leaves
differ in outcome, not only in process ([Starter Story](https://www.starterstory.com/ideas),
[Durable](https://durable.com/)). The ten leaves are `ecom_dtc`, `saas_b2b`, `devtool_plg`,
`consumer_app`, `marketplace`, `media_newsletter`, `agency_service`, `local_service`,
`info_course_community` and `micro_saas_indie`; hardware is refused politely in v1 because it
was not researched.

The verticals share the base skeleton (frame, ICP, riskiest assumptions, smoke test, first
customers, retention) and the review and card machinery, about 60% of the base document's steps,
but differ in four places. First, **what "validated" means**: for dropshipping it is product spy
data plus about 200 targeted ad visitors and five paid orders at a margin of at least 40% after
COGS and ads (a North proposal anchored on Shopify's nine-step guide, which watches ROAS and
profit by product) ([Shopify](https://www.shopify.com/blog/how-to-start-dropshipping)); for B2B
SaaS it is at least ten interviews, five commitments and three paid design partners or LOIs; for
a consumer app it is 100+ TestFlight users with D1 at or above 25% and trial-to-paid at or above
25%, anchored on RevenueCat's 2026 medians (trial-to-paid 34.2% in North America, only 17.3% of
new subscription apps reach $1K MRR within two years, AI-powered apps churn about 30% faster)
([RevenueCat](https://www.revenuecat.com/state-of-subscription-apps-2026/)); for a marketplace
it is a supply-density threshold before any demand launch (Uber's "over 30 drivers" with an ETA
under 15 minutes, OpenTable's 50-100 restaurants in a city) ([Lenny's
Newsletter](https://www.lennysnewsletter.com/p/how-to-kickstart-and-scale-a-marketplace)); for a
newsletter it is about 100 subscribers from direct outreach and one or two repeatable channels,
following beehiiv's staged bands (0-100 direct outreach, 100-1,000 lead magnets and
recommendations, 1,000-5,000 referrals, 5,000-10,000 paid)
([beehiiv](https://www.beehiiv.com/blog/the-ultimate-guide-to-growing-a-newsletter-from-0-to-10-000-readers));
for a dev tool it is a16z's three sequential fits (project-community fit by stars and PRs,
product-market fit by downloads and usage, value-market fit by revenue)
([a16z](https://a16z.com/open-source-from-community-to-commercialization/)).

Second, **which department leads week one**: Growth leads dropshipping (Engineering is off
entirely), Strategy leads B2B SaaS, Engineering leads dev tools, Design plus Engineering lead
consumer apps, Sales leads marketplaces (supply side) and agencies, Ops leads local services,
Strategy (offer) leads courses. Third, **which connectors are mandatory** (Shopify, Meta Ads and
a supplier app for e-commerce; GitHub, a package registry and Discord for dev tools; App Store
Connect and RevenueCat for apps; Google Business Profile, a field-service tool and phone or SMS
for local). Fourth, **which legal rules bite**: the FTC's final rule banning fake or
AI-generated reviews and testimonials makes the practitioner walkthrough's "we even generated
customer testimonial examples with ChatGPT" a rule North's critic and gate must enforce against,
and Meta requires that products promoted in an ad match the landing page
([FTC](https://www.ftc.gov/news-events/news/press-releases/2024/08/federal-trade-commission-announces-final-rule-banning-fake-reviews-testimonials),
[YouTube](https://www.youtube.com/watch?v=_KmXbRiJVyg),
[Meta](https://transparency.meta.com/policies/ad-standards/)). The per-vertical budget splits in
the note (for example 55% ads, 15% tools, 15% samples, 10% creative, 5% reserve for e-commerce)
are explicit North proposals, since no source publishes a split; they should be tuned from
ledger data.

Vertical AI products converge on four features that North's per-vertical module should expose
rather than re-implement: a named persona per job, a slash-command or task gallery, proactive
agents that act "with approval" inside the founder's own accounts, and an MCP endpoint. Shopify
Sidekick ships personas (Designer, Photo editor, Writer, Tech support, Marketer) and commands
(`/product-description`, `/pricing-strategy`, `/weekly-summary`, `/low-stock-alert`,
`/discount-code`) and is "included with your Shopify plan"
([Shopify](https://www.shopify.com/sidekick)); Triple Whale's Moby agents manage campaigns and
draft emails "integrating with Meta, Google, and Shopify to act in accounts with approval"
([martechvibe](https://martechvibe.com/?p=50568), secondary); Jobber's AI Receptionist books
jobs "always working within the limits you set" and owners switch suggested automations on one
by one; Podium pauses its agent for five minutes when a human joins a thread
([Jobber](https://www.getjobber.com/ai/), [Podium](https://www.podium.com/whats-new/26-7));
Kajabi Cofounder runs interview → roadmap → offers → pages and emails → pricing in one flow,
which is the course playbook's week one ([Kajabi](https://kajabi.com/cofounder)). AutoDS and
Minea's "daily winners with units sold in the last 7 days" is the `product_research` artefact
with cited data ([AutoDS](https://www.autods.com/), [Minea](https://www.minea.com/)). Omnisend,
Kit and Kajabi have all added MCP, so vertical connectors should be MCP-first.

Routing should be **classifier first, questions second, routing card always**. Products ask
between zero and nine questions; the useful ones ask business type → sub-type → what to
generate, make the questionnaire skippable, and use answers to pick templates and a starting
stack. Anthropic's own `smb-onboard` skill asks seven questions and compresses to three
("industry, headaches, tools — but never fewer") to assemble a 3-5 skill starting stack, and its
`smb-router` picks "the single best match, not a list", asking one disambiguating question only
when a brief's existence is unclear
([knowledge-work-plugins](https://github.com/anthropics/knowledge-work-plugins/tree/main/small-business)).
Polsia asks nothing and chose an AI-SDR agency by itself, posting publicly within ten minutes,
which the reviewer treats as the cautionary case
([Preuve](https://preuve.ai/blog/polsia-review.md)). The North design: the Chief of Staff
classifies the free-text idea on the five axes with a confidence per axis; four fixed questions
(what will customers pay for; who pays; do you already have an audience, list, store or repo,
with a link; can you build software yourself) and at most three conditional ones for axes under
0.7 confidence (delivery, geography, launch asset), for a total of at most seven, inside ONB-1's
five-question budget once the URL pre-fill removes most of them. "Never ask what the model can
read": a given store, repo or newsletter URL is fetched and pre-fills the axes, as Polsia's
"paste existing website" does. The output is a visible routing card ("Type: dropshipping store
(0.86). Alternatives: DTC brand, marketplace. Because: physical goods, consumer, no audience,
paid social") that the founder confirms or swaps inside onboarding, consuming no K2 card,
exactly like TEAM-1's team proposal. The **Walling guard** applies before the card: a founder
who cannot build software and wants to sell software is offered `agency_service`,
`info_course_community` or a platform-bound app first, with a one-line why, because step one of
the stair-step is "small bets on someone else's platform" ([Bootstrapped
Founder](https://thebootstrappedfounder.com/rob-walling-stair-stepping-into-saas-success/)).
Re-routing happens at journey gates as a review item when evidence contradicts the type.

Playbooks should be data composed in a fixed order: `core` → axis modules (attached by
`applies_to` axis values, so `media_newsletter` and `info_course_community` share
`growth.audience_first` while `ecom_dtc` and `local_service` share `ops.reviews_compliance`) →
vertical overlays → explicit `removes` (so a gate card can say "interviews skipped:
dropshipping") → a JSON-Patch `founder_patch` applied last so edits survive re-proposals at
gates. A `PlaybookModule` carries `kind` (stage, task bundle, persona, connector set, metric
set, rule set, threshold set), `requires` and `provides` edges, personas from
`agents/personas/*.yaml` (so the role still fixes tools and `max_action_tier`), skills by
SKILL.md name, task types, evidence rules, card templates, thresholds with `source_url`,
`confidence` (`north_default` or `anecdotal`) and `editable: true`, rules that the critic and
gate enforce, a version and a licence. Resolution rules keep the non-negotiables: a module may
add only cards whose tier is at or below the role's ceiling, founder threshold values win, a
department can be switched off but a stage whose gate needs its artefact fails validation, and
the company stores the resolved snapshot so a later module update becomes a review item rather
than a silent change. The Agent Skills spec is the right container for the know-how itself
(frontmatter `name`, `description`, optional `license`, `compatibility`, `metadata` map; main
file under 500 lines; metadata about 100 tokens at startup and body under 5,000 tokens on
activation), and Lindy already stores its playbooks as `.skills/<name>/SKILL.md` with personal >
team > system override and a version on every save, so SKILL.md with a `north.*` metadata block
is the de-facto interchange format ([agentskills.io](https://agentskills.io/specification),
[Lindy memory](https://docs.lindy.ai/teammate/memory)). Tool allowlists stay in role YAML, since
`allowed-tools` is experimental. Hormozi, Levels and Lenny material must be paraphrased into
North-authored skills, not vendored.

## The literature says make the Chief of Staff a verifying planner and spend cards by regret

Role-play companies (MetaGPT, ChatDev, CAMEL, AgentVerse) established that SOP-shaped pipelines
beat free chat, but the 2025 controlled evidence attributes most of the value to three
mechanisms rather than to more roles. MAST, the NeurIPS 2025 failure taxonomy over 1,642 traces
from seven systems, found failure rates between 41% and 86.7%, with step repetition (15.7%),
reasoning-action mismatch (13.2%), termination-unaware runs (12.4%) and incorrect or missing
verification (17.3% combined) as the largest modes; giving the CEO the final say and improving
role specs added 9.4%, and a high-level task-objective verification step added 15.6% ([arXiv
2503.13657](https://arxiv.org/html/2503.13657v3)). The Google/DeepMind/MIT scaling study across
180 configurations found a centralised system up 80.9% on parallelisable finance analysis but
every multi-agent variant down 39% to 70% on sequential PlanCraft, an average multi-agent effect
of -3.5%, error amplification of 4.4x centralised versus 7.8x decentralised and 17.2x
independent "because the orchestrator validates sub-agent outputs before aggregation", a penalty
on tool-heavy tasks, and a single agent winning once its baseline exceeds about 45% ([arXiv
2512.08296](https://arxiv.org/html/2512.08296v1)). Project Vend's phase two gave a CEO agent an
OKR tool and approval of financial decisions; it cut discounts about 80% but approved lenient
treatment about eight times as often as it denied it and tripled refunds, because both ran the
same model and the CEO "shared Claudius's blind spots", while rules in code (a 50% margin floor)
and separated roles did change behaviour
([Anthropic](https://www.anthropic.com/news/project-vend-2)). Persona prompts do not add
capability: across 162 roles, four model families and 2,410 questions the effect was "largely
random" ([arXiv 2311.10054](https://arxiv.org/abs/2311.10054)). North's topology (every hand-off
through the Chief of Staff, logged, no peer channels) is the centralised configuration with the
lowest measured amplification; the evidence does not support department-to-department chat, and
sequential, state-dependent work (an engineering change, a sales sequence) should be a single
run with a plan, never a chain of agents.

The single highest-leverage change is to make the Chief of Staff **verify, not just route**.
Magentic-One's orchestrator keeps a Task Ledger (facts, guesses, plan) and a Progress Ledger
that answers five questions per step (done? looping? progress? who next? what instruction?),
with a stall counter above two triggering reflection, a new plan and an agent context reset;
removing the ledgers cost 31% of its GAIA score ([arXiv
2411.04468](https://arxiv.org/html/2411.04468v1)). ADaPT decomposes recursively only when the
executor fails and gained 27-33% over plan-and-execute baselines, and a planner given explicit
worker-capability information allocates better, especially when some workers are weak ([arXiv
2311.05772](https://arxiv.org/abs/2311.05772), [arXiv
2504.02051](https://arxiv.org/abs/2504.02051)). For North this means a persisted task and
progress ledger per task in `packages/core`, a stall counter and re-plan triggers (evidence
check failed, same tool and arguments twice, no new artefact in N steps, 80% of budget consumed,
negative ledger outcome after publish) with a short retrospective and context reset, lazy
decomposition (one task per department first, split only on failure, the split logged as a Chief
of Staff action), and a department "agent card" (capabilities, tools, data classes, K-tier
defaults, recent ledger score) that a deterministic-first router reads with an LLM tie-break and
logged reasons. Auctions and blackboards add nothing with seven fixed departments and one
principal; A2A and ACP add nothing while hand-offs are database rows, though their task-state
and artifact vocabulary (submitted, working, input-required, completed, failed, canceled) is
worth copying so an adapter is cheap later ([A2A](https://github.com/a2aproject/A2A), [arXiv
2505.02279](https://arxiv.org/abs/2505.02279v2)).

Oversight research points the same way as North's tiers and sharpens them. Magentic-UI's action
guards label actions always, maybe or never irreversible, send "maybe" to a cheap judge, and
with a site allowlist blocked 24 of 24 adversarial scenarios, while with guards off a prompt
injection exfiltrated keys and the agent "approved its own actions"; a user who supplied a plan
raised GAIA from 30.3% to 51.9% while being asked for help in only 10% of tasks ([arXiv
2507.22358](https://arxiv.org/html/2507.22358v1)). Anthropic and Redwood's control evaluation
found "deferring on critical actions stayed highly robust even against the strongest red team
strategies" and that a red team with knowledge of protocol internals cut safety from 96% to 17%,
so thresholds and audit sampling must stay out of agent context ([arXiv
2511.02997](https://arxiv.org/abs/2511.02997)). Anthropic's agentic-misalignment study
recommends human approval for irreversible actions, need-to-know data access and avoiding strong
goal instructions ([Anthropic](https://www.anthropic.com/research/agentic-misalignment)). The
gate should therefore decide by action class (irreversibility label × stake band × counterparty)
with hard floors in code (margin, discount, refund, spend, data class, hiring and contracts
always K3), and over-accommodation should be treated as the dominant commercial failure:
CRMArena-Pro measured near-zero inherent confidentiality awareness and a drop from about 58%
single-turn to 35% multi-turn, with prompting for caution costing task performance ([arXiv
2505.18878](https://arxiv.org/abs/2505.18878)). Data-class tags on memory items, with the gate
denying any external send that contains an internal class, is the code-level answer.

A decision-card budget is a **deferral budget**, and the formal literature (DeCCaF's
capacity-constrained deferral, d-GNP's expert intervention budget, The Oversight Game's result
that autonomy granted when acting is safe cannot lower the human's value) gives it a shape even
though no paper models three decisions a day ([arXiv
2403.06906](https://arxiv.org/abs/2403.06906), [arXiv
2407.12710](https://arxiv.org/abs/2407.12710), [arXiv
2510.26752](https://arxiv.org/abs/2510.26752)). Mandatory cards (always-irreversible above the
K3 floor) go first regardless of budget, with the founder shown the queue length; the remaining
K2 requests are ranked by expected regret of auto-deciding, P(overrule) × loss if the default is
wrong, with P(overrule) estimated from past answers per department, action type and amount band;
requests below the line take the learned default, and when overrule probability is high but the
stake is low the default is decline-and-park rather than approve. Every answer becomes a short
written preference with scope, provenance and expiry (the PRELUDE/CIPHER shape, which had the
lowest edit cost among baselines) and a gate default the founder can edit, and a department's
auto-approve band widens only after N consecutive verified ledger outcomes and narrows on any
loss ([arXiv 2404.15269](https://arxiv.org/abs/2404.15269)). Ask-before-Plan and
uncertainty-guided clarification add the intake rule: a department may not raise a card until it
has exhausted lookups, and the Chief of Staff bundles related questions into one card scored by
expected value of information ([arXiv 2406.12639](https://arxiv.org/abs/2406.12639), [Adobe
Research](https://research.adobe.com/publication/structured-uncertainty-guided-clarification-for-llm-agents)).
The hot-path extractor in LRN-* already writes card answers as `rule` lessons; the delta is
feeding them back into gate defaults and the regret estimate.

Evidence and evaluation close the loop. Intrinsic self-correction without external feedback does
not help and sometimes degrades results ([arXiv 2310.01798](https://arxiv.org/abs/2310.01798));
Agent-as-a-Judge, which checks intermediate steps against a requirements list, "substantially
outperforms LLM-as-a-Judge" and matched a human baseline on 55 DevAI tasks ([arXiv
2410.10934](https://arxiv.org/abs/2410.10934)); judges show position, verbosity and
self-preference bias, the last explained by lower perplexity of familiar text ([arXiv
2410.21819](https://arxiv.org/abs/2410.21819), [arXiv
2410.02736](https://arxiv.org/abs/2410.02736)). So evidence is deterministic sensors first (HTTP
status, file hash, ledger row, screenshot diff), a requirement checklist per deliverable type
second, a holistic judge last, in randomised order, length-normalised, on a different model
alias from the generator; the M7-M13 design's pinned judge and separate critic already follow
this, and the North-Company evaluation suite should report pass^k (k=3) with cost rather than
pass@1, because TheAgentCompany's best agent fully completes 30.3% of simulated office tasks at
$4.2 per task, agents there "deceived" themselves by renaming a user to the name they were
looking for, and SWE-bench Pro scores halve under a $2 and 50-turn cap ([arXiv
2412.14161](https://arxiv.org/html/2412.14161v2), [arXiv
2509.16941](https://arxiv.org/html/2509.16941v2), [arXiv
2506.07982](https://arxiv.org/abs/2506.07982)). Social tasks (replying to a counterparty) must
be in the suite because they are the weakest, and the kill switch must stay external to the
agent loop and unobservable by it (Inngest `cancelOn` plus hook deny), which the design already
does ([Interruptibility](https://intelligence.org/files/Interruptibility.pdf)).

## Prioritised backlog and roadmap input

Effort: S = up to one engineer-week, M = one to three weeks, L = three to six weeks, XL = more.
Status: **planned** (already in M7-M13 as written), **extends** (adds to a planned item),
**new**. Milestones M14-M16 are proposed here: **M14 Connector platform**, **M15 Playbooks and
routing**, **M16 Chief of Staff v2**. Items inside M7-M12 are small enough to land without
moving those milestones' acceptance tests; items in M14-M16 should each get a
`docs/plans/M<n>.md` with a T4 acceptance before code.

### Tier A: inside M7-M9 (ground truth, studio, design + frontend)

| # | Feature | Proven by | Why | North home | Effort | Depends on | Status |
|---|---|---|---|---|---|---|---|
| A1 | Cost meter and pause: live cost vs `maxBudgetUsd` on the work view and the mobile one-liner; pause at 80% with a K1 "continue / wrap up" item; failed attempts never charged | Lovable 20-credit check-in, Replit confirm-before-paid, Managed Agents `budget_reached` ([Lovable](https://docs.lovable.dev/features/agent-mode), [Budgets](https://platform.claude.com/docs/en/managed-agents/budgets)) | Unexplained burn is the top complaint in every category; a hidden cap kills silently | LIVE-1, model gateway (SEC-1) · M8 | S | `agent_run_events`, gateway caps | extends |
| A2 | Argument-level rules: `auto_rules` bind to `capability_key` plus a Zod/CEL payload predicate; money capabilities excluded from auto-rules | Gumloop App Rules, Managed Agents per-tool policy ([Gumloop](https://docs.gumloop.com/core-concepts/human_in_the_loop.md)) | A "don't ask again" rule must never widen from pause-ad to raise-budget | DEC-3, `AuthorityEngine` · M7 | S | none (schema change on `auto_rules`) | extends |
| A3 | Hard floors in code: margin, discount, refund, single-spend, data class, hiring and contract actions always K3; floors never in prompts | Project Vend 2 50% margin floor; CRMArena-Pro ([Anthropic](https://www.anthropic.com/news/project-vend-2)) | Prompted caution costs task performance; same-model critics rubber-stamp | `AuthorityEngine` rule engine · M7 | S | none | new |
| A4 | Data-class tags on `memory_items` and artifacts; gate denies any external send containing class ≥ internal | CRMArena-Pro confidentiality result ([arXiv 2505.18878](https://arxiv.org/abs/2505.18878)) | Agents have near-zero confidentiality awareness | MEM-1, CMP-1, gate · M7 | M | LRN-6 data blocks | new |
| A5 | Brand-kit lock states and evidence labels (`fixed/proposed/unknown`, `measured/inferred`), ≥2 avoid rules, per-format `applications`, slot-level dependency invalidation | Higgsfield Brand Lock, Stitch DESIGN.md ([VoltAgent](https://github.com/VoltAgent/awesome-design-md)) | Separates founder-approved from agent-proposed; stops drift in later creatives | DSN-1 `BrandKit` · M9 | S | DSN-1 schema | extends |
| A6 | Agent-generated knobs (3-4 sliders per artifact) and editable text/image slots that re-render without an agent run | Claude Design, Open Design ([Flux Academy](https://www.youtube.com/watch?v=fRAUuluAirM), [Open Design](https://github.com/nexu-io/open-design)) | Prompt-only editing is slow, breaks pages and costs credits | REV-2, studio loop · M9 | M | artifact versioning | new |
| A7 | Design Critic "design specificity" fail plus slop-tell list; critique output in observation-impact-request shape, one finding per item | Impeccable, A List Apart, noqta ([Impeccable](https://github.com/pbakaus/impeccable/blob/main/skill/reference/critique.md)) | Findings map one-to-one to `revise_artifact`; identical prompts converge on template-looking pages | LOOP-1 rubrics · M8-M9 | S | `agents/rubrics/*.yaml` | extends |
| A8 | Security scan at publish, block-on-critical by default, grouped findings on the go-live card; checkpoint before any auto-fix | Lovable Quick/Deep scan, Base44 ([Lovable security](https://docs.lovable.dev/features/security)) | 63% of audited AI-built apps had high/critical findings (vendor sample); default-off blocking is the market's mistake | WEB-1 gates · M9 | M | worker-run gates | new |
| A9 | Go-live card embeds proof: gate scores, Playwright recording, synthetic signup row, diff summary | Cursor artifacts-on-PR, Devin recordings ([Cursor](https://cursor.com/docs/cloud-agent/capabilities)) | Nobody re-verifies from outside the agent; showing it is North's differentiator | DEC-2 card UI, WEB-1 · M9 | S | Evidence schema | extends |
| A10 | Editable plan card: one compact card per build, sections editable, defaults pre-filled, auto-proceed at the deadline; approved plan stored in the repo | Lovable plan versions, Base44 compact cards, Jules timer ([Lovable](https://docs.lovable.dev/features/plan-mode), [Jules](https://jules.google/docs/review-plan/)) | Rations clarification to fit the quota; plan becomes a versioned file | Engineering, DEC-2 · M9 (landing), full app later | M | REV-1 review items | new |
| A11 | Follow-ups while working: a "send correction" box applied at the next stopping point | Lovable Sep 2026, Codex queue ([Lovable changelog](https://docs.lovable.dev/changelog)) | Prevents stop-and-restart waste | LIVE-1 · M8 | S | session store | extends |
| A12 | Routines table: trigger (cron + IANA tz, jitter), prompt, destination, budget, first message, run records with `error.type`, auto-pause; mandatory dry run before enabling | Lindy Routines, Managed Agents deployments ([Lindy](https://docs.lindy.ai/teammate/routines), [Scheduled deployments](https://platform.claude.com/docs/en/managed-agents/scheduled-deployments)) | Brief, scans, weekly close and retros share one shape; sandbox-default rule gets a mechanism | BRF-1, PRO-1, LRN-3 · M8 | M | Inngest cron bodies shared with events (exists) | new |

### Tier B: inside M10-M12 (research, marketing, sales)

| # | Feature | Proven by | Why | North home | Effort | Depends on | Status |
|---|---|---|---|---|---|---|---|
| B1 | Department contract card: one K2 card per department per week approving goal, budget band, channel allowlist, autonomy level and stop rule; everything inside the band runs K0/K1; cost estimate on the card | Salesforce Goals Agent, Lindy outside-impact rule ([360degreecloud](https://360degreecloud.com/blog/salesforce-just-introduced-4-new-ai-agents-for-marketing-what-does-it-mean-for-you/), [Lindy](https://www.lindy.ai/pricing)) | The only way 3 cards/day runs a marketing or sales department; shows weekly cost up front | TEAM-2 dial, DEC-1, PLN-1 · M11 | M | A2, A3, B2 | new |
| B2 | Growth weekly readout: ranked top-3 opportunities with the fix pre-built, folded into the contract card; receipts (quotes, links, counts) required | Klaviyo Composer audit, Isenberg growth cockpit ([Klaviyo](https://www.klaviyo.com/newsroom/CRM-agents)) | Measurement becomes the next card, not a dashboard | PLN-2, BRF-1 · M11 | S | ledger windows | extends |
| B3 | Grid review surface for batches: rows = assets, columns = steps, critic and on-brand score chips, per-row edit re-runs the critic on that row only | AirOps Grids, Jasper Grid ([AirOps](https://www.airops.com/pricing)) | 10-20 creatives per run do not fit a list; no vendor documents batch-plus-edit, so North designs it | REV-1 UI · M11 | M | `review_items`, `critiques` | extends |
| B4 | Business DNA pre-fill: a URL or three photos extracts tone, palette, fonts, imagery and products into memory and the brand kit before any question | Pomelli, Higgsfield Ads Studio research card, AdCreative URL scan ([Google blog](https://blog.google/technology/google-labs/pomelli/), [Higgsfield](https://higgsfield.ai/blog/higgsfield-ads-studio)) | "Never ask what the model can read"; cuts onboarding questions | ONB-1, DSN-1 intake · M10 | M | signals `competitor_sites` adapter | new |
| B5 | Voice-from-evidence: style guide derived from the founder's sent mail (consented), tested on a real draft, stored with provenance | Martell, Lately ([Martell](https://www.youtube.com/watch?v=Bm84BAtOfQw), [Lately](https://www.lately.ai/)) | Voice guide becomes Evidence-backed instead of a form | MEM-1, SDR Copywriter · M12 | S | Gmail read scope (CASA note) | new |
| B6 | Play record: versioned `{trigger, audience, steps, voice_profile, offer, caps, stop_rules, write_back}`; each run append-only and pinned to the play version; `gate()` is the mandatory approve step | Clay Workflows, Apollo, Unify ([Clay](https://www.clay.com/blog/introducing-workflows)) | Maps onto `actions` and Evidence; makes "why was this sent" machine-checkable | SLS-3, OutreachBatch · M12 | M | A2, B1 | new |
| B7 | Signal-fired plays with weighted, layered signals and thresholds; no fixed-schedule enrolment | 11x signals, firstsales ([11x](https://www.11x.ai/platform/data-lead-generation/signals-and-triggers)) | Meetings come from list and signal, not the model | SLS-1, Signal · M12 | M | B6, Exa/Apollo tools | new |
| B8 | Stop rules as data on the Play (opt-out, bounce %, unread drafts, 3 touches no reply, OOO +2 days, list bloat) | Unify founder guide ([Unify](https://www.unifygtm.com/explore/how-to-do-founder-led-sales)) | Cheap, deterministic, protects domain and reputation | SLS-2 · M12 | S | B6 | extends |
| B9 | Reply SLA and co-pilot handoff: positive reply → K0 reply item within 4 h with the draft pre-filled; booking carries thread, research and signal into the pipeline record | Instantly HITL, AiSDR, GTMLens, Agentforce ([GTMLens](https://gtmlens.com/bp-why-ai-sdrs-fail-three-patterns/)) | Replies are where meetings are won; booking is the handoff | `reply_triage`, SLS-4 · M12 | S | pipeline_events | extends |
| B10 | Tone and CTA locks plus escalation rules on the Play; email rubric score (length, grade) on the card | Artisan, Lavender ([Artisan](https://www.artisan.co/llms-full.txt), [Lavender](https://www.lavender.ai/blog/6879935-lavender-best-practices)) | Lets a batch approval be safe and fast to read | SLS-3, Sales Critic · M12 | S | B6 | extends |
| B11 | Outcome vocabulary for the ledger (resolution, handoff, disqualification, routing, shipped, verified) and cost per approved contact and per meeting | Intercom Fin, Sierra, HubSpot $1/lead ([Fin](https://fin.ai/pricing), [Sierra](https://sierra.ai/blog/outcomemaxxing)) | Counts only verified outcomes; reporting in founder terms | OUT-1, `ledger_entries` · M10 | S | none | new |
| B12 | Ops/Finance policy and weekly close routine: auto-code and flag, any transfer K2/K3, six-step close with an AI quality review before the card; incidents end in a proposed PR with validated/invalidated/inconclusive hypotheses | Ramp, Digits, Datadog Bits, Sentry Seer ([Ramp](https://ramp.com/intelligence), [Digits](https://digits.com/pricing)) | The exact K1/K2 split for money; PRO-2 report format | Ops/Finance, PRO-2 · M10 | M | A12, QuickBooks read (M14) | extends |
| B13 | Metered research tools (Exa, Parallel) as ledger lines per request; Exa Monitors for competitor watch | Exa, Parallel pricing ([Exa](https://exa.ai/pricing), [Parallel](https://parallel.ai/pricing)) | Research cost becomes visible and capped | Research, PRO-1 · M10 | S | api_key connections | new |
| B14 | Launch plan task guide with hard field validation (Product Hunt: tagline 60 chars, gallery 1270×760, 12:01 AM PT, 15-min reply SLA, 400+ warm list, no upvote asks) | ToolJunction 2026 checklist ([ToolJunction](https://www.tooljunction.io/guides/product-hunt-launch-checklist-2026)) | Encodable as data; policy-safe | Growth task guides · M11 | S | none | new |

### Tier C: new milestones M14-M16

| # | Feature | Proven by | Why | North home | Effort | Depends on | Status |
|---|---|---|---|---|---|---|---|
| C1 | `connector_manifests` + `connector_capabilities` + `agent_tool_bundles`; gate reads tier, direction and sandbox mode from rows; money/publish forced K2 in sandbox; action rows carry manifest version and pin hash | Stripe MCP method allowlist, Merge Tool Packs, Managed Agents per-tool policy ([Stripe](https://docs.stripe.com/mcp)) | New connectors become data; every gate decision is explainable; no vendor sells this | `packages/integrations`, `AuthorityEngine` · **M14** | M (1-2 wks) | A2 | new |
| C2 | MCP client lane: CIMD document, pre-registered client IDs (Google, Meta, HubSpot, Xero), `iss`/`resource` validation, HTTPS-only metadata, tool-list pinning with hash alert and quarantine, egress proxy | MCP spec 2026-07-28, Invariant Labs, Claude `mcp_tool_listing` ([MCP auth](https://modelcontextprotocol.io/specification/latest/basic/authorization), [Invariant](https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks)) | DCR-only clients fail against real servers; rug-pulls are a live attack | MCP-1 · **M14** | M (1-2 wks) | C1 | extends |
| C3 | Provider approval tokens: a K2 card stores Stripe's 24-hour approval token; retry is a new gated action; kill switch revokes Vault tokens and Stripe sessions | Stripe MCP confirmation flow ([Stripe](https://docs.stripe.com/mcp)) | Provider-cooperative confirmation beats a North-side "always allow" | gate, KillSwitch · **M14** | S | C1, C2 | new |
| C4 | Wave 1 connectors through the MCP lane: Google Calendar/Sheets/Drive (read, Sheets append), Slack (post to founder's workspace), Notion (read, write artifact), Linear (issues) | Zapier popular apps, YC stack ([Zapier](https://zapier.com/apps), [cut-the-saas](https://cut-the-saas.com/teardowns/yc-company-tool-stack)) | Pure reach, read-mostly, K0/K1; about 2-3 days each | ONB-3 · **M14** | M | C2 | new |
| C5 | Aggregator lane (Composio self-managed credentials first) behind contracts; per-call token injection from Vault; zero raw tool names in any agent tool list; EU founders excluded until residency exists | Composio and Nango pricing/custody ([Composio](https://composio.dev/pricing), [Nango](https://nango.dev/pricing)) | Long tail at ~$89/mo for 1K founders; gate stays unbypassable | `packages/integrations` · **M14** | S (1 wk) | C1 | new |
| C6 | Wave 2 connectors with provider sandboxes: Shopify (UCP/Admin, dev store), Klaviyo (send K2), QuickBooks/Xero read, HubSpot, Mailchimp/Beehiiv (send K2) | Shopify app leaderboard, QBO sandbox ([Koala](https://koala-apps.io/blog/shopify-store-benchmarks/)) | Unlocks `ecom_dtc`, `local_service`, `media_newsletter` playbooks | **M14** / M15 | M (2 wks) | C4, C5 | new |
| C7 | Tool budget enforcement: ≤20 non-deferred tools per role, server-side tool search for the rest, Langfuse "tool found / misfired" metric | Anthropic 30-50 threshold, OpenAI <20 ([Tool search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool)) | Accuracy degrades past 30-50 tools; deferral cuts context ~85% | AgentRuntime · **M14** | S | C1 | new |
| C8 | Vertical taxonomy (10 leaves, 5 axes) and routing: classifier with per-axis confidence, ≤4 fixed + ≤3 conditional questions, URL pre-fill, visible routing card (no quota), Walling guard, re-route at gates as a review item, append-only `routing_log` | `smb-onboard`/`smb-router`, Shopify skippable questionnaire, Polsia as anti-pattern ([knowledge-work-plugins](https://github.com/anthropics/knowledge-work-plugins/tree/main/small-business), [Bootstrapped Founder](https://thebootstrappedfounder.com/rob-walling-stair-stepping-into-saas-success/)) | The current plan has one generic journey; most founders are not building B2B SaaS | ONB-1, TEAM-1, ChiefOfStaff · **M15** | M | B4 | new |
| C9 | Playbook schema: `PlaybookModule` and `Playbook` (Zod, `agents/playbooks/`), axis-attached modules, overlays, `removes`, `founder_patch`, resolved immutable snapshot per company, thresholds with `source_url` and `confidence`, module update = review item | Agent Skills spec, CrewAI configs, `startup-growth-playbook` ([agentskills.io](https://agentskills.io/specification), [GitHub](https://github.com/fayerman-source/startup-growth-playbook)) | Encodes exit criteria as editable data; keeps the gate and tier rules | `packages/core/src/playbooks/` · **M15** | L | C8, SKL-1 | new |
| C10 | First three vertical overlays (founder decision; suggested `saas_b2b`, `ecom_dtc`, `media_newsletter`) with personas, connector sets, metric sets, rule sets (FTC reviews, Meta landing match) and validation thresholds; stage strip reads the playbook | Shopify guide, beehiiv bands, Lenny marketplace, RevenueCat ([Shopify](https://www.shopify.com/blog/how-to-start-dropshipping), [beehiiv](https://www.beehiiv.com/blog/the-ultimate-guide-to-growing-a-newsletter-from-0-to-10-000-readers)) | 40% of steps differ per vertical; validation thresholds are the gate's actuals | **M15**, journey stage strip (M10) | L | C9, C6 | new |
| C11 | Chief of Staff ledgers and verifier: persisted Task Ledger and Progress Ledger per task, stall counter (2) with context reset and re-plan, lazy decomposition logged as an action, a separate verification call (rubric + deterministic sensors) before any department output is accepted or forwarded | Magentic-One, MAST +15.6%, scaling study ([arXiv 2411.04468](https://arxiv.org/html/2411.04468v1), [arXiv 2503.13657](https://arxiv.org/html/2503.13657v3)) | The single highest-leverage architectural change; verification is what lowers amplification to 4.4x | PLN-1, AGT-2/3, `packages/core/src/plan/` · **M16** | L | A12 | new |
| C12 | Department agent cards (capabilities, tools, data classes, K defaults, recent ledger score) feeding a deterministic-first router with LLM tie-break and logged reasons; A2A-style task states | OWL Workforce, self-resource allocation, A2A vocabulary ([arXiv 2505.23885](https://arxiv.org/abs/2505.23885), [A2A](https://github.com/a2aproject/A2A)) | Capability information to the planner improves allocation; makes routing auditable | ChiefOfStaff · **M16** | M | C11, C1 | new |
| C13 | Regret-based card allocator: mandatory cards first (queue length visible), remaining K2 ranked by P(overrule) × loss-if-wrong from past answers per (department, action, band); below-line requests take the learned default or park; autonomy bands widen on N verified outcomes and narrow on loss | DeCCaF, d-GNP, Oversight Game, PRELUDE ([arXiv 2403.06906](https://arxiv.org/abs/2403.06906), [arXiv 2510.26752](https://arxiv.org/abs/2510.26752), [arXiv 2404.15269](https://arxiv.org/abs/2404.15269)) | Turns the quota from a sort into a learned deferral budget; reports regret avoided | DEC-3, AutoRule, LRN hot path · **M16** | M | A2, LRN-4 | extends |
| C14 | North-Company evaluation suite: 20-50 tasks per department in sandbox integrations, result plus sub-checkpoint grading, pass^k (k=3) with cost, social tasks included; MAST-style trace annotator on North's own runs | TheAgentCompany, tau2 pass^k, MAST annotator ([arXiv 2412.14161](https://arxiv.org/html/2412.14161v2), [arXiv 2506.07982](https://arxiv.org/abs/2506.07982)) | Long-horizon variance makes pass@1 misleading; cost caps change results | `packages/evals` (TST-3) · **M16** | L | eval harness (M7) | extends |
| C15 | "Managed by North" first-build backend option: waitlist table and transactional mail provisioned by North for the first preview, with a K2 migration card to the founder's own Supabase/Resend later; secrets through a secure-input step the agent never reads | Lovable Cloud/payments, Base44 one-click Stripe, v0 Marketplace ([Lovable cloud](https://docs.lovable.dev/features/cloud), [Lovable Stripe](https://docs.lovable.dev/integrations/stripe)) | Every competitor needs zero user accounts for a waitlist page; the spec's own-Supabase choice is the weakest onboarding in the category | WEB-1, ONB-3 · founder decision (see below) | M | C1 | new (conflicts with a founder decision) |
| C16 | Multiplayer session sharing: a co-founder or advisor watches a live run and can redirect | YC RFS "Multiplayer AI" ([YC RFS](https://www.ycombinator.com/rfs)) | Later; the only collaboration pattern with investor demand evidence | LIVE-1, MULTI-1 · post-M16 | M | LIVE-1 | new |

### Roadmap view

| Milestone | Adds from this report | Acceptance delta (proposed) |
|---|---|---|
| M7 Ground truth | A2 argument-level rules, A3 code floors, A4 data-class tags | Gate test: an `auto_rule` for `meta_ads.pause` does not apply to `meta_ads.set_budget`; an external send containing an `internal` memory item is refused |
| M8 Studio | A1 cost meter, A7 critic shape, A11 follow-ups, A12 routines with dry run | A brand run pauses at 80% of budget with a continue/wrap-up item; a new routine's first run writes nothing external |
| M9 Design + Frontend | A5 lock states, A6 knobs and slots, A8 scan at publish, A9 proof on card, A10 plan card | Go-live card shows scan findings, gate scores and the recording; a palette change regenerates exactly three logo candidates |
| M10 Research + Strategy | B4 DNA pre-fill, B11 outcome vocabulary, B12 Ops/Finance close, B13 metered research | Onboarding from a URL asks at most 3 questions; a weekly close produces one card with a quality-review line |
| M11 Marketing | B1 contract card, B2 weekly readout, B3 grid review, B14 launch guide | One weekly K2 card unlocks a creative set, calendar posts and an ad test inside its band; the batch is approved from a grid |
| M12 Sales | B5 voice, B6 Play, B7 signals, B8 stop rules, B9 reply SLA, B10 locks | A play run of 20 contacts is approved by one card; a positive reply opens a reply item within 4 hours; a bounce rate over the stop rule pauses the play |
| M13 Thirty-day run | unchanged | SPEC M6 acceptance with the studio |
| **M14 Connector platform** | C1-C7 | Seed rows for the existing adapters; a Notion artifact write runs as K1 with an action row; a changed MCP tool hash quarantines the server; zero aggregator tool names in any agent tool list |
| **M15 Playbooks and routing** | C8-C10 (and C6 if not done) | An idea URL yields a routing card with confidence and alternatives; a dropshipping company reaches its ad-test gate with Engineering off and the FTC rule enforced by the critic |
| **M16 Chief of Staff v2** | C11-C14 | A department output that fails objective verification never reaches a card; the allocator issues ≤3 cards ranked by regret and reports overrule rate; pass^k is reported on the golden suite |

Sequencing rationale: M14 before M15 because the vertical overlays depend on Shopify, Klaviyo,
QuickBooks and Beehiiv connectors; M16 last because the verifier and allocator need ledger
history and the eval suite to calibrate, and because the M7-M13 design's learning loop (LRN-4,
lesson applications) is the data source for P(overrule). The connector note's own effort figures
(manifest 1-2 weeks, MCP client 1-2 weeks, aggregator lane 1 week, Wave 1 connectors 2-3 days
each) put M14 at roughly six engineer-weeks.

## Patterns to avoid

| Pattern | Who shows the damage | Evidence | North rule |
|---|---|---|---|
| Credits that reset silently, bill failed runs, or have no price table | Manus (476K credits lost on reset), Lindy, Genspark, Polsia, Emergent | [preuve.ai](https://preuve.ai/blog/manus-ai-review), [Crevio](https://crevio.co/blog/is-polsia-legit), [hostadvice](https://hostadvice.com/ai-app-builders/emergent-review/) | Price before run, failed attempts not charged, a ledger line per action, meter visible (A1) |
| "Done" by agent self-report | Polsia tasks "reported done when they aren't"; Agents of Chaos; TheAgentCompany self-deception | [arXiv 2602.20021](https://arxiv.org/abs/2602.20021), [arXiv 2412.14161](https://arxiv.org/html/2412.14161v2) | Evidence from telemetry only; verifier is a separate call (C11) |
| Same-model CEO or critic with the worker's transcript | Project Vend 2 Seymour Cash; self-preference bias | [Anthropic](https://www.anthropic.com/news/project-vend-2), [arXiv 2410.21819](https://arxiv.org/abs/2410.21819) | Critic with different context and alias; never the department's own critic as the nightly judge |
| Free group chat or agent chains for sequential work | MAST 41-86.7% failure; scaling study -39% to -70% | [arXiv 2503.13657](https://arxiv.org/html/2503.13657v3), [arXiv 2512.08296](https://arxiv.org/html/2512.08296v1) | Hub-and-spoke through the Chief of Staff; single long run for sequential tasks |
| Persona prose as a substitute for tools, data and evidence contracts | 162-persona study: effect "largely random" | [arXiv 2311.10054](https://arxiv.org/abs/2311.10054) | Personas narrow tools and add skills; roles fix ceilings |
| Letting agents see gate thresholds or audit sampling | Red team with protocol internals: safety 96% → 17% | [arXiv 2511.02997](https://arxiv.org/abs/2511.02997) | Thresholds live in the gate, never in prompts |
| Silent or ambiguous autopilot | HubSpot "fully autonomous mode", Madgicx "autonomously" vs click Launch, Lindy demo without visible gate | [HubSpot](https://www.hubspot.com/products/sales/ai-prospecting-agent), [Madgicx](https://madgicx.com/ai-marketer) | Every external action through `gate()`; autonomy only inside an approved band (B1) |
| Volume as the lever; shared sending pools; template personalisation | 6.4x volume → 38% lower replies; open rates collapsing to 8-12% by week three; "I noticed you recently joined Acme" | [OneAway](https://oneaway.io/blog/ai-sdr-tools-2026), [GTMLens](https://gtmlens.com/bp-why-ai-sdrs-fail-three-patterns/), [firstsales](https://firstsales.io/blog/ai-sdr-mistakes/) | Own mailbox, 20/day/inbox, research brief per contact, signal-fired plays |
| AI answering after an opt-out; unmonitored reply queues | firstsales "the conversation we haven't had yet" | [firstsales](https://firstsales.io/blog/ai-sdr-mistakes/) | Suppressions in `gate()` (CMP-1); reply SLA (B9) |
| Generated testimonials and fake reviews | Welch walkthrough; FTC rule bans them with civil penalties | [FTC](https://www.ftc.gov/news-events/news/press-releases/2024/08/federal-trade-commission-announces-final-rule-banning-fake-reviews-testimonials) | Rule set in the e-commerce and local playbooks, enforced by critic and gate |
| Asking for upvotes; promotional Reddit posting | Product Hunt removes posts; mods remove and downvote | [ToolJunction](https://www.tooljunction.io/guides/product-hunt-launch-checklist-2026), [zplatform](https://zplatform.ai/guides/best-reddit-communities-ai-marketing/) | Reddit read-only (SPEC); launch guide forbids vote asks (B14) |
| Bulk "SEO at scale" article factories | Byword positioning vs Google scaled-content policy | [Byword](https://byword.ai/pricing) | SEO pages as reviewed PRs (MKT-5) |
| Prompt-only editing for small changes; template re-skinning sold as identity | Steve Builds Websites; Looka, Tailor "heavily templated"; Magic Design converges on popular layouts | [YouTube](https://www.youtube.com/watch?v=wbyPMZ6Y6Qw), [macmyths](https://macmyths.com/tailor-brands-review-2026-logo-design-features/) | Knobs and slots (A6); directions must differ structurally |
| Proprietary kit format with one-way hand-off | Claude Design "not standardized" | [BGP](https://www.youtube.com/watch?v=6OpWU-HrsuQ) | DESIGN.md + `tokens.json` (DSN-1) |
| Agent-side verification only; whole-file rewrites on fixes | Lovable "most verification tools run only when you ask"; "every fix breaks something else" | [Lovable testing](https://docs.lovable.dev/features/testing), [forasoft](https://www.forasoft.com/blog/article/lovable-app-bugs-fix-cost) | Worker-run gates; diff-scoped fix tasks with visual baseline |
| Variants sharing the production database; one-way migration traps | Lovable Drafts caveat; Bolt Database → Supabase "no supported way" | [Lovable drafts](https://docs.lovable.dev/features/drafts), [Bolt](https://support.bolt.new/bolt-cloud/database) | Variants on sandbox backend; plain SQL migrations in the user's repo |
| Community stdio MCP servers; DCR-only MCP client | Tool poisoning; reference servers archived; DCR refused by HubSpot, Xero, Zoom, Asana | [Invariant](https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks), [servers repo](https://github.com/modelcontextprotocol/servers) | Vendor-run servers only; CIMD plus pre-registered IDs; pinning (C2) |
| Exposing thousands of raw vendor tools to the model | Accuracy degrades past 30-50 tools | [Tool search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool) | ≤20 non-deferred per role; contracts as the surface (C7) |
| Platform-custodied money; shared ad accounts | Polsia 3% fee, 31-day hold, 20% of ad spend | [Crevio](https://crevio.co/blog/is-polsia-legit) | Non-negotiable 6; provider approval tokens (C3) |
| Builder-first products that make the founder draw workflows; eight live panels as the home screen | Zapier/Make/n8n/Copilot Studio; Polsia terminal theatre | [Make](https://www.make.com/en/ai-agents), Polsia teardown | Founder answers cards; home stays brief plus ≤3 cards |
| Human fallback that only posts to Slack and cannot resume | n8n template | [n8n docs](https://docs.n8n.io/advanced-ai/examples/human-fallback/) | Every K2 blocks, persists and resumes (`tool_deferred` + session store) |
| Cutting the human tier before the AI is proven | Bench shut down with 12,000+ customers | [TechCrunch](https://techcrunch.com/2025/01/03/inside-the-wild-fall-and-last-minute-revival-of-bench-the-vc-backed-accounting-startup-that-imploded-over-the-holidays) | Keep K3 and a human-accountant escalation path |
| Zero-question intake and public posting before validation | Polsia picks a business and posts within ten minutes | [Preuve](https://preuve.ai/blog/polsia-review.md) | Routing card plus validation-first (VAL-1, C8) |
| Unbounded multi-agent fan-out and unbounded session length | Agents of Chaos "uncontrolled resource consumption"; Lovable 10-hour messages | [arXiv 2602.20021](https://arxiv.org/abs/2602.20021), [Lovable changelog](https://docs.lovable.dev/changelog) | Per-run and workflow caps, subagent depth 1, cost meter |

## Open founder decisions

| Decision | Options | Evidence that bears on it | Default until decided |
|---|---|---|---|
| First-build backend: "managed by North" waitlist and mail, or the founder's own Supabase from day one (the 2026-10-16 decision chose the latter) | (a) North-provisioned table and Resend for the first preview, K2 migration card later; (b) keep own-Supabase connection at M9 | Every consumer builder provisions silently; migrations and access widening are the only universal asks ([Lovable cloud](https://docs.lovable.dev/features/cloud), [Base44](https://docs.base44.com/changelog/product)); (a) touches EXP-1 and non-negotiable 6 only if North holds data, which a migration card resolves | (b) as decided; C15 parked |
| Department contract card semantics: does a weekly K2 band approval make the actions inside it K0/K1, changing how non-negotiable 4 and DEC-1 are read? | (a) yes, band-scoped tiers with hard floors; (b) no, every public post and first contact stays its own card | Lindy and Salesforce grant autonomy up front; without (a) the quota caps outreach at 3 contacts a day ([GTMLens](https://gtmlens.com/bp-why-ai-sdrs-fail-three-patterns/)) | (b); B1 blocked |
| Aggregator: Composio self-managed credentials vs Nango self-host/BYOC; EU founders' residency | Composio ~$89/mo at 1K founders; Nango code-in-repo and BYOC; neither has an EU region by default | [Composio](https://composio.dev/pricing), [Nango](https://nango.dev/pricing) | Composio for Wave 2-3; EU founders native/MCP only |
| First three vertical overlays | Suggested `saas_b2b`, `ecom_dtc`, `media_newsletter`; the founder's own M13 idea (GCC Function Health-style app) is closest to `consumer_app` with local-service traits | Starter Story medians; RevenueCat benchmarks ([Starter Story](https://www.starterstory.com/ideas), [RevenueCat](https://www.revenuecat.com/state-of-subscription-apps-2026/)) | `saas_b2b` and `consumer_app` first so M13 benefits |
| Autopilot auto-pick of the critic's top variant, and 2 vs 3 directions | (a) auto-advance top pick; (b) always a review pick | Industry default is exactly 3; no study on non-designer choice quality | 3 directions; review pick for Design (as decided) |
| Autopilot for replies to existing threads and re-engagement of known contacts | (a) graduate follow-ups and known-contact replies to K1 after N clean weeks; (b) every reply a K0 draft the founder sends | Inbound/warm is the highest-conviction agentic use case; cold first touch is not ([SaaStr](https://www.saastr.com/dear-saastr-i-want-to-roll-out-an-ai-sdr-how-do-i-start)) | (b) |
| Positioning line | "Runs your company without spending your money or your name without you" vs Polsia's "runs your company while you sleep" | Polsia's 10%-earned-a-dollar and 3.3/5 reputation ([Crevio](https://crevio.co/blog/is-polsia-legit)) | the former |
| Per-outcome accounting in billing: count or charge only verified outcomes, or keep credits per run | Fin $0.99 per outcome; Sierra "only works where highly attributable" ([Fin](https://fin.ai/pricing), [Sierra](https://sierra.ai/blog/outcomemaxxing)) | Credits per run (BIL-2) with outcome vocabulary shown (B11) |
| Social-to-owned capture (Instagram keyword DM → email) and TikTok/YouTube publishing tiers | Klaviyo K:Social 44% conversion case; platform policy risk | [Klaviyo community](https://community.klaviyo.com/product-updates-and-announcements-51/klaviyo-s-q2-release-composer-public-beta-customer-agent-updates-and-social-marketing-ga-19489) | Read-only until policy review (MKT-3) |
| Hardware and regulated verticals | Refuse politely with a reason in v1 | Not researched; Polsia reviewer advises against regulated categories ([Preuve](https://preuve.ai/blog/polsia-review.md)) | refuse |
| Gmail read scope for voice-from-evidence (B5) given the CASA assessment | (a) consented one-time read of sent mail; (b) founder pastes samples | `gmail.readonly` is restricted (design §6.4) | (b) until CASA |
| Who reviews North playbook candidates and vertical module updates besides the founder | Open in the design (§17) | — | founder |

## Conclusion

The research changes North's competitive story more than its architecture. The market has not
built a one-person company; it has built excellent department tools that all stop at the same
place, a human review surface, and the one product that claims to go further has a 90%
zero-revenue rate and the reputation to match. North's non-negotiables (gate on every external
action, evidence-only done, append-only ledgers, a quota, own accounts, a kill switch) turn out
to be the exact list the oversight literature, OWASP and the vendors' own security guidance
arrived at in 2025-26. What the notes add is that these guarantees are invisible today: they
live in tables and tests, not on the card. Showing the week's cost, the band an action falls in,
the signal that fired, the gate scores and the queue of parked decisions is where North
out-trusts the category, and it costs mostly UI.

Three structural moves carry most of the remaining value. Turning the Chief of Staff into a
ledger-keeping verifier is the only change with controlled evidence behind it; representing
connectors, tiers and playbooks as data is what lets North serve a dropshipper and a dev-tool
founder with the same gate; and treating the three cards as a learned deferral budget rather
than a sorted list is how the quota stays at three as the company grows. The open risk is not
capability but calibration: the founder's early answers train the defaults, so the first
thirty-day run on the founder's own idea (M13) doubles as the dataset M16 needs. Build the
connector platform and the playbook schema before that run, and the verifier and allocator after
it.

