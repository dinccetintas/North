# AI design, brand-identity, website-design and creative-production products: feature teardown for North (as of 2026-10-16)

Scope: product/workflow layer only (intake, generation, variants, critique, export, brand kit as data, pricing, designer opinion).
Skill libraries, 3D runtimes, logo file formats and the critic toolchain are in `docs/research/dept-design-frontend.md` and are not
repeated.

Research limits in this pass: the shared web-search budget ran out after ~40 queries and vidIQ transcript credits after 4 transcripts.
Official pages for Canva, Looka, Mobbin, Lummi, Adobe Express, Midjourney docs, Webflow updates and Higgsfield pricing returned
403/blank, so those facts come from reviews or aggregators and are marked "unverified". No Reddit threads could be retrieved. "What
designers say" rests on four YouTube transcripts (two working designers, one design educator, one web-builder reviewer) plus written
reviews. Higgsfield workflow facts were read directly from its MCP skill bundles (`brand-asset-creation` v1.1, `ads-studio` v1.2) on
2026-10-16; they have no public URL and are cited as "Higgsfield MCP bundle".

## Key question 1: Product teardown (what it does, feature inventory, request-to-outcome flow, export, pricing, agentic vs assistive)

### Takeaway
The market has split into three layers: agentic generators that turn a brief into a whole artifact under a brand/design-system contract
(Claude Design, Figma Make, Framer Agent, Webflow AI Site Builder, Relume, Stitch, Higgsfield Ads Studio, Adobe Firefly skills, Pencil,
AdCreative, Open Design); assistive editors where AI fills a canvas the human drives (Canva, Adobe Express, Uizard, Durable, and the
logo wizards Looka, Brandmark, Tailor Brands, Wix); and utilities with no workflow of their own (Recraft, Midjourney, Ideogram, Lummi,
Mobbin, Spline, Unicorn Studio). Every agentic product converges on four moves: structured intake, a brand/design-system file as
contract, N named variants, anchored comments that produce a new version, and a packaged hand-off to code.

### Cited Findings

Table A. Agentic design and website generators. Prices are list prices seen 2026-10-16.

| Product | Type | What it makes | Export / hand-off | Pricing |
| --- | --- | --- | --- | --- |
| Claude Design (Anthropic Labs, launched 2026-04-17) | A | Prototypes, wireframes/mockups, "design explorations across a range of directions", decks, one-pagers, landing pages, social assets; "Frontier design" prototypes with voice, video, shaders, 3D ([Anthropic](https://www.anthropic.com/news/claude-design-anthropic-labs)) | URL, folder, Canva (editable), PDF, PPTX, standalone HTML; "handoff bundle that you can pass to Claude Code with a single instruction" | Included in Pro/Max/Team/Enterprise, counts against plan limits, "extra usage" purchasable; Enterprise off by default ([Anthropic](https://www.anthropic.com/news/claude-design-anthropic-labs)); plan prices $20 Pro, $100-200 Max per third-party listing, unverified ([aitooltier](https://aitooltier.com/pricing/claude-design)) |
| Figma Make (+ Make Kits, Attachments, Guidelines.md) | A | Code-backed prototypes and web apps inside Figma | Share preview, publish prototype/web app, "copy design to clipboard" into Figma Design (arrives with many auto-layout-excluded layers) ([Vika Taylor](https://www.youtube.com/watch?v=X81GJz2Z8IA)) | Full seats on paid plans; AI credits per prompt scale with model and context ([Figma help](https://help.figma.com/hc/en-us/articles/33665861260823)) |
| Framer AI (Wireframer, Workshop, Framer Agent) | A | Full sites, sections, copy, visuals, CMS collections; hero layout variations | Framer-hosted publish; no code export per a competitor review ([superdesign](https://superdesign.dev/blog/framer-ai-review)) | Starter $29, Professional $49, Enterprise $119 /mo; plans with the agent not stated ([framer.com/ai](https://www.framer.com/ai/)) |
| Webflow AI Site Builder (launched 2026-02-05) | A | Multi-page site on Flowkit (utilities, components, variables), generated copy and images | Standard Webflow project in the Designer | Paid Site plan needed for a custom domain; AI toggle per workspace ([AppsRow](https://www.appsrow.com/blog/webflow-ai-site-builder-in-2026-what-it-actually-builds-and-where-it-falls-short)) |
| Relume | A (staged) | Brief, sitemap, wireframes, style guide, designs; AI agents | Export to Figma, Webflow, React; hosting on relume.live | Build with Relume: Free / Pro from $14/mo ("enough for one full website"); Site Builder: Starter $18, Pro $40, Team $36/user (min 3); custom domain from $12/project/mo ([relume.ai/pricing](https://www.relume.ai/pricing)) |
| Galileo AI, now Google Stitch | A | App/web screens; "Generate Variations" (default 3); DESIGN.md import/export; MCP and skills | Figma/code via MCP | Free in beta per reviews; pricing unsettled ([banani](https://www.banani.co/blog/galileo-ai-features-and-alternatives)) |
| Open Design (nexu-io, Apache-2.0, ~101.6k stars) | A, open source | Claude Design clone: prototypes, dashboards, decks (HTML/PDF/PPTX/ZIP/MD), images (gpt-image-2), motion (HyperFrames) | HTML/CSS hand-off to Cursor, Codex, Claude Code | Free; BYO agent CLI (15 auto-detected) or API key ([GitHub](https://github.com/nexu-io/open-design), [about](https://open-design.ai/about/)) |

Table B. Assistive editors and logo/brand wizards.

| Product | What it makes | Intake | Files / export | Pricing |
| --- | --- | --- | --- | --- |
| Canva Magic Studio / Canva AI 2.0 | Social, docs, decks, video; Magic Design layouts, Magic Write copy, Magic Media images/video; Canva Sheets + Magic Charts; AI 2.0 chat "builds and edits designs from chat prompts" ([skillscouter](https://skillscouter.com/canva-review/)) | Topic, prompt or uploaded image; Brand Kit set up separately | Canva formats, PDF/PNG/MP4 | Free ~50 credits/mo; Pro $15/mo or $120/yr, 500 credits; Business ~$25/user/mo (reviews disagree $10-25); official page 403, unverified ([fast.io](https://fast.io/resources/canva-ai-review-2026/)) |
| Adobe Express | Templates, social, video; brand kits and branded templates on Premium/Firefly Pro; "Extract brand colors, fonts, logos from image in one-click" ([Adobe](https://www.adobe.com/express/pricing/business)) | Template or prompt; brand extraction from an image | Adobe formats | Premium ~$9.99/mo, third-party, unverified |
| Looka | Logo + brand kit: social profiles/posts, business cards, email signatures, letterheads, invoices, brand guidelines (300+ assets), optional AI website | Name, slogan, industry, style and colour preferences, symbols; batch of concepts to browse | Basic $20: 1 PNG; Premium $65: PNG/EPS/SVG/PDF + colour variants, unlimited post-purchase edits | Brand Kit $96/yr; Brand Kit Web $129/yr; top plan cut to $96 on 2026-02-04 ([costbench](https://costbench.com/software/ai-design-tools/looka/), [changelog](https://costbench.com/changelog/looka-price-decrease-2026-02/)); official page unreachable |
| Brandmark | Logo, brand guide, one-page site, social icons, business cards, animated logo, invoices, mockups, presentation templates; "Gen AI + Human inspiration" (hand-crafted fonts/templates + generative icons) ([brandmark.io](https://brandmark.io/)) | Name/slogan/keywords (reviews); unlimited free generation before purchase; unlimited revisions after purchase | SVG, PNG, PDF | Basic $35, Designer $95 (source files, brand guidelines), Enterprise $195 (10 hand-crafted concepts, font download), one-time ([pricing](https://brandmark.io/pricing/)); older reviews list $25/$65/$175 |
| Tailor Brands | Logo + design studio: hundreds of variations, 21 social resizes, brand book, letterheads, seasonal logos, business cards; upsell to website, merch, LLC ([tailorbrands.com](https://www.tailorbrands.com/logo-maker)) | Company name, business type, description; wordmark/monogram/icon; font styles; colours after generation | EPS, SVG (transparent), PNG; low-res free, hi-res paid | Bundled into LLC packages ~$309 year 1, $199/yr after, add-ons pre-checked ([startupowl](https://startupowl.com/reviews/tailor-brands)); "heavily templated ... underwhelming creatively" ([macmyths](https://macmyths.com/tailor-brands-review-2026-logo-design-features/)) |
| Wix Logo Maker (Wixel) | Logo; "brand theme" generated from the logo's colours/fonts/style and applied to other Wixel designs; tagline and name generators | Name, industry, style preferences via an "AI agent" that "researches current trends and your industry, then suggests a personality and style, along with a color palette and font types"; layouts: vertical, horizontal, semi-circular, circular, logotype, icon-only, lettermark ([wix.com](https://www.wix.com/logo/maker)) | SVG, PNG, JPG hi-res; transparent PNG/SVG; downloads free per vendor page (reviews cite $20/$49 packages, conflicting) | Credits for AI generations and AI edits; manual edits free; site plans Light $17, Core $29, Business $36-39 /mo annual, third-party |
| Durable | Small-business site, CRM, booking, AI agents; "AI-generated pages: unlimited" | Business type/name/location (reviews; pricing page lists no intake) | Hosted only | Free (300 credits), Launch $22-25/mo (1,000 credits), Grow $41-49/mo (5,000) ([durable.com/pricing](https://durable.com/pricing)); reviews: "limited customization", no blog/e-commerce ([TechRadar](https://www.techradar.com/pro/software-services/durable)) |
| Uizard (Autodesigner 2.0) | Multi-screen app/web UI from text; screenshot and sketch scanners; AI design reviews, heatmaps, themes | Text prompt; per-section natural-language edits | React/CSS hand-off; jpg/png/pdf | Free 3 gens/mo; Pro $12/mo annual (500 gens); Business $39/mo annual (5,000, "custom brand kit (NEW)") ([uizard.io/pricing](https://uizard.io/pricing/)) |

Table C. Creative production and ad generators (product layer only).

| Product | What it makes | Intake | Variants | Pricing |
| --- | --- | --- | --- | --- |
| Higgsfield Ads Studio | Static Meta-style ads with copy; 1:1, 9:16, 16:9, 3:4 | Paste URL, "Create my brand": five research stages (gather, synthesis, enrichment, products, assets) yield logo, main + extra hex colours, display/body fonts, tone of voice, audience, visual aesthetic, selling points, socials; user reviews/corrects; products from catalog, link or upload ([Higgsfield blog](https://higgsfield.ai/blog/higgsfield-ads-studio)) | Up to 20 per product per run; each ad = one selling angle (offer, ingredient, how-used, lifestyle); new batches by chat; edits/variations only in the web app, not via MCP (Higgsfield MCP bundle) | 4 credits = $0.20 per ad; quote shown before spend; plan page unreadable |
| Higgsfield brand-asset-creation (MCP workflow) | Logos (Recraft V4.1 vector only), palettes, type pairs, brandbook PPTX/PDF, social, posters, packaging, signage, mockups | 4-question gap checklist + role-separated upload boxes + three taste axes (Higgsfield MCP bundle `references/intake.md`) | 2-3 palettes, exactly 3 logos, 2-3 type pairs; each pick persisted via `approve_*` | Credits |
| Pencil | Static + video ad variants (OpenAI, Google Veo, Adobe, Runway, Stability models); predicted Media Performance Score 0-100; Agents (June 2026) ([trypencil.com](https://www.trypencil.com/), [vidmuse](https://vidmuse.ai/blog/pencil-ai-review)) | Node workflow: Asset (product image) + Text brief + reference images | Per workflow run; publish to Meta/TikTok/Google | Core $14/mo (50 gens), Growth $55/mo (250), Pro custom ([superscale](https://superscale.ai/alternatives/pencil/pricing)) |
| AdCreative.ai | Banners, social creatives, ad texts (PAS/AIDA/FAB); video on Professional+ | URL scan (name, logos, colours, fonts) or manual: name, description <=5,000 chars, logo, colours; fonts and alt logos in "Advanced Setup"; no custom font upload ([Semrush KB](https://www.semrush.com/kb/1424-adcreative-ai)) | Unlimited generation, credit only on download; Conversion Score /100 per creative | Trial 100 credits/5 brands, then $109/mo; +$50/mo per 100 credits + 5 brands; reviews list $29-$999 tiers, conflicting ([creatify](https://creatify.ai/review/adcreative-ai)) |
| Adobe Firefly Create Skills | One prompt -> logos, palette, social promo videos; in-skill UIs for Adobe Fonts and colour roles; Elements (reusable characters/objects) and Projects in private beta (2026-06-18) ([9to5mac](https://9to5mac.com/?p=1057353)) | Prompt; Firefly "may ask clarifying questions" | Follow-up prompts | Not stated |

Table D. Utilities, models and reference libraries.

| Product | What it offers | Consistency mechanism | Pricing |
| --- | --- | --- | --- |
| Recraft V4/V4.1 | Raster + native-SVG vector generation, Vector Editor, Styles from reference images, saved palettes | Saved Style + locked palette shared with team; "the real test is whether asset number 200 still belongs next to asset number one" ([Recraft blog](https://recraft.ai/blog/from-logo-to-full-brand-kit)) | Basic/Pro/Teams credits reset monthly; free-plan images public and not licensed commercially ([recraft.ai/pricing](https://www.recraft.ai/pricing)); API vector $0.08/img ([API pricing](https://www.recraft.ai/docs/api-reference/pricing)) |
| Midjourney (V8.2 default since 2026-07-24) | Raster; Edit Model with up to 4 refs on V8.x; `--oref` only on V7; `--sref random` renders 24 styles in Draft Mode | Named personalization profile per project (~40 ratings usable, ~200 stable, ~2,000 max; "include dislikes"), `--sref` + `--sw` 0-1000, style codes on file ([blakecrosley guide](https://www.blakecrosley.com/guides/midjourney)); official docs 403 | Basic $10, Standard $30, Pro $60, Mega $120 /mo |
| Ideogram 3.0 | Raster with strong text rendering; up to 3 style-reference images; style codes; colour palette control; API exposes style refs | "Style Codes: save and reuse exact styles for consistent branding" ([mindstudio](https://www.mindstudio.ai/blog/ideogram)); no named brand kit found | API per image via third-party hosts |
| Lummi | Curated AI-generated stock (13k-20k+ images, counts vary); Figma/Canva/Webflow plugins | n/a | "from $40/mo" per directory, unverified ([theaireport](https://www.theaireport.ai/tooldatabase/lummi), [codrops](https://tympanus.net/codrops/2024/07/04/lummi-say-goodbye-to-boring-stock-photos-forever)) |
| Mobbin | 400k+ real app/web screens and flows; Deep Search; MCP; Figma plugin | Reference only; other companies' IP | Pro $10/mo annual (300 AI credits; MCP added 2026-09-07), Team $16/member/mo (raised from $12 on 2026-07-06), Finance+ $399/mo ([pricingsaas](https://pricingsaas.com/companies/mobbin)) |
| Spline V2 (2026-08-20) / Hana V2 (2026-08-28) | Rebuilt 3D editor on WebGPU; built-in agent builds/edits scenes; MCP server (desktop app only) for Claude Code, Cursor, Codex, Antigravity, VS Code; Hana 2D canvas with agent, GLB/GLTF import, SVG/PDF export ([The New Stack](https://thenewstack.io/spline-v2-mcp-agents/), [createwith](https://www.createwith.com/tool/spline/updates/spline-hana-v2-adds-mcp-agents-webgpu-and-3d-imports)) | n/a | Hobby $15, Pro $30, Max $70 per seat (dept doc) |
| Unicorn Studio | Layer-based WebGL effects canvas (70+ effects), ~29 kB runtime; Unicorn AI shader generation in open beta (10 credits per effect) | n/a | Free (8 publishes, watermark, no commercial use); Legend $20/mo or $168/yr incl. 200 AI credits ([pricing](https://www.unicorn.studio/docs/pricing/), [FAQ](https://www.unicorn.studio/docs/faqs)) |

Request-to-outcome flows (intake -> generation -> variants -> critique -> export), per product:

- Claude Design ([Anthropic](https://www.anthropic.com/news/claude-design-anthropic-labs), [Flux
  Academy](https://www.youtube.com/watch?v=fRAUuluAirM), [Vika Taylor](https://www.youtube.com/watch?v=X81GJz2Z8IA)):
  1. Intake: text prompt; uploads (images, DOCX, PPTX, XLSX); "pointing Claude at your codebase"; web capture of site elements;
     onboarding builds a design system from codebase and design files.
  2. Generation: first version from Opus 4.7 per Anthropic (a June 2026 test says Opus 4.8; unresolved).
  3. Variants: "design explorations across a range of directions"; no documented N-up variant control.
  4. Iteration: chat; inline comments on elements; direct text edit; markup/sketch on canvas; auto-generated "adjustment knobs"
     (sliders for spacing, colour, layout); "apply across the full design"; group chat with edit access.
  5. Export: URL, folder, Canva, PDF, PPTX, HTML; Claude Code handoff bundle. Cost: "after just a few prompts on a real project, you'll
     already have hit your usage limit".
- Figma Make ([help: guidelines](https://help.figma.com/hc/en-us/articles/33665861260823), [help:
  create](https://help.figma.com/hc/en-us/articles/31304485164695), [Make
  Kits](https://www.creativeainews.com/blog/figma-make-kits-attachments-ai-design/)):
  1. Intake: prompt; attach PDF, MD, CSV, JSON, screenshots, SVG, images; pick a design system (Make Kit) in the prompt box;
     `Guidelines.md` auto-created; model switchable (Sonnet 4.6 default, GPT 5.5, Gemini 3.1 Pro in a June 2026 test).
  2. Generation: single app/prototype per chat.
  3. Variants: by asking; model swap gives "three completely different apps".
  4. Iteration: chat; edit tool (select element, change colour/padding/margin/text); annotations anchored to the preview; queued
     prompts can be "reordered, edited, or deleted"; "clear chat context" on drift.
  5. Export: share preview, publish, copy layers to Figma Design.
- Framer Agent ([framer.com/ai](https://www.framer.com/ai/), [hero
  variations](https://www.createwith.com/tool/framer/updates/framer-adds-hero-variations-to-framer-agent)):
  1. Intake: prompt; "@" mentions of styles, pages, CMS collections; references as images, files or URLs (DESIGN.md given as example);
     skills `design-system`, `cms-content`, `remove-ai-writing`; model "GPT, Sonnet, Opus, or Fable".
  2. Variants: hero variations where "headings, supporting text, and existing styles" stay and only layout changes; user compares and
     drops one onto the site (2026-09-03).
  3. Iteration: "Keep refining in the conversation, or take over on the canvas"; branches isolate agent edits; "Start a new
     [conversation] for each task".
- Webflow AI Site Builder
  ([AppsRow](https://www.appsrow.com/blog/webflow-ai-site-builder-in-2026-what-it-actually-builds-and-where-it-falls-short)): "describe
  your business" (audience, offer, tone, pages) -> multi-page draft on Flowkit -> add structure (reorder pages/sections) -> customise 8
  theme categories (colours, buttons, images, typography, GSAP presets); brand is applied after generation, not at intake.
- Relume ([pricing](https://www.relume.ai/pricing)): brief -> sitemap -> wireframes -> style guide -> designs, approved per stage; "AI
  Agents" listed; export Figma/Webflow/React.
- Looka / Brandmark / Tailor / Wix: name + industry + style/colour chips -> batch of logo concepts -> pick -> tweak fonts/icons/colours
  -> pay to download -> templates pre-filled with the chosen logo ([Tailor](https://www.tailorbrands.com/logo-maker),
  [Wix](https://www.wix.com/logo/maker), [Brandmark](https://brandmark.io/)).
- Higgsfield Ads Studio ([blog](https://higgsfield.ai/blog/higgsfield-ads-studio), MCP bundle): URL -> brand research card (5 stages,
  ~90 s) -> review/correct kit -> add products (page, photo + text, or prompt) -> quote in credits -> explicit yes -> run -> concepts
  with headline, primary text, CTA, picture -> export selected.
- Open Design ([GitHub](https://github.com/nexu-io/open-design)): brief -> discovery question form -> direction picker (5 curated
  directions, or screenshot/URL codified into DESIGN.md) -> live todo card for mid-task redirects -> preview -> tweaks panel /
  follow-ups -> save/download; "comment mode" surgical edits "partially shipped".

Designer verdicts (transcripts and reviews):
- Flux Academy (2026-05-11): Claude Design is strong at "design exploration ... whether a hero section works better centered or split"
  and "context-driven design" (attach design system, style guide, codebase, Figma file; onboarding extracts "colors, typography, and
  component structure"); "if you go in with a vague prompt and no context attached, the output looks like AI made it"; "the fix is
  context"; "it's not Figma. You don't have a fully interactive visual canvas" — [YouTube](https://www.youtube.com/watch?v=fRAUuluAirM)
- Vika Taylor (2026-06-03), same prompt in both: Claude Design "wins pure design + polish"; Figma Make "wins UX, white space, and
  visual hierarchy" and "lives right next to my design system" — [YouTube](https://www.youtube.com/watch?v=X81GJz2Z8IA)
- Build Great Products (2026-07-14) tier list: S = Paper.design and MagicPath (design on a canvas with your own coding agent using code
  tokens; MagicPath BYO-agent tier $10/mo); A = Stitch, Pencil.dev, Framer; B = Figma, Open Design; C = Claude Design ("building its
  own design system format ... not standardized"; "you can't design directly in Claude Design from Claude Code"); D = v0 —
  [YouTube](https://www.youtube.com/watch?v=6OpWU-HrsuQ)
- Steve Builds Websites (2025-11-28), one site in 20 tools: most picked the same "Elevate your game" headline; "AI tools are generating
  what feel like personalized website templates"; prompt edits took 30-60 s and sometimes broke the page; generated contact forms sent
  nothing; "No single tool I tried had it all" — [YouTube](https://www.youtube.com/watch?v=wbyPMZ6Y6Qw)
- AppsRow on Webflow AI (June 2026): "It builds a starting point, not a finished website"; "The copy is generic by nature"; "Conversion
  design is not included"; similar prompts "produce sites that look alike" —
  [AppsRow](https://www.appsrow.com/blog/webflow-ai-site-builder-in-2026-what-it-actually-builds-and-where-it-falls-short)
- Canva reviewers: Magic Design "leans heavily on Canva's most popular templates"; Dream Lab "can produce a great image on one prompt
  and a mediocre one on the next"; "no way to select or prefer a specific underlying model" —
  [fast.io](https://fast.io/resources/canva-ai-review-2026/)

### Inferences
- Agentic: Claude Design, Figma Make, Framer Agent, Webflow AI, Relume, Stitch, Higgsfield (both), Pencil, AdCreative, Adobe Firefly
  skills, Open Design. Assistive: Canva, Adobe Express, Uizard, Durable, Looka, Brandmark, Tailor, Wix. Utilities North calls rather
  than competes with: Recraft, Midjourney, Ideogram, Lummi, Mobbin, Spline, Unicorn.
- Logo wizards sell files and templates, not judgement: intake is name + industry + style chips, consistency is template re-skinning.
  North's brand kit must win on real vector files plus a machine-readable kit, not template count.
- The two review mechanics designers praise most are agent-invented sliders (Claude Design, Open Design) and comments anchored to a
  preview element that become the next prompt (Claude Design, Figma Make, Lovable, v0). Both keep a non-designer out of a design tool.
- Model or prompt variation inside one tool yields visibly different directions; North can get cheap diversity by varying taste dials
  and prompt scaffolds per direction.
- Credit exhaustion is the top Claude Design complaint; North's per-task budget and refine-or-pivot stop rule are a differentiator if
  shown in the UI.

### Gaps
- Several vendor pages were unreachable (403/blank); their prices may be stale.
- Claude Design's model is "Opus 4.7" on Anthropic's page but "Opus 4.8" in a June 2026 test.
- Pencil's brand setup and approval flow, Ideogram's brand kit and Canva's AI 2.0 mechanics were not documented in retrieved sources;
  no Reddit evidence.

## Key question 2: How the best products represent a brand kit as data, and what the brand questionnaire looks like

### Takeaway
Three data formats dominate: a Markdown contract read by agents (Stitch/VoltAgent `DESIGN.md` with nine sections, Figma
`Guidelines.md`, Framer DESIGN.md references, Open Design packages adding `manifest.json` and `tokens.css`); a UI brand record (Canva,
Adobe, GoDaddy, Klaviyo, Bloom: logos, colours, fonts, voice); and a prompt-level lock (Higgsfield "Brand Lock" JSON repeated verbatim
in every generation, Recraft saved Style + palette, Midjourney profile + `--sref`). Questionnaires have shrunk to 4-15 questions; the
best tools extract most answers from a URL or codebase and ask only for gaps.

### Cited Findings

Table E. Brand kit as data: format comparison.

| Tool | Container | Fields | Who consumes it |
| --- | --- | --- | --- |
| Google Stitch / VoltAgent DESIGN.md | Markdown, "no Figma exports, JSON schemas, or special tooling" | 1 Visual Theme & Atmosphere; 2 Color Palette & Roles (semantic name, hex, role); 3 Typography Rules (families + hierarchy table); 4 Component Stylings (buttons, cards, inputs, nav, states); 5 Layout Principles (spacing scale, grid); 6 Depth & Elevation; 7 Do's and Don'ts; 8 Responsive Behavior (breakpoints, touch targets); 9 Agent Prompt Guide | Coding agents (copy into project root), Stitch ([VoltAgent](https://github.com/VoltAgent/awesome-design-md)) |
| Open Design | DESIGN.md package: + `manifest.json`, `tokens.css`, components, assets, provenance | "Each render reads the active design-system package's DESIGN.md as its core brand contract"; brand codified from a screenshot or URL | Open Design renders; 72-129 bundled systems ([GitHub](https://github.com/nexu-io/open-design)) |
| Figma Make | `Guidelines.md` per file + Make Kits + Attachments | "general rules" and "design system rules, including component sections with usage and variants"; generated from npm packages ("components, styles, tokens, and general rules"); Kits link components to npm so the design system is "the instruction set for AI generation"; warning: "more context isn't always better. It can confuse the LLM" | Figma Make ([help](https://help.figma.com/hc/en-us/articles/33665861260823), [creativeainews](https://www.creativeainews.com/blog/figma-make-kits-attachments-ai-design/)); org-wide central guidelines still a user request ([forum](https://forum.figma.com/suggest-a-feature-11/figma-make-centralized-context-guidelines-for-organization-51450)) |
| Claude Design | Proprietary design system per team, built from codebase/design files; dedicated UI "to store, review, and make changes" | "projects automatically use your colors, typography, and components"; more than one system allowed | Claude Design only; criticised as "not standardized" ([Anthropic](https://www.anthropic.com/news/claude-design-anthropic-labs), [Flux Academy](https://www.youtube.com/watch?v=fRAUuluAirM), [BGP](https://www.youtube.com/watch?v=6OpWU-HrsuQ)) |
| Higgsfield Brand Lock | JSON, each field with lock state `fixed / proposed / not_applicable / unknown` and evidence label `source-declared / measured / visually-observed / inferred` | `brand_context{name, offering, industry, positioning, audience, tone[]}`; `concept{name, visual_premise, research_principles, reference_preferences, avoid[]}`; `visual_axes{restrained_expressive, geometric_organic, familiar_experimental}` 0-100; `authoritative_assets.logo{origin, variants{color, black, white}, status}`, `fonts`, `references`; `palette{primary, accent, neutral, semantic_roles, forbidden}`; `typography{display, body, fallbacks, font_links, specimen_svg}`; `layout{grid, margins, spacing_scale, alignment, density}`; `shape_language{corner_radii, borders, shadows, forms}`; `graphic_devices`; `composition{hierarchy, logo_placement, image_behavior, text_behavior}`; `applications{}` per-format overrides; `unknowns[]`; minimum before generation includes "at least two concrete avoid rules" | Every image prompt carries a `[BRAND LOCK — DO NOT DEVIATE]` block "repeated verbatim across related assets" (Higgsfield MCP bundle `references/brand-lock.md`) |
| Higgsfield Ads Studio brand | Research card from URL | logo, main + extra hex colours, display/body fonts, tone of voice, target audience, visual aesthetic, description, selling points, social profiles; user "review[s] and can correct or expand" | Ads Studio runs; `brand_kit: false` drops it ([blog](https://higgsfield.ai/blog/higgsfield-ads-studio)) |
| AdCreative.ai | Brand record | URL scan: name, logos, colours, fonts; manual: name, description <=5,000 chars, logo, colours; "Light-colored logos aren't recommended"; no custom font upload | AdCreative generations ([Semrush KB](https://www.semrush.com/kb/1424-adcreative-ai)) |
| Recraft | Saved Style + palette | Style blended from logo + reference images; palette "from your exact hex codes or extract one from the logo"; "if results drift, adjust the reference weighting"; shareable with team | Recraft generations ([blog](https://recraft.ai/blog/from-logo-to-full-brand-kit)) |
| Midjourney | Personalization profile + `--sref` codes | Named profile per project; "include dislikes"; style codes on file | Midjourney ([blakecrosley](https://www.blakecrosley.com/guides/midjourney)) |
| Canva Brand Kit | UI record | Colours, fonts, logos, brand voice ("Magic Write follows brand voice guidelines if you set them up in Brand Kit"); 5 kits on Pro; Business "AI-enforced brand guidelines", approvals | Magic Write, templates ([fast.io](https://fast.io/resources/canva-ai-review-2026/), [skillscouter](https://skillscouter.com/canva-review/)) |
| Wix / Adobe Express | UI record derived from an image | Wix: "brand theme ... generated from your logo's colors, fonts, and visual style"; Adobe: "Extract brand colors, fonts, logos from image in one-click" | Wixel designs; Express templates ([Wix](https://www.wix.com/logo/maker), [Adobe](https://www.adobe.com/express/pricing/business)) |

Brand-kit UI patterns observed on Mobbin (web):
- GoDaddy brand kit modal: Logos / Colors / Fonts (Heading, Subheading, Paragraph) as "+" slots; curated palette picker with named
  moods (Corporate, Modern, Classic, Street, Organic, Minimal, Bold, Playful, Elegant, Luxury, Sporty, Retro, Boho) — [Mobbin
  GoDaddy](https://mobbin.com/flows/53bf6804-b0a1-4f29-9f70-92f9d6adad0d)
- Bloom (AI creative tool) onboarding: "Does the logo look accurate? Upload Another / Looks Good"; "What do you want to create? Pick
  your top 3"; "Which ads inspire you? Pick 3"; then a first batch of images with locked extras; Brand page = Identity (logo,
  description, tagline) + Design Language (colours, fonts with fallback, tone chips such as Technical / Minimalist / Clean, aesthetic
  paragraph) — [Mobbin Bloom](https://mobbin.com/flows/b6097b62-f994-4928-9780-ef30fd006872), [Bloom
  brand](https://mobbin.com/flows/ffbc50b7-dbf3-433c-a294-55e03799a693)
- Klaviyo onboarding checklist step: "Build your brand library: confirm your logo, brand colors, and creative assets to apply to emails
  and templates automatically" — [Mobbin Klaviyo](https://mobbin.com/flows/b7b2c5a6-1a8f-46eb-bdd9-df23c3aae492)
- Vimeo team setup: name, logo, one accent hex — [Mobbin Vimeo](https://mobbin.com/flows/5dd17a41-e86c-4436-9297-35217a32ff0e)

Brand questionnaires:
- Higgsfield (MCP bundle `references/intake.md`): "a gap checklist, not a mandatory questionnaire"; at most four questions: name; "What
  does the brand or product offer, who is it for, and what are its key values or positioning?"; new identity vs existing assets;
  preferences plus optional scales "Restrained ↔ Expressive, Geometric ↔ Organic, Familiar ↔ Experimental" normalised 0-100 (strongly
  first = 0, balanced = 50); separate upload boxes for official logos (SVG preferred), fonts (TTF/OTF/WOFF/WOFF2), palette/guidelines
  (PDF/PPTX/CSS/JSON/SVG), other official material, and inspiration ("visually useful but never authoritative"); official elements are
  locked immediately via `lock_authoritative_logo/palette/typography`.
- HolaBrief agency template, 15 questions: ideal customer; pain points solved; personality; closest competitors; how clients should
  feel; what makes you different; why clients trust you; your story; five words; what is wrong with the existing identity; brands you
  admire; how to streamline; what the logo should communicate; a particular font; colours you like —
  [HolaBrief](https://holabrief.com/questionnaire/branding-template)
- Tailor Brands: name, business type, description, logo type (wordmark/monogram/icon), font styles; colours after generation —
  [Tailor](https://www.tailorbrands.com/logo-maker)
- Wix: name, industry, style preferences; agent then "suggests a personality and style, along with a color palette and font types" —
  [Wix](https://www.wix.com/logo/maker)
- Looka: name, slogan, industry, style and colour preferences, symbols —
  [costbench](https://costbench.com/software/ai-design-tools/looka/)
- Open Design: "discovery question form" then direction picker — [GitHub](https://github.com/nexu-io/open-design)

### Inferences
- North's `BrandKit` should be structured data (Zod) rendered to both a DESIGN.md (nine Stitch sections) and `tokens.json`, so it is
  the UI record and the agent contract at once; Higgsfield's lock states and evidence labels are the best model for "founder-approved
  vs agent-proposed".
- Intake should be gap-driven: pre-fill from company memory, ask at most 4-6 questions, add three taste dials, separate official assets
  from inspiration, and confirm the logo visually before anything else.
- "Avoid" rules and forbidden colours belong in the kit; they are what stops drift in later ad and social outputs.
- A per-format `applications` block (carousel vs poster vs OG image) keeps the kit neither too rigid nor ignored.

### Gaps
- Canva's and Adobe's exact brand-kit schemas (voice fields, do/don't) sit behind 403 pages; Pencil's brand setup is undocumented in
  retrieved sources.
- No source quantifies how much a DESIGN.md reduces off-brand output; evidence is anecdotal.

## Key question 3: Best-practice iterative workflow (drafts -> critique -> variants -> revision) and how critique is encoded

### Takeaway
The agency pattern (brief -> 2-3 concepts -> pick -> rounds of anchored feedback) is now encoded in products as staged approvals with
exactly three candidates per stage, one approval per slot, and dependency invalidation when an upstream slot changes. Critique is
encoded three ways: NN/g's goal-anchored conversational rules; A List Apart's observation-impact-request template with severity
markers; and tool rubrics (Impeccable: Nielsen 0-4, P0-P3, a "design specificity" verdict, persona red flags; Refactoring UI's concrete
rules; a growing "AI-slop" tell list).

### Cited Findings
- NN/g: a critique "analyzes a design and gives feedback on whether it meets its objectives"; roles presenter, critiquer, facilitator,
  recorder; needs "clear scope" and "shared objectives"; "conversation over command"; the facilitator reframes directives into
  questions ("How does this layout make it easier for the user to accomplish their task?"); round robin or quotas of positive and
  negative comments; pitfalls: no agreed personas/objectives, rushing to solve, discussing only negatives —
  [NN/g](https://www.nngroup.com/articles/design-critiques/)
- A List Apart async critique: each comment = Observation (from a named perspective) + Impact + Question/request; markers Blocking /
  Should change / Positive / Question; "one comment per topic so each discussion maps to a single task"; anchor with screenshots; keep
  resolved discussions visible; template "[Marker] Area — Context. Observation from [perspective]. Impact. Question or request?" — [A
  List Apart](https://alistapart.com/article/async-design-critique-giving-feedback/)
- Impeccable `critique`: two isolated assessments (A: design specificity first, then hierarchy, IA, emotional fit, typography, colour,
  accessibility, states, copy, cognitive load, Nielsen heuristics, persona red flags; B: deterministic detector on markup or live
  page), then synthesis; Nielsen's 10 heuristics scored 0-4 (36-40 Excellent, 28-35 Good, 20-27 Acceptable, 12-19 Poor, 0-11 Critical);
  8-item cognitive-load checklist; working-memory rule (<=4 options good, >=8 overloaded); P0-P3 severity with tie-breaker "would a
  user contact support?"; "Design Specificity verdict ... whether the interface could be used unchanged by an unrelated product";
  output = score table, what's working (2-3), priority issues (3-5 with severity/what/why/fix), persona red flags, questions; "Inline
  execution is degraded and must be labeled" — [impeccable
  critique.md](https://github.com/pbakaus/impeccable/blob/main/skill/reference/critique.md)
- Refactoring UI rules usable as a checklist: "size alone doesn't create hierarchy"; "avoid grey text on colored backgrounds"; "start
  with generous whitespace, then tighten"; "define a spacing and sizing system"; "set a type scale"; "keep line length in check";
  "align text by baseline"; "use HSL"; "define shades up front"; "greys can carry a hue"; "emulate a consistent light source"; "shadows
  work better in two parts"; "customize framework defaults"; "use fewer borders"; "Design with tactics, not talent"; $99-$149 —
  [refactoringui.com](https://www.refactoringui.com/)
- AI-slop tells (noqta, 2026-06-04): oversized border radius everywhere; random purple-to-blue glow gradients; excessive letter spacing
  on uppercase labels; fake "Live/New" badges; thick one-side coloured card border; fixes: design tokens instead of adjectives, a
  Markdown design-system doc as context, distinctive display + clean body font, real screenshots and data, specific copy —
  [noqta](https://noqta.tn/en/blog/ai-design-slop-overused-ui-patterns-fix-2026)
- Growth.Design critiques are organised by psychology principle (Labor Perception Bias, Zeigarnik Effect, Framing Effect, Social Proof,
  Mental Models, Scarcity, JTBD) and by Onboarding / Retention / Revenue / Referral —
  [Growth.Design](https://growth.design/case-studies)
- Staged approval as product rules (Higgsfield MCP bundle `concept-boards.md`, `qa-and-iteration.md`):
  - Palette: 2-3 options, each with named hex colours, background/text colours, one-sentence rationale, usage examples and 2-3 logo
    mechanism seeds; "Reply with the option you prefer and any colors you want changed, added, or removed."
  - Logo: "exactly three original logo mechanisms", generated with identical model, palette, background, aspect and quality parameters;
    shown as three SVGs.
  - Typography: 2-3 pairs shown next to the chosen mark "so type/mark cohesion is visible".
  - Rules: "Never infer approval from silence or tool success"; "Assume the first pass contains inconsistencies"; set-level matrix
    `Asset | Logo | Palette | Type | Grid/spacing | Shape/device | Format | Status`; "Do not accept a vision model's statement as proof
    of exact hex, font, spacing, or radius"; repair = "name the failed Brand Lock rule ... regenerate only the failing asset"; when
    palette or typography changes, "discard the prior approved logo and run the three-candidate logo approval step again".
  - Reject list for mockups: "generic marble/pedestal luxury scenes, arbitrary gradients, plastic sheen, excessive bloom, floating
    objects, meaningless props, and fake copy".
  - Delivery: stable names so the user can say "revise carousel card 3"; a manifest with Brand Lock version, editable files, preview
    files, required fonts, known limitations, variant names.
- Product loops: Claude Design "builds the first version, and then you refine through conversation, inline comments, direct edits, or
  custom sliders" ([Flux Academy](https://www.youtube.com/watch?v=fRAUuluAirM)); Figma Make queues reorderable prompts and offers
  "clear chat context" on drift ([Figma help](https://help.figma.com/hc/en-us/articles/31304485164695)); Framer uses branches and one
  conversation per task ([framer.com/ai](https://www.framer.com/ai/)); Open Design shows a live todo card "for mid-task redirects"
  ([GitHub](https://github.com/nexu-io/open-design)).
- Variant counts: Stitch default 3; Kombai 1-3 plus passes (dept doc); Framer hero "several"; Higgsfield logos exactly 3, palettes and
  type 2-3; Canva Magic Media 4 per prompt ([fast.io](https://fast.io/resources/canva-ai-review-2026/)).

### Inferences
- North's critic should combine the three encodings: deterministic gates (dept doc) + a Nielsen / Refactoring UI / slop-tell rubric
  scored with evidence crops + a "design specificity" yes/no that fails anything an unrelated product could use unchanged; calibrate
  scores with few-shot examples per the Anthropic harness post.
- Critique output should use the A List Apart shape (marker, area, observation, impact, request), one finding per comment, because
  findings then map one-to-one to `revise_artifact` work items.
- Staged approvals with dependency invalidation (palette change -> logo candidates regenerate; logo change -> brandbook pages
  invalidated) should be data on `BrandKit` slots, not prompt text.
- Keep "exactly 3" as the default candidate count per stage; it is the industry norm and matches the founder's pick-among-variants UX.

### Gaps
- NN/g's paid critique cheat-sheet and Growth.Design's full scoring are not public; open-source design-critiquer skills found exclude
  brand strategy.
- No controlled study compares 2 vs 3 vs 5 variants for non-designer decision quality.

## Key question 4: How products expose design to non-designers for review (side-by-side, annotated comments, version history, "pick one")

### Takeaway
Non-designer review in 2026 means a clickable preview, a small set of named options to pick from, comments pinned to a spot that become
the next version, sliders for taste without a design tool, and a quote before spend. Version branching is still weak everywhere except
Framer branches and v0's apply/diff/revert.

### Cited Findings
- Claude Design: inline comments on elements, direct text editing, sketch annotations, auto-generated knobs; "a surprisingly hands-on
  loop for a tool that starts from a text prompt" ([Flux Academy](https://www.youtube.com/watch?v=fRAUuluAirM)); "edit mode" and
  "markup mode" ([Vika Taylor](https://www.youtube.com/watch?v=X81GJz2Z8IA)); org-scoped sharing: private, view-by-link, edit
  ([Anthropic](https://www.anthropic.com/news/claude-design-anthropic-labs)).
- Figma Make: select element + properties panel; annotations on the preview; share preview; publish prototype; copy to Figma canvas
  asks "does it look good?" ([Figma help](https://help.figma.com/hc/en-us/articles/31304485164695), [Vika
  Taylor](https://www.youtube.com/watch?v=X81GJz2Z8IA)); branching still a user request (dept doc).
- Framer: hero variations, "compare the alternatives, and drop your preferred one onto the site"; branches isolate agent edits
  ([createwith](https://www.createwith.com/tool/framer/updates/framer-adds-hero-variations-to-framer-agent),
  [framer.com/ai](https://www.framer.com/ai/)).
- Higgsfield: palette and type options rendered as editable HTML boards, shown inline as PNG with an HTML download; the pick is a plain
  chat reply ("Do not use a structured question tool or a multiple-choice list"); logo review shows three SVGs with direct links;
  brandbook delivered as "two file links plus the font-install warning only"; Ads Studio shows credits first and "Generation starts
  only on an explicit yes to that price" (MCP bundle); research progress card shows five stages
  ([blog](https://higgsfield.ai/blog/higgsfield-ads-studio)).
- Bloom onboarding: confirm logo, pick 3 asset types, pick 3 inspiring ads, first-batch modal with 5 locked thumbnails and "Download /
  Continue to workspace" — [Mobbin Bloom](https://mobbin.com/flows/b6097b62-f994-4928-9780-ef30fd006872)
- Open Design: direction picker with 5 curated directions; live todo card; tweaks panel re-renders the iframe "without a reload" —
  [GitHub](https://github.com/nexu-io/open-design)
- Steve Builds Websites: editing by prompt "is a terrible way of editing websites. Turns out drag and drop is just faster"; "all these
  AI tools charge you based on how many prompts you write ... even when the prompts break your website" —
  [YouTube](https://www.youtube.com/watch?v=wbyPMZ6Y6Qw)
- Scores for ranking: AdCreative Conversion Score /100; Pencil Media Performance Score 0-100; Uizard "design reviews" feature with
  per-plan limits ([Semrush KB](https://www.semrush.com/kb/1424-adcreative-ai), [vidmuse](https://vidmuse.ai/blog/pencil-ai-review),
  [uizard.io/pricing](https://uizard.io/pricing/)).
- Lovable select/draw/comment modes and v0's pending edits -> Apply -> new version with diff/revert are documented in the dept doc.

### Inferences
- For a founder who "only answers decision cards", the review surface should be: named directions side by side at 390/1440 with
  one-click pick; pinned comments with severity chips batched into one revision; knobs for the 3-4 taste parameters the agent exposes
  per artifact; a cost quote on every regenerate; a version list with diff and revert. Drafts live in a review queue, outside the
  decision-card quota.
- Trivial edits (swap an image, change a word) must not round-trip through the agent; expose text and image slots as editable fields on
  the artifact.
- Score chips (critic score, on-brand score) next to each variant help a non-designer pick; Autopilot may pick the top score only if
  the founder opts in.

### Gaps
- No usability study of non-designers choosing among AI variants was found; evidence is product behaviour and reviewer opinion.
- Figma Make comment threads and version-restore details were not in the retrieved help pages.

## Key question 5: Which features North should adopt (ranked) and which patterns to avoid

### Takeaway
Adopt the contract-first, staged, three-candidate, comment-to-version loop with a machine-readable brand kit and a hard critic; avoid
prompt-only editing, template re-skinning, unquoted spend, generous self-grading and proprietary kit formats.

### Cited Findings
- All evidence is cited in key questions 1-4; this section ranks it.

### Inferences
Ranked features North should adopt:
1. Brand kit as data with lock states: Zod `BrandKit` JSON using Higgsfield Brand Lock fields plus the nine Stitch DESIGN.md sections;
   per-field `fixed/proposed/unknown` and evidence labels; at least two avoid rules; per-format `applications`; rendered to DESIGN.md +
   `tokens.json` for every later persona (Open Design, Stitch and Framer all consume DESIGN.md).
2. Gap-driven intake: pre-fill from company memory; at most six questions; three taste dials (Restrained-Expressive, Geometric-Organic,
   Familiar-Experimental); separate official-asset and inspiration uploads; a "confirm your logo" step (Bloom, Klaviyo); URL extraction
   when a site exists (Higgsfield, AdCreative).
3. Staged approvals with exactly three candidates per slot (palette -> logo -> type -> directions); each pick persisted as an approval;
   dependency invalidation on change; candidates generated with identical parameters so the pick is about design, not noise.
4. Comment-to-version loop: comments anchored to a screenshot point or DOM selector in the A List Apart shape (marker, observation,
   impact, request), batched into one `revise_artifact`, producing version N+1 with visual diff and revert (v0, Lovable, Claude Design,
   Figma Make).
5. Agent-generated knobs: 3-4 sliders per artifact (spacing, accent, density, hero layout) that re-render without a new agent run
   (Claude Design, Open Design), plus direct edit of text and image slots so trivial changes never cost a prompt.
6. Critic with a "design specificity" fail: deterministic gates + Nielsen 0-4 + Refactoring UI rules + slop-tell list + "could an
   unrelated product use this unchanged?" (Impeccable); findings as P0-P3 with evidence crops; few-shot calibration.
7. Quote before spend and visible budget: estimated cost per regenerate or batch, explicit yes above a threshold (Higgsfield Ads
   Studio); remaining task budget shown to counter the "burns tokens" complaint about Claude Design.
8. Hand-off bundle: every direction ships as DESIGN.md + tokens + HTML + screenshots so the Frontend Engineer persona, or the founder's
   own Claude Code or Figma, can take it "with a single instruction"; Figma write-to-canvas and Canva export as optional connections.
9. Multi-angle creative batches: ads and social generated per selling angle (offer, ingredient, how-used, lifestyle) with the kit on,
   10-20 per run, each with a critic/on-brand score, in 1:1, 9:16, 16:9 and 3:4 (Higgsfield, AdCreative, Pencil).
10. Diversity per direction: vary taste dials and prompt scaffolds (optionally model) across the three directions, because identical
    prompts converge on the same layout and headline (Steve Builds Websites; Vika Taylor's model-swap test).
11. Reference libraries as optional connections: Mobbin MCP (Pro $10/mo) and Lummi for inspiration only, never as templates; Recraft
    Styles for illustration consistency; Midjourney profiles only on the founder's own account.
12. Reviewer-friendly delivery: stable variant names ("direction-b-v2"), two-link deliveries for files, font-install warnings, and no
    "beautiful" or "done" claims before QA (Higgsfield delivery contract).

Patterns to avoid:
- Prompt-only editing for small changes: 30-60 s per edit, breaks pages, costs credits ([Steve Builds
  Websites](https://www.youtube.com/watch?v=wbyPMZ6Y6Qw)).
- Template re-skinning sold as identity: Looka, Tailor and Wix are "heavily templated"; Magic Design "converges on popular layouts";
  North's directions must differ structurally, not one template in three colours.
- Generating with no context: "the output looks like AI made it" ([Flux Academy](https://www.youtube.com/watch?v=fRAUuluAirM)); never
  run a direction without a locked kit.
- A proprietary kit format with one-way hand-off ("not standardized"; "can't design directly ... from Claude Code" —
  [BGP](https://www.youtube.com/watch?v=6OpWU-HrsuQ)); use DESIGN.md and tokens so other tools can read it.
- Treating tool success, recency or the model's own opinion as approval; inferring approval from silence; accepting a vision model's
  claim about exact hex, font or radius without a deterministic check (Higgsfield rules).
- Unquoted or opaque credit burn (Claude Design limits; Lovable credits charged for broken edits).
- Fake success states such as contact forms that send nowhere ([Steve Builds Websites](https://www.youtube.com/watch?v=wbyPMZ6Y6Qw));
  North's evidence rule already forbids this.
- AI-slop visual defaults: uniform large radii, purple-blue glow gradients, tracked uppercase labels, fake badges, marble-pedestal
  mockups, Inter everywhere ([noqta](https://noqta.tn/en/blog/ai-design-slop-overused-ui-patterns-fix-2026); Higgsfield QA list).
- Over-long guideline context: Figma warns it "can confuse the LLM"; keep DESIGN.md compact and copy only the relevant lock block into
  prompts.
- Spending the founder's 3/day decision quota on design drafts; drafts belong in a separate review queue (North rule).
- Promising native Figma, Canva, PSD, AI or EPS files the pipeline cannot produce faithfully; promise SVG, PNG, PDF, HTML, PPTX with
  import caveats (Higgsfield editable-output policy).

### Gaps
- A precise price benchmark of a North "design seat" against these tools is not possible because several vendor pages were unreachable;
  the dept doc's $5.70-7.20 per full cycle remains the reference.
- Whether founders prefer two or three directions, and whether Autopilot may auto-pick, remain open questions for the founder (dept
  doc, section 5).


