#!/usr/bin/env bash
# PWA-1 evidence (docs/plans/M6.md "Acceptance test"): Lighthouse 11, the last
# version with the PWA category (12 removed it), against the dev server's
# login page with the pre-installed Chromium. The HTML report is the evidence;
# the JSON next to it is what this script asserts on: installable, a themed
# splash, a maskable icon, and (when Lighthouse 11 reports it) a service worker
# that controls the page.
#
#   pnpm lighthouse:pwa [url]      default http://localhost:3100/login (`pnpm dev` running)
#
# Env: LIGHTHOUSE_URL, CHROME_PATH (default /opt/pw-browsers/chromium),
#      LIGHTHOUSE_OUT (default docs/evidence/M6/lighthouse-pwa → .html and .json)
set -euo pipefail
cd "$(dirname "$0")/.."
if [ "${1:-}" = "--" ]; then shift; fi

URL="${1:-${LIGHTHOUSE_URL:-http://localhost:3100/login}}"
export CHROME_PATH="${CHROME_PATH:-/opt/pw-browsers/chromium}"
OUT="${LIGHTHOUSE_OUT:-docs/evidence/M6/lighthouse-pwa}"
mkdir -p "$(dirname "$OUT")"

if [ ! -x "$CHROME_PATH" ]; then
  echo "lighthouse:pwa: no Chromium at $CHROME_PATH (set CHROME_PATH)" >&2
  exit 1
fi
# The dev server compiles a route on its first request; warm it so the audit measures the page, not the compiler.
if ! node -e "fetch(process.argv[1],{signal:AbortSignal.timeout(60000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" "$URL"; then
  echo "lighthouse:pwa: $URL is not reachable; start the web with 'pnpm dev'" >&2
  exit 1
fi

# npx fetches Lighthouse 11 from the registry; a proxy that refuses it stops here with npm's own message.
npx --yes lighthouse@11 "$URL" \
  --only-categories=pwa \
  --output=html --output=json --output-path="$OUT" \
  --chrome-flags="--headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage" \
  --max-wait-for-load=90000 \
  --quiet
mv -f "$OUT.report.html" "$OUT.html"
mv -f "$OUT.report.json" "$OUT.json"

node - "$OUT.json" <<'NODE'
const report = JSON.parse(require("node:fs").readFileSync(process.argv[2], "utf8"));
const category = report.categories?.pwa;
if (!category) {
  console.error(`lighthouse:pwa: no PWA category in Lighthouse ${report.lighthouseVersion} (12 removed it; this script pins 11)`);
  process.exit(1);
}
const required = ["installable-manifest", "splash-screen", "themed-omnibox", "maskable-icon"];
const optional = ["service-worker"];
const failed = [];
for (const ref of category.auditRefs) {
  const audit = report.audits[ref.id];
  if (!audit || audit.scoreDisplayMode === "manual") continue;
  const ok = audit.score === 1 || audit.scoreDisplayMode === "notApplicable";
  console.log(`${ok ? "PASS" : "FAIL"}  ${ref.id.padEnd(22)} ${audit.title}${audit.displayValue ? ` (${audit.displayValue})` : ""}`);
  if (!ok && (required.includes(ref.id) || optional.includes(ref.id))) failed.push(ref.id);
}
const missing = required.filter((id) => !report.audits[id]);
console.log(`Lighthouse ${report.lighthouseVersion}, ${report.finalDisplayedUrl ?? report.finalUrl}: PWA ${category.score === null ? "n/a" : Math.round(category.score * 100)}`);
if (missing.length > 0 || failed.length > 0) {
  console.error(`lighthouse:pwa: failed ${[...failed, ...missing.map((id) => `${id} (missing)`)].join(", ")}`);
  process.exit(1);
}
NODE
echo "lighthouse:pwa: report saved to $OUT.html"
