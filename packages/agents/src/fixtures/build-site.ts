import type { AgentOutput, OutputFile } from "@north/core";
import type { MockScript } from "../runtime/mock";
import { fixtureContext, succeeded } from "./shared";

/** Test-only markers in the task input that make the fixture fail (AGT-3 attempt policy tests). */
export const FAIL_ONCE_MARKER = "[[fail-once]]";
export const FAIL_ALWAYS_MARKER = "[[fail-always]]";

const escape = (value: string): string => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "site";

/** The landing page: semantic HTML, no JavaScript, brand-kit palette, one call to action that posts to a configurable endpoint. */
export function landingPageHtml(company: string, customer: string, thesis: string): string {
  const c = escape(company);
  const k = escape(customer);
  const t = escape(thesis);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${c} · The weekly work, done. You keep the final say.</title>
<meta name="description" content="${c} runs the routine work for ${k} and asks you only when money or reputation is on the line.">
<link rel="stylesheet" href="styles.css">
</head>
<body>
<header class="hero">
  <p class="label">${c}</p>
  <h1>The weekly work, done. You keep the final say.</h1>
  <p class="lede">For ${k}. ${t}</p>
  <form class="cta" method="post" action="https://example.test/waitlist" data-endpoint="configure-me">
    <label for="email">Work email</label>
    <input id="email" name="email" type="email" required placeholder="you@company.com">
    <button type="submit">Start free</button>
  </form>
</header>
<main>
  <section id="problem">
    <h2>The problem</h2>
    <p>${k} spend their week on routine work that only gets done when they do it themselves. The important decisions wait.</p>
  </section>
  <section id="how">
    <h2>How it works</h2>
    <ol>
      <li><strong>State the goal.</strong> One number to move, one budget, one thesis.</li>
      <li><strong>Agents do the work.</strong> Research, plans, pages and campaigns, every day.</li>
      <li><strong>You decide.</strong> At most three cards a day. Nothing goes live or spends money without you.</li>
    </ol>
  </section>
  <section id="proof">
    <h2>Proof, not promises</h2>
    <p>Every task ends with evidence: a URL, a deploy, a sent message. Every action is in an audit log you can read.</p>
  </section>
  <section id="pricing">
    <h2>Pricing</h2>
    <p>Free while in private beta. Join the waitlist above; no card required.</p>
  </section>
  <section id="faq">
    <h2>Questions</h2>
    <dl>
      <dt>Who owns the code and data?</dt><dd>You do. The repository lives in your own GitHub account.</dd>
      <dt>Can I stop everything?</dt><dd>One button pauses every agent and campaign within five seconds.</dd>
    </dl>
  </section>
</main>
<footer>
  <p>${c} · <a href="mailto:hello@example.test">hello@example.test</a></p>
</footer>
</body>
</html>
`;
}

export const landingPageCss = `:root{--ink:#000;--paper:#fff;--muted:#555;--line:#ddd;--accent:#e65100}
*{box-sizing:border-box}body{margin:0;font:17px/1.5 Georgia,serif;color:var(--ink);background:var(--paper)}
.hero,main,footer{max-width:48rem;margin:0 auto;padding:2rem 1rem}
.label{font:11px/1 monospace;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
h1{font-size:2.4rem;line-height:1.1;margin:.5rem 0}h2{font-size:1.5rem;margin-top:2rem}
.lede{color:var(--muted)}.cta{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:1.5rem}
.cta label{flex-basis:100%;font:11px/1 monospace;text-transform:uppercase;letter-spacing:.06em}
.cta input{flex:1 1 14rem;padding:.75rem;border:1px solid var(--ink);border-radius:2px}
.cta button{padding:.75rem 1.25rem;border:1px solid var(--ink);border-radius:2px;background:var(--ink);color:var(--paper);font:12px/1 monospace;text-transform:uppercase;letter-spacing:.06em;cursor:pointer}
section{border-top:1px solid var(--line)}ol li+li{margin-top:.5rem}dt{font-weight:600;margin-top:1rem}footer{color:var(--muted);font-size:.9rem}
@media (min-width:640px){h1{font-size:3rem}}`;

const readme = (company: string): string => `# ${company} landing page

Static site built by North's Engineering agent from the PRD and brand kit.

- \`index.html\`: the page (semantic HTML, no JavaScript, no trackers)
- \`styles.css\`: brand-kit palette and type

Run locally: open \`index.html\` in a browser, or \`python3 -m http.server\` in this folder.
Before going live: point the waitlist form's \`action\` at your form endpoint.
`;

/** Build report artifact: what was built, the file list, how to run it, what to test on the preview. */
const buildReport = (company: string, files: readonly OutputFile[]): string => `# Build report: ${company} landing page

## What was built
A static landing page: promise above the fold, who it is for, one call to action (waitlist email), problem, how it works, proof, pricing, FAQ and a footer with contact.

## Files
${files.map((f) => `- \`${f.path}\` (${f.content.length} chars)`).join("\n")}

## Run locally
Open \`index.html\`, or serve the folder with \`python3 -m http.server 8000\` and visit http://localhost:8000.

## Test on the preview
1. The title and the first heading show the promise; the description meta is set.
2. The form requires an email and posts to the configured endpoint (replace the placeholder before launch).
3. At 390px nothing overflows; the button is reachable with the keyboard.
4. No external scripts or trackers load.

## Next
Replace the placeholder form endpoint, add the real contact address, then approve the go-live card.`;

/**
 * engineering:build_site fixture: files for the workspace plus a build report.
 * The platform pushes, previews and opens the go-live card; the fixture
 * requests no external action itself. `[[fail-once]]` fails on the first
 * attempt only; `[[fail-always]]` fails every time (AGT-3 tests).
 */
export const buildSiteScript: MockScript = (input) => {
  const ctx = fixtureContext(input);
  const attempt = /attempt\s*#?\s*(\d+)/i.exec(input.instructions)?.[1];
  const second = attempt !== undefined && Number(attempt) >= 2;
  if (input.instructions.includes(FAIL_ALWAYS_MARKER) || (input.instructions.includes(FAIL_ONCE_MARKER) && !second)) {
    return Object.freeze({ status: "failed", error: "Build failed: the first approach (single-page app scaffold) could not be verified locally", sessionId: "mock-build_site", usage: { model: "mock", inputTokens: 100, outputTokens: 10, costUsd: 0, durationMs: 1 } });
  }
  const files: OutputFile[] = [
    { path: "index.html", content: landingPageHtml(ctx.company, ctx.customer, ctx.thesis) },
    { path: "styles.css", content: landingPageCss },
    { path: "README.md", content: readme(ctx.company) },
  ];
  const output: AgentOutput = {
    summary: `Landing page for ${ctx.company} built as a static site (${files.length} files): promise, who it is for, one waitlist call to action, how it works, proof, pricing and FAQ. Ready for preview; going live waits for the CEO's card.`,
    artifacts: [{ kind: "build_report", title: `Build report: ${ctx.company} landing page`, markdown: buildReport(ctx.company, files) }],
    memory: [
      { kind: "learning", title: "Landing page v0", content: `Static HTML/CSS site named ${slug(ctx.company)}-site; form endpoint is a placeholder until launch.` },
      { kind: "decision", title: "Site stack", content: "Static HTML and CSS, no JavaScript and no trackers for v0; Next.js only once the product needs an app." },
    ],
    actions: [],
    files,
    confidence: second ? "medium" : "high",
  };
  return succeeded(input, "build_site", output);
};

export const siteNameFor = (company: string): string => `${slug(company)}-site`;
