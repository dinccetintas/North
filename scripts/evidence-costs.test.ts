/** TST-4: the pure parts of `evidence-costs.ts`: the plan from flags and env, the redacted `run.json` summary and its schema; no database, no network. */
import { describe, expect, it } from "vitest";
import { assertRedacted, evidenceCostsPlan, idHash, RunJsonSchema, summariseEvidence, type EvidenceRun, type EvidenceTask } from "./evidence-costs-helpers";

const COMPANY_ID = "6f1c2a4e-9b7d-4c3e-8a21-0d5e6f7a8b9c";
const TASK_A = "11111111-1111-4111-8111-111111111111";
const TASK_B = "22222222-2222-4222-8222-222222222222";
const SHA = "a99382a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6";
const SERVICE_KEY = "service-role-secret-never-printed";
const LOCAL = { SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY };
const NOW = new Date("2026-10-17T21:00:00.000Z");

const run = (taskId: string | null, model: string, costUsd: number, extra: Partial<EvidenceRun> = {}): EvidenceRun => ({ taskId, model, runtime: "claude-agent-sdk", inputTokens: 1000, outputTokens: 200, costUsd, durationMs: 4000, ...extra });
const TASKS: readonly EvidenceTask[] = Object.freeze([
  { id: TASK_A, taskType: "market_report", status: "done" },
  { id: TASK_B, taskType: "personas", status: "failed" },
]);

describe("TST-4 summariseEvidence: per-task model, tokens and cost, the total, no ids", () => {
  it("TST-4 sums each task's runs and the company's total, and hashes the company id", () => {
    const runs = [run(TASK_A, "claude-sonnet-5-5", 0.1), run(TASK_A, "claude-haiku-5-5", 0.02, { inputTokens: 50, outputTokens: 5, durationMs: 100 }), run(TASK_B, "claude-sonnet-5-5", 0.2), run(null, "claude-haiku-5-5", 0.01)];
    const summary = summariseEvidence(runs, TASKS, SHA, "smoke", { slug: "e2e-journey-kz3-mobile", id: COMPANY_ID });
    expect(summary).toEqual({
      sha: SHA,
      profile: "smoke",
      company: { slug: "e2e-journey-kz3-mobile", idHash: idHash(COMPANY_ID) },
      tasks: [
        { taskType: "market_report", status: "done", model: "claude-sonnet-5-5, claude-haiku-5-5", inputTokens: 1050, outputTokens: 205, costUsd: 0.12, durationMs: 4100 },
        { taskType: "personas", status: "failed", model: "claude-sonnet-5-5", inputTokens: 1000, outputTokens: 200, costUsd: 0.2, durationMs: 4000 },
      ],
      totalCostUsd: 0.33,
      redacted: true,
    });
    expect(idHash(COMPANY_ID)).toMatch(/^[0-9a-f]{12}$/);
    expect(RunJsonSchema.parse(summary)).toEqual(summary);
  });

  it("TST-4 writes no task id, company id or email, and keeps a null profile", () => {
    const summary = summariseEvidence([run(TASK_A, "claude-sonnet-5-5", 0.1)], TASKS, SHA, null, { slug: "e2e-journey-kz3-desktop", id: COMPANY_ID });
    const text = JSON.stringify(summary);
    for (const secret of [TASK_A, TASK_B, COMPANY_ID]) expect(text).not.toContain(secret);
    expect(summary.profile).toBeNull();
    expect(summary.tasks[1]).toMatchObject({ taskType: "personas", model: "none", costUsd: 0 });
  });

  it("TST-4 leaves its inputs alone", () => {
    const runs = Object.freeze([Object.freeze(run(TASK_A, "claude-sonnet-5-5", 0.1))]);
    expect(() => summariseEvidence(runs, TASKS, SHA, "smoke", { slug: "e2e-co", id: COMPANY_ID })).not.toThrow();
  });
});

describe("TST-4 assertRedacted and RunJsonSchema: the file carries no id and no address", () => {
  it("TST-4 refuses a uuid or an email anywhere in the file", () => {
    expect(() => assertRedacted({ note: `task ${TASK_A}` })).toThrow(/uuid/);
    expect(() => assertRedacted({ note: "e2e-kz3-mobile@staging.north.example" })).toThrow(/email/);
    expect(() => assertRedacted({ ok: "claude-sonnet-5-5 · market_report" })).not.toThrow();
  });

  it("TST-4 refuses redacted: false, a bad hash and a negative cost", () => {
    const good = summariseEvidence([], TASKS, SHA, "smoke", { slug: "e2e-co", id: COMPANY_ID });
    expect(RunJsonSchema.safeParse({ ...good, redacted: false }).success).toBe(false);
    expect(RunJsonSchema.safeParse({ ...good, company: { slug: "e2e-co", idHash: COMPANY_ID } }).success).toBe(false);
    expect(RunJsonSchema.safeParse({ ...good, totalCostUsd: -1 }).success).toBe(false);
  });
});

describe("TST-4 evidenceCostsPlan: flags and env", () => {
  it("TST-4 reads --slug and --out, and the default out is the dated acceptance directory", () => {
    expect(evidenceCostsPlan(LOCAL, ["--", "--slug", "e2e-journey-kz3-mobile"], NOW)).toMatchObject({ slug: "e2e-journey-kz3-mobile", outDir: "docs/evidence/M7/acceptance/2026-10-17", workerUrl: null, sha: null });
    expect(evidenceCostsPlan({ ...LOCAL, E2E_EVIDENCE_DATE: "2026-10-20" }, ["--slug", "e2e-co"], NOW).outDir).toBe("docs/evidence/M7/acceptance/2026-10-20");
    expect(evidenceCostsPlan(LOCAL, ["--slug", "e2e-co", "--out", "/tmp/ev"], NOW).outDir).toBe("/tmp/ev");
  });

  it("TST-4 falls back to EVIDENCE_COMPANY_SLUG, reads EVIDENCE_WORKER_URL and the sha from EVIDENCE_SHA or GITHUB_SHA", () => {
    const plan = evidenceCostsPlan({ ...LOCAL, EVIDENCE_COMPANY_SLUG: "from-env", EVIDENCE_WORKER_URL: "https://north-worker-staging.fly.dev/", GITHUB_SHA: SHA }, [], NOW);
    expect(plan).toMatchObject({ slug: "from-env", workerUrl: "https://north-worker-staging.fly.dev", sha: SHA });
  });

  it("TST-4 needs a slug and both Supabase variables, naming each and never the key", () => {
    expect(() => evidenceCostsPlan(LOCAL, [], NOW)).toThrow(/--slug .*EVIDENCE_COMPANY_SLUG/);
    const error = (() => {
      try {
        evidenceCostsPlan({ SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY }, ["--slug", "e2e-co"], NOW);
        return null;
      } catch (e) {
        return e as Error;
      }
    })();
    expect(error?.message).toContain("SUPABASE_URL");
    expect(error?.message).not.toContain(SERVICE_KEY);
    expect(() => evidenceCostsPlan({ SUPABASE_URL: LOCAL.SUPABASE_URL }, ["--slug", "e2e-co"], NOW)).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("TST-4 refuses a database that is not this machine unless EVIDENCE_ALLOW_REMOTE_DB=1", () => {
    const remote = { ...LOCAL, SUPABASE_URL: "https://stagingref.supabase.co" };
    expect(() => evidenceCostsPlan(remote, ["--slug", "e2e-co"], NOW)).toThrow(/stagingref\.supabase\.co.*EVIDENCE_ALLOW_REMOTE_DB=1/);
    expect(evidenceCostsPlan({ ...remote, EVIDENCE_ALLOW_REMOTE_DB: "1" }, ["--slug", "e2e-co"], NOW).supabaseUrl).toBe("https://stagingref.supabase.co");
  });

  it("TST-4 refuses unknown flags and a bad slug", () => {
    expect(() => evidenceCostsPlan(LOCAL, ["--slug", "e2e-co", "--yes"], NOW)).toThrow(/evidence costs usage/);
    expect(() => evidenceCostsPlan(LOCAL, ["--slug", "Not A Slug"], NOW)).toThrow(/slug/);
  });
});
