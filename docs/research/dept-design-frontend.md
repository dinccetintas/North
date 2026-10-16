# Design + Frontend department: research (2026-10-16)

Scope: what North needs so the first department it builds (Design + Frontend) produces
world-class brand identity, 2-3 website directions, the live landing page + waitlist, and
3D/animated experiences, all checked by a critic and inside a dev/test budget under
$100/month. Repos were verified on 2026-10-16 by shallow `git clone` (existence, LICENSE
file, date of the last commit on the default branch); "last commit" below means that date.

## Summary

- Anthropic's `frontend-design` skill is the base layer. The same `SKILL.md` ships in three
  repos; vendor it from `anthropics/skills` (Apache-2.0 per skill), not `anthropics/claude-code`,
  whose repo licence is "All rights reserved" ([skills](https://github.com/anthropics/skills/tree/main/skills/frontend-design), [claude-code](https://github.com/anthropics/claude-code/blob/main/LICENSE.md)).
- "Impeccable" is `pbakaus/impeccable` (Apache-2.0, v4.6.0, last commit 2026-10-16): 1 skill,
  24 commands, 59 deterministic anti-pattern detector rules. Its launcher downloads a binary
  on first run, so North must pre-vendor it or take only the markdown ([README](https://github.com/pbakaus/impeccable)).
- Better than the named set: `emilkowalski/skills` (motion), `ibelick/ui-skills`
  (baseline/a11y/metadata fixers), `Leonxlnx/taste-skill` (style dials, brandkit),
  `nextlevelbuilder/ui-ux-pro-max-skill` (font/palette/landing CSV data),
  `vercel-labs/agent-skills` + `web-interface-guidelines`, `OneRedOak/claude-code-workflows`
  (design-review agent). All MIT or Apache-2.0 and active.
- Anthropic's own evidence for a critic: a separate, skeptical evaluator using Playwright
  and scoring design quality, originality, craft, functionality beats self-critique; LLM
  evaluators "tend to be generous", so calibrate with few-shot scored examples ([harness post](https://www.anthropic.com/engineering/harness-design-long-running-apps)).
- Real logo files: Recraft V4.1 has native vector models ($0.08 vector, $0.035 raster,
  $0.01 vectorize per call via API) and is also inside Higgsfield's catalogue as
  `recraft_v4_1` with `model_type: vector` ([Recraft pricing](https://www.recraft.ai/docs/api-reference/pricing)).
- Higgsfield's pay-as-you-go API (separate from its MCP plan credits) lists image models from
  $0.0032/image; outputs are kept "a minimum of 7 days", so North must copy them to Storage at
  once ([Higgsfield API](https://higgsfield.ai/blog/higgsfield-api)).
- Motion stack: Three.js (MIT, r186), React Three Fiber and drei (MIT), Motion (MIT core).
  GSAP is free but under Webflow's proprietary "no charge" licence; its FAQ says AI-generated
  code is not a prohibited use, but North should default to Motion ([GSAP licence](https://gsap.com/community/standard-license/)).
- Visual QA toolchain is free and open: Playwright MCP and chrome-devtools-mcp (Apache-2.0,
  `lighthouse_audit`, traces), axe-core (MPL-2.0), Lighthouse 13.5 (Apache-2.0). Screenshots
  are cheap: a 1440x900 image is about 1.7k visual tokens ([vision docs](https://platform.claude.com/docs/en/build-with-claude/vision)).
- Variant UX to copy: Stitch/Kombai-style "3 variants by default", v0's "pending edits ->
  Apply -> new version with diff/revert", Lovable's select/annotate/comment modes that attach
  screenshots to the next prompt ([v0](https://v0.app/docs/design-mode), [Lovable](https://docs.lovable.dev/features/preview-toolbar)).
- Budget: one full cycle (brand kit, 3 directions, build, 2 critique rounds) estimates at
  $5-7 at current Opus/Sonnet 5.5 prices, so under $100/month allows ~10 full live cycles plus
  cheap per-change runs if directions are drafted on Sonnet and only the chosen one is built on Opus.

## 1. Where North is today

- `agents/design.yaml`: one prompt, K0, `drafter` model, $2 budget, outputs markdown; the
  `brand_kit` guide says "Logo direction and imagery guidance (described, no binary assets)".
- `agents/engineering.yaml` + `build_site` guide: one static `index.html`, "no build step".
- `packages/integrations/src/sandbox/images.ts` returns a labelled placeholder SVG; there is
  no live image adapter. `ImageRequestSchema` has only prompt/width/height.
- `packages/agents/src/runtime/claude-agent-sdk.ts` passes `settingSources: []` and one
  in-process MCP tool, so no skill can load today.
- `apps/web/.../artifacts/[id]/page.tsx` renders markdown only; no images, versions, variants or comments.

## 2. Findings

### 2.1 Skill and plugin libraries

How skills load in North's runtime: the Agent SDK discovers skills only from filesystem
setting sources or from the `plugins` option (`{ type: "local", path }`), and a `skills`
list restricts which ones Claude may invoke; plugin skills are namespaced `plugin:skill`
([SDK skills](https://code.claude.com/docs/en/agent-sdk/skills), [SDK plugins](https://code.claude.com/docs/en/agent-sdk/plugins)).
North can keep `settingSources: []` and pass vendored plugin paths plus a per-persona allowlist.

| Library | Repo / licence / last commit | What it gives | North use | Risk |
| --- | --- | --- | --- | --- |
| frontend-design (Anthropic) | [anthropics/skills](https://github.com/anthropics/skills) skill dir Apache-2.0, 2026-10-09; identical copy in [claude-plugins-official](https://github.com/anthropics/claude-plugins-official) (Apache-2.0) | Two-pass process: compact token plan (4-6 hex colours, type roles, ASCII layout), review the plan for genericness, then build; list of 2026 "AI tells"; "taking screenshots to review ... a picture is worth 1000 tokens" | Base skill for every design/frontend persona | The `claude-code` copy sits in an "All rights reserved" repo; vendor the `anthropics/skills` copy |
| theme-factory, canvas-design, web-artifacts-builder, webapp-testing, algorithmic-art | same repo, each Apache-2.0 | 10 preset themes; PNG/PDF poster art with bundled OFL fonts; React+Tailwind+shadcn single-file bundles; Playwright helper scripts | canvas-design for social/OG art; webapp-testing scripts for the critic | `brand-guidelines` applies Anthropic's own brand: never for a user's company. web-artifacts-builder ships a `.tar.gz`; review before vendoring |
| Prompting for frontend aesthetics | [cookbook recipe](https://platform.claude.com/cookbook/coding-prompting-for-frontend-aesthetics) (repo MIT), 2025-10-21 | Steer typography, colour, motion, backgrounds; avoid Inter/Roboto/Arial and "purple gradients on white"; isolated per-dimension prompts | Seed North's own brand-kit and direction skills | Older than the skill; the skill supersedes it |
| Impeccable | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) Apache-2.0, v4.6.0, 2026-10-16 | `PRODUCT.md`/`DESIGN.md` context, 24 commands (`shape`, `critique`, `audit`, `polish`, `animate`, `live`, `generate` variants), 59 deterministic detector rules runnable with no LLM | Critic uses the detector as a hard gate; designers use `shape`/`critique` references | Engine binary downloaded on first run into `~/.impeccable/bin/`; NOTICE credits MIT-derived iOS/Android references |
| Taste Skill | [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) MIT, 2026-10-14 | Style family (minimalist, brutalist, soft, redesign, image-to-code, imagegen-frontend, `brandkit`); dials for variance/motion/density, defaults 8/6/4 ([listing](https://claudemarketplaces.com/skills/leonxlnx/taste-skill/design-taste-frontend-v1)) | Dials make 3 directions actually differ; `brandkit` prompts for brand boards | Instruction-only; v2 marked experimental |
| UI UX Pro Max | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) MIT (one sub-skill Apache-2.0), 2026-10-15 | Searchable CSV data: `google-fonts.csv`, `google-font-licenses.json`, `colors.csv`, `landing.csv`, `motion.csv`, with `data-provenance.json`; plus a design-review agent | Data source for the brand designer's font pairing and palettes | 251 py/csv files; run scripts sandboxed |
| Emil Kowalski skills | [emilkowalski/skills](https://github.com/emilkowalski/skills) MIT, 2026-10-11 | `emil-design-eng`, `animate`, `animation-performance`, `review-animations`, `improve-animations`, `pick-ui-library` | Motion/3D engineer and critic motion checks | Author advises case-by-case use, not always-on ([site](https://emilkowal.ski/skill)) |
| UI Skills | [ibelick/ui-skills](https://github.com/ibelick/ui-skills) MIT, v0.2.4, 2026-10-16 | `baseline-ui` (MUST/SHOULD rules, quotes violations with fixes), `fixing-accessibility`, `fixing-metadata`, `fixing-motion-performance`, `create-design-md` | Frontend engineer's polish pass | Opinionated toward Tailwind defaults |
| Vercel agent-skills | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) MIT (README), 2026-08-28; [web-interface-guidelines](https://github.com/vercel-labs/web-interface-guidelines) MIT, 2026-10-05 | `react-best-practices`, `react-view-transitions`, `web-design-guidelines` (terse `file:line` findings) | Frontend engineer + critic code audit | `web-design-guidelines` fetches `command.md` from GitHub on every run: vendor the file instead |
| Design review workflow | [OneRedOak/claude-code-workflows](https://github.com/OneRedOak/claude-code-workflows) MIT, 2026-10-08 | Agent with phases (interaction, responsive at 1440/768/375, polish, WCAG AA, robustness, code health, console), triage Blocker/High/Medium/Nit, "Live Environment First" | Structure of North's critic report | Uses 375px; North standard is 390px |
| Interface Design | [Dammyjay93/interface-design](https://github.com/Dammyjay93/interface-design) MIT, 2026-06-20 | Persists design decisions to `.interface-design/system.md` across sessions | Pattern only; North stores the same in company memory | A third-party audit flagged that it tells the agent to install code from GitHub ([skills.sh](https://www.skills.sh/podo/design-agent-skills/interface-design-dammyjay/security/agent-trust-hub)) |
| DESIGN.md collections | [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) MIT, 2026-10-14; [bergside/awesome-design-skills](https://github.com/bergside/awesome-design-skills) MIT | DESIGN.md files for real brands (Stripe, Vercel, Linear...) built on Stitch's DESIGN.md format | Format examples for North's brand-kit output | Real brands' identities: never a template for a user's brand |
| Skill lists | [travisvn/awesome-claude-skills](https://github.com/travisvn/awesome-claude-skills) (2026-04-28), [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills) (2026-07-24) | Discovery only | Discovery only | No LICENSE file in either repo |
| shadcn MCP | [shadcn-ui/ui](https://github.com/shadcn-ui/ui) MIT, 2026-10-16; [docs](https://ui.shadcn.com/docs/mcp) | Browse/search/install registry items from chat; `shadcn mcp init --client claude` | Frontend engineer installs components inside the task sandbox | Needs registry network access; allowlist hosts |
| 21st.dev Magic MCP, Magic UI MCP | [21st-dev/magic-mcp](https://github.com/21st-dev/magic-mcp) ISC, 2026-09-09; [magicuidesign/mcp](https://github.com/magicuidesign/mcp) MIT, 2026-04-07 | Component generation / animated component lookup | Optional later | Magic MCP needs a 21st.dev key (paid service) |
| Figma MCP | [docs](https://developers.figma.com/docs/figma-mcp-server/) | Remote server `https://mcp.figma.com/mcp`: design context, write-to-canvas, code-to-canvas | "Export direction to Figma" for founders who use Figma | Write-to-canvas needs a Full seat; free in beta, "will eventually become usage-based" |
| Mobbin MCP | [mobbin/mobbin-mcp-server](https://github.com/mobbin/mobbin-mcp-server) MIT, 2026-08-20; [features](https://docs.mobbin.com/mcp/features) | Hosted `https://api.mobbin.com/mcp`, OAuth, tools `search_screens`, `search_flows`, `search_sections`; image URLs expire after 30 days | Reference screens for directions (a test query for "hero section with email waitlist signup form" returned real waitlist heroes) | Paid Mobbin plan per a third-party report ([chatforest](https://chatforest.com/reviews/mobbin-mcp-server/)); screenshots are other companies' work: reference only |
| Avoid | [DavidHDev/react-bits](https://github.com/DavidHDev/react-bits) MIT + Commons Clause; [superdesigndev/superdesign](https://github.com/superdesigndev/superdesign) mostly AGPLv3, unmaintained | Animated components; parallel variant canvas | Ideas only | Commons Clause bars selling; AGPL is viral |

Founder-named process libraries are verified too: [obra/superpowers](https://github.com/obra/superpowers)
(MIT, v7.0.0, 2026-10-09) and [mattpocock/skills](https://github.com/mattpocock/skills) (MIT, v1.3.1,
2026-10-09). Both are engineering-process skills (TDD, planning, review), useful for the
frontend engineer's workflow, not for taste.

### 2.2 3D and animated web

| Library | Repo / licence / last commit | Cost | Notes for North |
| --- | --- | --- | --- |
| Three.js | [mrdoob/three.js](https://github.com/mrdoob/three.js) MIT, v0.186.0, 2026-10-16 | Free | Core renderer |
| React Three Fiber | [pmndrs/react-three-fiber](https://github.com/pmndrs/react-three-fiber) MIT, 2026-10-14 | Free | Fits North's React/Next stack |
| drei | [pmndrs/drei](https://github.com/pmndrs/drei) MIT, 2026-09-30 | Free | Helpers incl. `<Detailed />` LOD |
| postprocessing | [pmndrs/postprocessing](https://github.com/pmndrs/postprocessing) Zlib, 2026-09-09 | Free | Effects; costly on phones |
| glTF-Transform | [donmccurdy/glTF-Transform](https://github.com/donmccurdy/glTF-Transform) MIT, 2026-10-06 | Free | `optimize` with Meshopt/KTX2/WebP to shrink GLBs |
| Motion | [motiondivision/motion](https://github.com/motiondivision/motion) MIT, 2026-10-16 | Core free; Motion+ Solo $399 one-time ([pricing](https://motion.dev/pricing)) | Default animation library; a "Builder's Licence" is required only to resell Motion+ capabilities |
| GSAP | [greensock/GSAP](https://github.com/greensock/GSAP) v3.15.0, 2026-04-13, "Standard no charge" licence | Free incl. former Club plugins ([Webflow](https://webflow.com/blog/gsap-becomes-free)) | Prohibited: "tools that allow users to build visual animations without code" competing with Webflow; FAQ says AI-generated code is not prohibited ([licence](https://gsap.com/community/standard-license/)). Webflow may modify terms |
| Spline | [splinetool/react-spline](https://github.com/splinetool/react-spline) MIT, last commit 2025-07-15 | Free (watermark), Hobby $15, Pro $30 (code export, APIs), Max $70 (MCP limits) per seat/month ([pricing](https://spline.design/pricing)) | Founder's own account only; runtime is stale |
| Lottie | [airbnb/lottie-web](https://github.com/airbnb/lottie-web) MIT, last commit 2024-11-19; [LottieFiles/dotlottie-web](https://github.com/LottieFiles/dotlottie-web) MIT, 2026-10-06 | Free runtime | Prefer dotlottie-web; lottie-web is stale |
| Rive | [rive-app/rive-wasm](https://github.com/rive-app/rive-wasm) MIT, 2026-10-16 | Runtimes MIT ([docs](https://rive.app/docs/runtimes)); editor plans unverified for 2026 | Interactive state-machine animation; needs a human-made `.riv` |
| Theatre.js | [theatre-js/theatre](https://github.com/theatre-js/theatre) Apache-2.0, last commit 2024-04-11 | Free | Stale: avoid |
| 3D skills | [OpenAEC-Foundation/Three.js-Claude-Skill-Package](https://github.com/OpenAEC-Foundation/Three.js-Claude-Skill-Package) MIT, 2026-03-30 (r3f, drei, WebGPU, model optimizer, performance errors); [freshtechbro/claudedesignskills](https://github.com/freshtechbro/claudedesignskills) MIT, 2025-11-19 (r3f, gsap-scrolltrigger, lottie, rive, spline) | Free | Vendor the OpenAEC r3f/drei/optimizer/performance subset; freshtechbro is stale |
| 3D asset generation | Higgsfield `generate_3d` models (observed via its MCP `models_explore`): Meshy 6/7, Tripo H3.1/P2, Hunyuan3D v3/v3.1, SAM 3 3D; all output GLB | Credits; per-model price unverified | Image or text to GLB for a hero object, then glTF-Transform |

No official Anthropic "3D website" skill exists in `anthropics/skills` or
`anthropics/claude-plugins-official` (directory listings checked); the 3D skills are community ones.

Rules for 3D heroes (North standard, from the sources cited):
- Render on demand (`frameloop="demand"`), adapt DPR with `PerformanceMonitor`, instance
  repeated meshes, reuse geometries/materials, use LOD and nested Suspense with a low-poly
  first load ([R3F scaling performance](https://r3f.docs.pmnd.rs/advanced/scaling-performance)).
- The canvas is never the LCP element: ship a static poster image (same framing) in the HTML,
  mount the canvas after load/idle, keep LCP <= 2.5 s, INP <= 200 ms, CLS <= 0.1 ([web.dev vitals](https://web.dev/articles/vitals)).
- Compress GLBs with glTF-Transform (Meshopt + KTX2/WebP); North budget proposal: <= 1.5 MB GLB, <= 50k triangles for a hero.
- Motion: honour `prefers-reduced-motion` (WCAG 2.3.3 technique C39) by showing the poster;
  any auto-playing motion longer than 5 seconds needs pause/stop (WCAG 2.2.2)
  ([2.3.3](https://www.w3.org/WAI/WCAG21/Understanding/animation-from-interactions), [2.2.2](https://www.w3.org/WAI/WCAG21/Understanding/pause-stop-hide)).
- The 3D scene is decorative: `aria-hidden`, all copy and the CTA live in HTML, not in WebGL.

### 2.3 Logo and brand identity that yields real files

| Tool | Output | Price per image (API) | Access | North use |
| --- | --- | --- | --- | --- |
| Recraft V4.1 (direct API) | Raster and native vector models (`*_vector`, `vector_illustration`) | Raster $0.035, vector $0.08, pro vector $0.30, Flash raster $0.007; vectorize $0.01; remove background $0.01; style reference +$0.005 ([pricing](https://www.recraft.ai/docs/api-reference/pricing)) | API key; remote MCP `mcp.recraft.ai/mcp` (OAuth, different credit model); local MCP repo [recraft-ai/mcp-recraft-server](https://github.com/recraft-ai/mcp-recraft-server) MIT now points users to the remote one | Primary logo/icon generator; palette can be passed |
| Recraft via Higgsfield | `recraft_v4_1`, `model_type` standard/vector/utility/utility_vector, palette up to 10 hex, background colour | Credits; price unverified; whether the file is `.svg` is unverified | Higgsfield MCP/API | Trials on North's platform account |
| Ideogram 4.5 (also in Higgsfield) | Raster, strong typography | About $0.03-$0.10 by quality per a third-party guide; official page loads prices dynamically ([guide](https://developer.puter.com/tutorials/ideogram-api-pricing/), [pricing](https://ideogram.ai/pricing/?pricing_tab=api)) | API / Higgsfield | Wordmark exploration, then vectorize |
| GPT Image 2/2.5, Nano Banana Pro/2, FLUX 3, Seedream 5 | Raster | Credits (Higgsfield) | Higgsfield | OG images, hero art, mockups; GPT Image 2.5 offers transparent backgrounds |
| Higgsfield own models | Raster | From $0.0032/image (Soul 2), $0.0059 (Marketing Studio Image); funds expire after 1 year; failed requests not charged ([API](https://higgsfield.ai/blog/higgsfield-api)) | API key, async jobs, webhooks, 20 concurrent | Ad creatives later (Growth) |
| Vectorizer.AI | SVG from raster | $0.20/credit at 50 credits/month down to $0.05 at 100k ([pricing](https://www.vectorizer.ai/pricing)) | API | Fallback; Recraft vectorize is cheaper |
| VTracer | SVG from raster, offline | Free | [visioncortex/vtracer](https://github.com/visioncortex/vtracer) MIT, 2026-10-12 | Sandbox/offline vectorizer; avoid GPL potrace |
| SVGO | Optimised SVG | Free | [svg/svgo](https://github.com/svg/svgo) MIT, v4.1.0 | Clean every logo file |

Type and colour:
- Google Fonts: the [google/fonts](https://github.com/google/fonts) repo (last commit 2026-10-16) has 2,015 families under
  `ofl/`, 44 under `apache/`, 5 under `ufl/`; each family has `METADATA.pb` (category, designer,
  licence) and the README says self-hosting is permitted subject to each licence. North can
  generate a vendored font catalogue at build time; no runtime calls. UI UX Pro Max ships a
  ready `google-fonts.csv` with pairing data. Self-host with `next/font` or
  [Fontsource](https://github.com/fontsource/fontsource) (MIT tooling).
- Palettes with contrast built in: [adobe/leonardo](https://github.com/adobe/leonardo) (Apache-2.0,
  2026-07-08) generates colours from target contrast ratios ([API](https://leonardocolor.io/api.html));
  [color-js/color.js](https://github.com/color-js/color.js) (MIT, v0.7.1) computes WCAG 2.x
  and APCA contrast. Gate: body text >= 4.5:1, large text and UI components >= 3:1
  ([WCAG 1.4.3](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum), [1.4.11](https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast)).

### 2.4 Visual QA: the critic agent

Anthropic guidance, in order of strength:
- Claude Code best practices: give Claude a check it can run, for UI "take a screenshot of the
  result and compare it to the original. list differences and fix them"; have a fresh
  subagent verify rather than the worker grading itself ([best practices](https://code.claude.com/docs/en/best-practices)).
- Harness post (2026-03-24): a generator/evaluator loop where the evaluator uses Playwright MCP
  on the live page, scores four criteria (design quality, originality, craft, functionality),
  weights design quality and originality higher, and the generator decides to "refine the
  current direction if scores were trending well, or pivot to an entirely different
  aesthetic". Runs took 5-15 iterations; few-shot score breakdowns reduced drift; "Out of the
  box, Claude is a poor QA agent" ([post](https://www.anthropic.com/engineering/harness-design-long-running-apps)).
- The frontend-design skill itself tells the worker to self-critique with screenshots.

| Tool | Licence / activity | What the critic uses it for |
| --- | --- | --- |
| [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) | Apache-2.0, v0.0.83, 2026-10-08 | Navigate preview, resize to 390x844 and 1440x900, full-page screenshots, console |
| [ChromeDevTools/chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp) | Apache-2.0, v1.11.0, 2026-10-16 | `lighthouse_audit`, `performance_start_trace` for LCP/CLS ([guide](https://savvy.co.il/en/blog/wordpress-speed/chrome-devtools-mcp-lighthouse-audits/)) |
| [GoogleChrome/lighthouse](https://github.com/GoogleChrome/lighthouse) | Apache-2.0, v13.5.0, 2026-10-14 | Node API in the worker for deterministic scores; [lighthouse-ci](https://github.com/GoogleChrome/lighthouse-ci) last commit 2025-06-25, so call Lighthouse directly |
| [dequelabs/axe-core](https://github.com/dequelabs/axe-core) + [@axe-core/playwright](https://github.com/dequelabs/axe-core-npm) | MPL-2.0, v4.14.0, 2026-10-15 | `withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa'])`; "automated testing cannot detect all types of WCAG violations" ([Playwright docs](https://playwright.dev/docs/accessibility-testing)) |
| Playwright `toHaveScreenshot` | Apache-2.0 | Regression between versions; baselines must come from the same environment ([docs](https://playwright.dev/docs/test-snapshots)) |
| Impeccable detector | Apache-2.0 | 59 deterministic AI-slop rules, no LLM |
| Vercel web-interface-guidelines | MIT | Code-level rules with `file:line` output |

Cost of seeing: visual tokens are `ceil(w/28) x ceil(h/28)`; 1440x900 is ~1,716 tokens and
the high-resolution cap is 4,784 tokens (long edge 2576 px). At Sonnet 5.5's $2/MTok input a
full screenshot set (390 + 1440, above-fold + full page) costs about $0.02
([vision](https://platform.claude.com/docs/en/build-with-claude/vision), [pricing](https://platform.claude.com/docs/en/about-claude/pricing)).

Proposed North rubric (code decides pass/fail; the LLM only fills scores and findings):
1. Deterministic gates at 390 and 1440: no horizontal overflow; axe 0 critical/serious;
   Lighthouse mobile performance >= 80 (>= 70 with a 3D hero), accessibility >= 95, SEO and
   best practices >= 90; Impeccable detector 0 high-severity hits; computed styles of h1/body/
   primary button match `tokens.json` (fonts loaded via `document.fonts`); primary CTA and
   promise visible in the first viewport at 390px; no console errors.
2. LLM scores 1-10 with evidence (screenshot crop ids): design quality, originality (vs the
   frontend-design "AI tells" list), craft, functionality, brand adherence, conversion clarity.
   Pass at a weighted mean >= 7 with no score < 6. Calibrate with 3-5 stored, human-scored examples.
3. Report shaped like OneRedOak's: what works, then Blockers / High / Medium / Nit.

### 2.5 Landing page and waitlist

Evidence-backed copy and layout rules:
- Unbounce 2024 benchmark (57M conversions, 41k pages): median landing page conversion 6.6%,
  SaaS 3.8%; pages at a 5th-7th grade reading level convert at a median 11.1% vs 5.3% at
  college level ([Unbounce](https://unbounce.com/conversion-benchmark-report/), [MarketingProfs](https://marketingprofs.com/charts/2024/52374/landing-page-conversion-benchmarks)).
  The critic should compute a readability grade and flag > grade 8.
- NN/g 2018 eye-tracking: 57% of viewing time above the fold, 74% in the first two screens
  ([NN/g](https://www.nngroup.com/articles/scrolling-and-attention/)): promise, audience and the
  email field must sit in the first 390x844 viewport.
- One primary action per page (the current `build_site` guide already says this).

Waitlist mechanics:
- Double opt-in trades some volume for a cleaner list and better deliverability; send the
  confirmation immediately and purge unconfirmed entries after 7-30 days ([LaunchList glossary](https://getlaunchlist.com/glossary/double-opt-in)).
  North default: double opt-in on, purge at 30 days.
- Referral queues ("move up N places per confirmed referral") are optional; research shows a
  plain first-come queue is sometimes optimal ([eScholarship paper](https://escholarship.org/content/qt2528d4dx/qt2528d4dx.pdf)).
  Count only confirmed referrals to resist fake sign-ups.
- Abuse: honeypot field, per-IP rate limit, Zod-validated payload, no fake success state.

Where the data lives (decision needed, see open questions):
- A. North-hosted endpoint (`POST /api/w/<slug>` in `apps/web`) writing `waitlist_entries` in
  North's Supabase under RLS, CSV export, delete-on-request. Simplest evidence path and no
  extra account; North becomes processor of end-user emails (privacy policy, DPA).
- B. The user's own Supabase (a `connection` with founder-entered keys, insert-only RLS for the
  anon key). Full ownership, but free projects pause after 7 days of inactivity
  ([Supabase pricing](https://supabase.com/pricing)), which can break a quiet pre-launch form.
- C. A form provider (Tally, Formspree): another account and weaker evidence; not recommended.

Evidence the waitlist works (Playwright, on the preview, live E2E tier): submit
`qa+<taskId>@<test domain>`; assert the success state appears only after a 2xx; read the row
back (`is_test = true`, excluded from the `waitlist` metric); fetch the confirmation message
from the sandbox mail capture, open its link, assert status `confirmed`; store screenshots.
`Evidence` = preview URL, deployment id, entry id, confirmation message id, screenshot ids.

### 2.6 Variant workflow in other tools

| Tool | How directions are shown | How comments become versions | Copy for North |
| --- | --- | --- | --- |
| Google Stitch | "Generate Variations" on a selected screen, default 3, adjustable; DESIGN.md import/export ([guide](https://uithings.com/what-is-google-stitch), [review](https://tutorialsdojo.com/what-google-stitch-actually-does-and-where-it-falls-short/)) | Chat + canvas edits | 3 by default; DESIGN.md as the brand contract |
| Kombai | Variants setting 1-3 plus refinement "passes" ([docs](https://docs.kombai.com/design/design-settings)) | Per-variant passes | Let the critic run passes per variant before the user sees them |
| v0 Design Mode | Single thread; variants by asking in history | Visual tweaks stay pending until **Apply**, which "produces a new chat version" with diff and revert; NL edits attach a screenshot of the selected element ([docs](https://v0.app/docs/design-mode)) | Batch comments, one Apply, new version, diff, revert |
| Lovable | Single app | Select (S) attaches elements; Draw (D) sends an annotated screenshot; Comment (C) pins threads, free to add, sending runs "after the current task" ([docs](https://docs.lovable.dev/features/preview-toolbar)) | Pin comments on screenshots or DOM selectors, send as one revision |
| Figma Make | Version history and Point-and-edit with Apply ([help](https://help.figma.com/hc/en-us/articles/31304485164695)); no side-by-side branching per a Feb 2026 request ([forum](https://forum.figma.com/suggest-a-feature-11/figma-make-structured-version-control-iteration-branching-for-ai-workflows-51303)) | Apply commits | Make branching explicit: Direction A/B/C are siblings |
| Framer AI | Wireframer page from a prompt; agent generates hero layout variations that keep copy and styles ([update](https://www.createwith.com/tool/framer/updates/framer-adds-hero-variations-to-framer-agent)) | Pick one, drop onto site | "Mix": keep A's type, take B's hero |
| Relume | Staged: sitemap, then wireframes from 1,000+ components, then style guide; export to Figma/Webflow/React ([site](https://relume.io/)) | Approve per stage | Approve structure before style; cheap stages first |
| Claude Design | Chat, inline comments on elements, generated sliders for spacing/colour; reads codebase to build a design system (launched 2026-04-17, per [DataCamp](https://www.datacamp.com/blog/claude-design)) | Comments propagate across design | Inline comments + "apply everywhere" |
| Bolt.new | One output per prompt per a competitor's comparison ([Superdesign](https://superdesign.dev/blog/bolt-vs-superdesign)) | Chat | Counter-example |

What North should copy: (1) 3 sibling directions by default, each critic-screened before the
user sees it; (2) a staged approval: brand kit -> directions (static) -> build; (3) comments
anchored to a screenshot point or DOM selector, batched, sent with the screenshot crop, producing
version N+1 with a visual diff and one-click revert; (4) "refine or pivot" as an explicit choice
on each revision; (5) DESIGN.md + `tokens.json` as the contract every later persona reads.

## 3. Recommendations for North (ranked)

1. **Vendored, pinned skill library and loader** (touches `skills/`, `packages/agents/src/runtime/claude-agent-sdk.ts`,
   `packages/agents/src/runtime/tool-policy.ts`, CI). Create `skills/vendor/<name>/` copied at
   a pinned commit, plus `skills/skills.lock.json` (repo, commit SHA, SPDX licence, sha256 per file)
   and a CI script that fails on a missing/changed licence or hash. First batch: anthropics/skills
   (frontend-design, canvas-design, theme-factory, webapp-testing), impeccable (markdown + a
   pre-downloaded, hashed engine binary, or markdown only), emilkowalski/skills (4 motion skills),
   ibelick/ui-skills (baseline-ui, fixing-accessibility, fixing-metadata), taste-skill (taste-skill,
   brandkit, minimalist, soft, brutalist), ui-ux-pro-max data CSVs, vercel react-best-practices +
   a vendored `command.md` replacing the run-time fetch, OpenAEC r3f/drei/optimizer subset.
   Wrap each as a local plugin and pass `plugins` + a per-persona `skills` allowlist; keep
   `settingSources: []`. Record the `init` message's `skills` and every `Skill` tool use for the live work view.
2. **North-authored skills** (`skills/north/`): `brand-kit` (output contract: DESIGN.md, tokens.json,
   logo files, contrast table), `design-directions` (3 directions forced apart via taste dials and a
   distinctness check), `design-critique` (rubric above + few-shot calibration set), `landing-waitlist`
   (copy rules, form contract, evidence steps), `3d-hero` (rules in 2.2).
3. **Personas** (`agents/personas/*.yaml`, a `department: design_frontend` key, replacing the single
   `design.yaml` prompt; `engineering.yaml` keeps deploy authority):

| Persona | Model | Skills | Tools | Outputs | Evidence that proves done |
| --- | --- | --- | --- | --- | --- |
| Brand Designer | drafter (Sonnet 5.5) | north:brand-kit, frontend-design, taste:brandkit, ui-ux-pro-max data | memory.search, images.generate (svg/png), images.vectorize, palette.check (Leonardo/color.js), fonts.catalog, artifacts.write | `BrandKit` v(n) + files: logo.svg, mark.svg, wordmark.svg, favicons, og.png, tokens.json, DESIGN.md | Files in Storage with sha256; each SVG parses, has a viewBox, no embedded raster, <= 30 KB after SVGO; contrast table computed by the tool, all pairs pass; fonts from the catalogue with OFL/Apache licence |
| Art Director | drafter | north:design-directions, frontend-design, impeccable (shape), taste dials; Mobbin MCP if the user connects it | artifacts.write, render.screenshot (worker Playwright) | `DesignDirections`: 2-3 directions, each a DESIGN.md delta + static HTML hero/landing + screenshots | 390 and 1440 screenshots per direction stored; distinctness check passed; critic pre-score >= 6 each |
| Frontend Engineer | coder (Opus 5.5) | frontend-design, vercel react-best-practices, web-interface-guidelines, ui-skills fixers, north:landing-waitlist; shadcn MCP | fs.*, bash, tests.run, repo.push, deploy.preview | Next.js + Tailwind v4 site in the user's repo, waitlist form, `build_report` | Preview 200; build exit 0; Playwright waitlist E2E (2.5); axe and Lighthouse gates pass at 390/1440 |
| Motion & 3D Engineer (only when a direction asks for it) | coder | emil animate/animation-performance/review-animations, OpenAEC r3f/drei/optimizer, north:3d-hero | images.to3d (Higgsfield GLB), gltf-transform, fs.*, bash | Hero component with poster fallback, optimised GLB | GLB within budget; reduced-motion screenshot shows the poster; canvas not LCP; mobile perf gate; no WebGL console errors |
| Design Critic | drafter, fresh context | north:design-critique, OneRedOak phases, impeccable critique/audit + detector, web-interface-guidelines | Playwright MCP and chrome-devtools-mcp limited to the preview host, axe, Lighthouse | `CritiqueReport`: scores, findings with crops, refine/pivot advice | Stored axe JSON, Lighthouse JSON, detector output and screenshots; pass/fail computed in code |

   Copy for the page stays with the Art Director in this phase; a Growth copywriter persona can
   take it over when Growth is rebuilt.
4. **Task types and guides** (`packages/core` `TaskType`/`ArtifactKind`, `packages/agents/src/prompts/task-guides.ts`):
   rewrite `brand_kit` to require files (drop "no binary assets"); replace `screen_designs` with
   `design_directions`; add `design_critique` and `revise_artifact` (input: artifact version +
   comment batch, as data); rewrite `build_site` for a Next.js/Tailwind build with the waitlist
   contract and evidence. Flow: brand_kit -> design_directions -> review queue pick -> build_site
   (+ 3D) -> critique loop (max 2 revisions, budget-capped) -> K2 go-live card.
5. **Images integration** (`packages/integrations/src/types.ts`, `live/recraft.ts`, `live/higgsfield.ts`,
   `sandbox/images.ts`): extend `ImageRequestSchema` with `format` (`svg|png|webp`), `purpose`
   (`logo|icon|og|hero|texture`), `palette` (<= 10 hex), `model`, `background`; `ImageResult` gains
   `storagePath`, `mime`, `sha256`, `costUsd`, `provider`, `providerRef`. Add `vectorize` and
   `to3d` operations. Every call is an `Action` through `AuthorityEngine.gate()` (K0 under the
   tools cap, K2 above), cost written to the ledger, outputs copied to Storage immediately
   (Higgsfield keeps them >= 7 days only). Platform trials use North's account as North credits;
   the user's own key is a `connection`.
6. **Critic loop in the worker** (`apps/worker` Inngest function `design.critique`): Playwright in the
   worker takes screenshots deterministically; the critic agent gets images + tool JSON as data.
   Stop rule: pass, or 2 revisions, or budget hit, whichever first; then the review queue.
7. **Artifact screens** (`apps/web/src/app/(app)/c/[slug]/artifacts/[id]/page.tsx`, new
   `reviews/page.tsx`, components): render by kind (BrandKit board with swatches + contrast badges,
   type specimens, file downloads; DirectionsCompare side by side with a 390/1440 toggle and "Pick";
   CritiqueReport); a comment layer storing `artifact_comments` (version, anchor point/selector,
   body, status) and a "Send N comments" button that queues `revise_artifact`; version history with
   visual diff and revert; a review queue table separate from `decision_cards` so drafts never
   touch the 3-card quota.
8. **Budget plan** (assumptions: Sonnet 5.5 $2/$10, Opus 5.5 $4/$20 per MTok, cache hits 0.05x
   ([pricing](https://platform.claude.com/docs/en/about-claude/pricing)); token counts are estimates):

| Step | Estimate |
| --- | --- |
| Brand kit (Sonnet, ~60k in / 8k out) + 12 Recraft vector logos ($0.96) + 3 OG rasters ($0.12) | ~$1.30 |
| 3 directions as static HTML (Sonnet, ~80k in / 15k out each) | ~$0.95 |
| Critic pre-screen of 3 directions (Sonnet with ~9 screenshots) | ~$0.45 |
| Build chosen direction (Opus, ~500k in mostly cached / 60k out) | ~$1.50-2.00 |
| 2 critique + revision rounds | ~$1.50-2.50 |
| **Full cycle** | **~$5.70-7.20** |

   Per-change CI uses a fixed tiny brief, 1 direction, no image generation (sandbox images) and the
   deterministic gates, about $0.50 a run; milestone acceptance runs the full cycle live. At
   ~10 full cycles and ~60 per-change runs a month the spend stays near $100, so the budget guard
   must hard-stop dev/test spend at the cap.

## 4. Risks

- **Licences**: `anthropics/claude-code` is proprietary; `docx`/`pptx`/`xlsx`/`pdf` skills are
  "All rights reserved"; react-bits carries Commons Clause; Superdesign is AGPLv3; GSAP's licence can be
  changed by Webflow and has a no-code-builder carve-out. Mitigation: lockfile + CI licence check; Motion by default.
- **Run-time fetching** forbidden by the founder but built into vendor skills (Vercel guidelines fetch,
  Impeccable engine download, shadcn registry, Google Fonts CDN). Mitigation: vendor files, sandbox
  network allowlist, self-hosted fonts.
- **Prompt injection through pixels and pages**: Mobbin images, reference sites and the preview's own
  content reach the critic. Treat them as data; restrict Playwright MCP to the preview host.
- **Brand IP**: DESIGN.md files of real brands and Mobbin screens are other companies' work; AI logos can
  collide with registered marks. Never use them as templates; add a trademark check before go-live (open question).
- **Generous critics**: Anthropic reports LLM evaluators drift generous. Deterministic gates decide; the
  calibration set is reviewed by the founder; Design defaults to "Review drafts".
- **Loop cost**: Anthropic's frontend runs took 5-15 iterations and up to 4 hours; North caps at 2 revisions.
- **Stale dependencies**: lottie-web (2024-11), react-spline (2025-07), theatre.js (2024-04),
  lighthouse-ci (2025-06), freshtechbro skills (2025-11).
- **3D on low-end phones** and motion sensitivity: poster-first, reduced motion, perf gate.
- **Provider churn**: Higgsfield model catalogue and prices move; Higgsfield API funds expire after one
  year; Figma write-to-canvas will become usage-based; Mobbin MCP is beta.
- **Waitlist data**: option A makes North a processor of end-user personal data; option B can pause.

## 5. Open questions for the founder

1. Waitlist storage default: North-hosted (A) or the user's own Supabase (B)?
2. Three directions by default (an estimated +$0.60-0.80 per cycle over two), or two?
3. In Autopilot, may the system pick the highest-scoring direction, or must the user always pick?
4. Platform trials: one North Recraft API key (vector-native, $0.08/logo) or Higgsfield's catalogue
   (more models, one bill), or both?
5. Should onboarding offer Mobbin and Figma connections (users' paid accounts) in this phase?
6. Motion only, or is GSAP acceptable after a licence review?
7. Is a trademark screen of the chosen name/logo required before the go-live card?
8. The generated site moves from static `index.html` to Next.js + Tailwind (a build step): agreed?

## 6. Sources

Repos (licence and last commit verified by clone on 2026-10-16):
[anthropics/skills](https://github.com/anthropics/skills), [anthropics/claude-code](https://github.com/anthropics/claude-code), [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official), [anthropics/claude-cookbooks](https://github.com/anthropics/claude-cookbooks), [pbakaus/impeccable](https://github.com/pbakaus/impeccable), [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill),
[nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill), [emilkowalski/skills](https://github.com/emilkowalski/skills), [ibelick/ui-skills](https://github.com/ibelick/ui-skills), [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills), [vercel-labs/web-interface-guidelines](https://github.com/vercel-labs/web-interface-guidelines), [OneRedOak/claude-code-workflows](https://github.com/OneRedOak/claude-code-workflows),
[Dammyjay93/interface-design](https://github.com/Dammyjay93/interface-design), [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md), [bergside/awesome-design-skills](https://github.com/bergside/awesome-design-skills), [travisvn/awesome-claude-skills](https://github.com/travisvn/awesome-claude-skills), [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills), [obra/superpowers](https://github.com/obra/superpowers),
[mattpocock/skills](https://github.com/mattpocock/skills), [shadcn-ui/ui](https://github.com/shadcn-ui/ui), [21st-dev/magic-mcp](https://github.com/21st-dev/magic-mcp), [magicuidesign/mcp](https://github.com/magicuidesign/mcp), [mobbin/mobbin-mcp-server](https://github.com/mobbin/mobbin-mcp-server), [recraft-ai/mcp-recraft-server](https://github.com/recraft-ai/mcp-recraft-server),
[microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp), [ChromeDevTools/chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp), [GoogleChrome/lighthouse](https://github.com/GoogleChrome/lighthouse), [GoogleChrome/lighthouse-ci](https://github.com/GoogleChrome/lighthouse-ci), [dequelabs/axe-core](https://github.com/dequelabs/axe-core), [dequelabs/axe-core-npm](https://github.com/dequelabs/axe-core-npm),
[mrdoob/three.js](https://github.com/mrdoob/three.js), [pmndrs/react-three-fiber](https://github.com/pmndrs/react-three-fiber), [pmndrs/drei](https://github.com/pmndrs/drei), [pmndrs/postprocessing](https://github.com/pmndrs/postprocessing), [donmccurdy/glTF-Transform](https://github.com/donmccurdy/glTF-Transform), [motiondivision/motion](https://github.com/motiondivision/motion),
[greensock/GSAP](https://github.com/greensock/GSAP), [splinetool/react-spline](https://github.com/splinetool/react-spline), [airbnb/lottie-web](https://github.com/airbnb/lottie-web), [LottieFiles/dotlottie-web](https://github.com/LottieFiles/dotlottie-web), [rive-app/rive-wasm](https://github.com/rive-app/rive-wasm), [theatre-js/theatre](https://github.com/theatre-js/theatre),
[OpenAEC-Foundation/Three.js-Claude-Skill-Package](https://github.com/OpenAEC-Foundation/Three.js-Claude-Skill-Package), [freshtechbro/claudedesignskills](https://github.com/freshtechbro/claudedesignskills), [adobe/leonardo](https://github.com/adobe/leonardo), [color-js/color.js](https://github.com/color-js/color.js), [google/fonts](https://github.com/google/fonts), [fontsource/fontsource](https://github.com/fontsource/fontsource),
[visioncortex/vtracer](https://github.com/visioncortex/vtracer), [svg/svgo](https://github.com/svg/svgo), [DavidHDev/react-bits](https://github.com/DavidHDev/react-bits), [superdesigndev/superdesign](https://github.com/superdesigndev/superdesign).
Not verifiable by clone: `Evercoast/culori` (clone failed; not recommended here).

Docs, pricing and studies:
[Agent SDK skills](https://code.claude.com/docs/en/agent-sdk/skills), [Agent SDK plugins](https://code.claude.com/docs/en/agent-sdk/plugins), [Claude Code best practices](https://code.claude.com/docs/en/best-practices), [Harness design for long-running apps](https://www.anthropic.com/engineering/harness-design-long-running-apps), [Improving frontend design through Skills](https://claude.com/blog/improving-frontend-design-through-skills), [Prompting for frontend aesthetics](https://platform.claude.com/cookbook/coding-prompting-for-frontend-aesthetics),
[Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing), [Claude vision](https://platform.claude.com/docs/en/build-with-claude/vision), [GSAP standard licence](https://gsap.com/community/standard-license/), [Webflow: GSAP free](https://webflow.com/blog/gsap-becomes-free), [Motion pricing](https://motion.dev/pricing), [Spline pricing](https://spline.design/pricing),
[Rive runtimes](https://rive.app/docs/runtimes), [R3F scaling performance](https://r3f.docs.pmnd.rs/advanced/scaling-performance), [web.dev Web Vitals](https://web.dev/articles/vitals), [WCAG 2.3.3](https://www.w3.org/WAI/WCAG21/Understanding/animation-from-interactions), [WCAG 2.2.2](https://www.w3.org/WAI/WCAG21/Understanding/pause-stop-hide), [WCAG 1.4.3](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum),
[WCAG 1.4.11](https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast), [Recraft API pricing](https://www.recraft.ai/docs/api-reference/pricing), [Recraft endpoints](https://www.recraft.ai/docs/api-reference/endpoints), [Higgsfield API](https://higgsfield.ai/blog/higgsfield-api), [Ideogram pricing](https://ideogram.ai/pricing/?pricing_tab=api), [Ideogram pricing guide (third party)](https://developer.puter.com/tutorials/ideogram-api-pricing/),
[Vectorizer.AI pricing](https://www.vectorizer.ai/pricing), [Leonardo API](https://leonardocolor.io/api.html), [shadcn MCP](https://ui.shadcn.com/docs/mcp), [Figma MCP](https://developers.figma.com/docs/figma-mcp-server/), [Mobbin MCP features](https://docs.mobbin.com/mcp/features), [Mobbin MCP review](https://chatforest.com/reviews/mobbin-mcp-server/),
[Playwright accessibility testing](https://playwright.dev/docs/accessibility-testing), [Playwright snapshots](https://playwright.dev/docs/test-snapshots), [chrome-devtools-mcp Lighthouse guide](https://savvy.co.il/en/blog/wordpress-speed/chrome-devtools-mcp-lighthouse-audits/), [Unbounce benchmark](https://unbounce.com/conversion-benchmark-report/), [MarketingProfs on Unbounce 2024](https://marketingprofs.com/charts/2024/52374/landing-page-conversion-benchmarks), [NN/g scrolling and attention](https://www.nngroup.com/articles/scrolling-and-attention/),
[Double opt-in glossary](https://getlaunchlist.com/glossary/double-opt-in), [Referral waitlist paper](https://escholarship.org/content/qt2528d4dx/qt2528d4dx.pdf), [Supabase pricing](https://supabase.com/pricing), [v0 Design Mode](https://v0.app/docs/design-mode), [Lovable preview toolbar](https://docs.lovable.dev/features/preview-toolbar), [Kombai design settings](https://docs.kombai.com/design/design-settings),
[Google Stitch guide](https://uithings.com/what-is-google-stitch), [Stitch review](https://tutorialsdojo.com/what-google-stitch-actually-does-and-where-it-falls-short/), [Figma Make help](https://help.figma.com/hc/en-us/articles/31304485164695), [Figma Make branching request](https://forum.figma.com/suggest-a-feature-11/figma-make-structured-version-control-iteration-branching-for-ai-workflows-51303), [Framer hero variations](https://www.createwith.com/tool/framer/updates/framer-adds-hero-variations-to-framer-agent), [Relume](https://relume.io/),
[Claude Design overview (DataCamp)](https://www.datacamp.com/blog/claude-design), [Superdesign vs Bolt](https://superdesign.dev/blog/bolt-vs-superdesign), [Taste Skill listing](https://claudemarketplaces.com/skills/leonxlnx/taste-skill/design-taste-frontend-v1), [Emil Kowalski skill](https://emilkowal.ski/skill), [interface-design audit](https://www.skills.sh/podo/design-agent-skills/interface-design-dammyjay/security/agent-trust-hub).
