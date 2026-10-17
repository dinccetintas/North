/**
 * TST-3, TST-4: `scripts/evidence-guard.sh` against throwaway directories:
 * it finds a secret's value in a plain file, inside a zip (a trace) and inside
 * the HTML report's embedded base64 zip, names the file and never the value,
 * passes clean output, and with `--run` keeps the command's exit code.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const GUARD = resolve(dirname(fileURLToPath(import.meta.url)), "evidence-guard.sh");
const BYPASS = "bypass-value-7f3c9e1d2b";
const RESEND = "re_resend-value-4a8b6c";
const hasZip = spawnSync("zip", ["-v"]).status === 0;

let root: string;

function guard(args: readonly string[], env: Record<string, string>) {
  const result = spawnSync("bash", [GUARD, ...args], { env: { PATH: process.env.PATH ?? "", EVIDENCE_GUARD_ROOT: root, ...env }, encoding: "utf8" });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

const write = (path: string, text: string): string => {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  return file;
};

/** A zip holding `text` as `trace.trace`, made with the `zip` command. */
function zipOf(path: string, text: string): string {
  const work = mkdtempSync(join(tmpdir(), "guard-zip-"));
  writeFileSync(join(work, "trace.trace"), text);
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  execFileSync("zip", ["-q", "-j", file, join(work, "trace.trace")]);
  rmSync(work, { recursive: true, force: true });
  return file;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "evidence-guard-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("TST-4 evidence-guard.sh: no secret value in the run's output", () => {
  it("TST-4 has nothing to look for when neither secret is set", () => {
    write("apps/web/test-results/a.txt", `${BYPASS} ${RESEND}`);
    const { status, out } = guard([], {});
    expect(status).toBe(0);
    expect(out).toContain("evidence guard: skip");
  });

  it("TST-4 passes clean output", () => {
    write("apps/web/playwright-report-staging/summary.json", '{"ok":true}');
    write("docs/evidence/M7/staging-journey.txt", "2 passed");
    const { status, out } = guard([], { VERCEL_AUTOMATION_BYPASS_SECRET: BYPASS, E2E_RESEND_KEY: RESEND });
    expect(status).toBe(0);
    expect(out).toContain("evidence guard: OK");
    expect(out).not.toContain(BYPASS);
  });

  it("TST-4 fails on a value in the tee'd log or the report, naming the file and the variable, never the value", () => {
    write("docs/evidence/M7/staging-journey.txt", `GET /login\n  x-vercel-protection-bypass: ${BYPASS}\n`);
    write("apps/web/playwright-report-staging/summary.json", `{"error":"key ${RESEND}"}`);
    const { status, out } = guard([], { VERCEL_AUTOMATION_BYPASS_SECRET: BYPASS, E2E_RESEND_KEY: RESEND });
    expect(status).toBe(1);
    expect(out).toContain("docs/evidence/M7/staging-journey.txt holds the value of VERCEL_AUTOMATION_BYPASS_SECRET");
    expect(out).toContain("apps/web/playwright-report-staging/summary.json holds the value of E2E_RESEND_KEY");
    expect(out).not.toContain(BYPASS);
    expect(out).not.toContain(RESEND);
  });

  it("TST-4 scans the paths given as arguments too", () => {
    const extra = write("elsewhere/log.txt", `secret ${BYPASS}`);
    const { status, out } = guard([extra], { VERCEL_AUTOMATION_BYPASS_SECRET: BYPASS });
    expect(status).toBe(1);
    expect(out).toContain("log.txt holds the value of VERCEL_AUTOMATION_BYPASS_SECRET");
  });

  it.skipIf(!hasZip)("TST-4 looks inside zip files (traces)", () => {
    zipOf("apps/web/test-results/journey/trace.zip", `{"extraHTTPHeaders":{"x-vercel-protection-bypass":"${BYPASS}"}}`);
    const { status, out } = guard([], { VERCEL_AUTOMATION_BYPASS_SECRET: BYPASS });
    expect(status).toBe(1);
    expect(out).toContain("apps/web/test-results/journey/trace.zip (inside the archive) holds the value of VERCEL_AUTOMATION_BYPASS_SECRET");
    expect(out).not.toContain(BYPASS);
  });

  it.skipIf(!hasZip)("TST-4 looks inside the HTML report's embedded base64 zip", () => {
    const zip = zipOf("work/report.zip", `{"steps":[{"title":"bypass ${BYPASS}"}]}`);
    const base64 = execFileSync("base64", ["-w0", zip], { encoding: "utf8" }).trim();
    rmSync(zip);
    write("apps/web/playwright-report-staging/index.html", `<html><body><template id="playwrightReportBase64">data:application/zip;base64,${base64}</template></body></html>`);
    const { status, out } = guard([], { VERCEL_AUTOMATION_BYPASS_SECRET: BYPASS });
    expect(status).toBe(1);
    expect(out).toContain("apps/web/playwright-report-staging/index.html (inside the embedded report) holds the value of VERCEL_AUTOMATION_BYPASS_SECRET");
    expect(out).not.toContain(BYPASS);
  });

  it("TST-4 --run keeps the command's exit code when the output is clean, and fails a passing run that leaked", () => {
    expect(guard(["--run", "bash", "-c", "exit 3"], { VERCEL_AUTOMATION_BYPASS_SECRET: BYPASS }).status).toBe(3);
    expect(guard(["--run", "true"], { VERCEL_AUTOMATION_BYPASS_SECRET: BYPASS }).status).toBe(0);
    const leaked = guard(["--run", "bash", "-c", `mkdir -p apps/web/test-results && echo "${BYPASS}" > apps/web/test-results/out.txt`], { VERCEL_AUTOMATION_BYPASS_SECRET: BYPASS });
    expect(leaked.status).toBe(1);
    expect(leaked.out).toContain("apps/web/test-results/out.txt holds the value of VERCEL_AUTOMATION_BYPASS_SECRET");
  });

  it("TST-4 --run without a command is a usage error", () => {
    const { status, out } = guard(["--run"], {});
    expect(status).toBe(2);
    expect(out).toContain("usage");
  });
});
