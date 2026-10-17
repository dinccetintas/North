/** STG-1, TST-5: the production check's env-dependent worker and web health rules, end to end against a fake fetch (moved out of `production-check.test.ts`); no network. */
import { describe, expect, it } from "vitest";
import { configFrom, report, runChecks, type CheckConfig, type CheckResult } from "./production-check";
import { ANON, check, config, fake, green, healthyWorker, introspection, NOW, stagingWorker, SUPABASE, WEB, WORKER } from "./production-check-fixtures";

const workerRoute = `GET ${WORKER}/health`;
const webHealthRoute = `GET ${WEB}/api/health`;
const urlEnv = { NORTH_WEB_URL: WEB, NORTH_WORKER_URL: WORKER, NEXT_PUBLIC_SUPABASE_URL: SUPABASE, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ANON };
/** The worker-health check against one health line, in one env. */
const workerCheck = (line: object, env: CheckConfig["env"] = "production"): Promise<CheckResult> => check("worker-health", { [workerRoute]: { json: line } }, { env });
const failing = (part: string) => ({ status: "fail", detail: expect.stringContaining(part) });

describe("STG-1 staging check", () => {
  it("a staging line with the fence off fails, and the message names the fence", async () => {
    const result = await workerCheck({ ...stagingWorker, fence: false }, "staging");
    expect(result).toMatchObject(failing("fence is false"));
    expect(result.detail).toContain("NORTH_TEST_FENCE=1");
  });

  it("fence on, env staging, the smoke profile and a recording gateway pass, with what it found in the detail", async () => {
    const result = await workerCheck({ ...stagingWorker, profile: "smoke", fence: true, env: "staging", gateway: "record" }, "staging");
    expect(result).toMatchObject({ id: "worker-health", status: "pass" });
    expect(result.detail).toBe("mode live, runtime claude-agent-sdk, webhooks stripe on, sentry on, clock = wall, profile smoke, fence on, gateway record, env staging");
  });

  it("any of the three profiles passes in staging; a gateway that replays, a production env or a missing budget on the SDK runtime fails", async () => {
    for (const profile of ["production", "staging", "smoke"]) expect((await workerCheck({ ...stagingWorker, profile }, "staging")).status).toBe("pass");
    expect(await workerCheck({ ...stagingWorker, gateway: "replay" }, "staging")).toMatchObject(failing('gateway is "replay"'));
    expect(await workerCheck({ ...stagingWorker, env: "production" }, "staging")).toMatchObject(failing('env is "production"'));
    expect(await workerCheck({ ...stagingWorker, budget: null }, "staging")).toMatchObject(failing("budget"));
  });

  it("the production worker fails the staging check, and every failure is in the detail at once", async () => {
    const result = await workerCheck({ ...healthyWorker, clockIsWall: false }, "staging");
    expect(result.status).toBe("fail");
    for (const part of ["not the wall clock", "fence is false", 'env is "production"']) expect(result.detail).toContain(part);
  });

  it("every other check runs unchanged in staging: the same requests, green against a staging deployment, named in the report", async () => {
    const asProduction = fake(green());
    const asStaging = fake({ ...green(), [workerRoute]: { json: stagingWorker } });
    await runChecks(config(), asProduction.fetch);
    const results = await runChecks(config({ env: "staging" }), asStaging.fetch);
    expect(asStaging.calls.map((c) => `${c.method} ${c.url}`)).toEqual(asProduction.calls.map((c) => `${c.method} ${c.url}`));
    expect(results.map((r) => r.id)).toEqual(["web-health", "worker-health", "worker-no-sandbox", "anon-companies", "storage-artifacts", "storage-exports", "pwa-manifest", "pwa-service-worker", "inngest-web", "inngest-worker", "stripe-webhook", "usage-ratios"]);
    expect(results.filter((r) => r.status !== "pass")).toEqual([]);
    expect(report(config({ env: "staging" }), results, false)).toContain("staging check: green");
    expect((await check("worker-no-sandbox", { [`GET ${WORKER}/sandbox/clock`]: { status: 403, json: {} } }, { env: "staging" })).status).toBe("fail");
    expect((await check("anon-companies", { [`GET ${SUPABASE}/rest/v1/companies?select=id&limit=1`]: { json: [{ id: "c1" }] } }, { env: "staging" })).status).toBe("fail");
    expect((await check("inngest-worker", { [`GET ${WORKER}/api/inngest`]: { json: { ...introspection, mode: "dev" } } }, { env: "staging" })).status).toBe("fail");
  });

  it("a failed staging report names the env, and the JSON carries it", async () => {
    const results = await runChecks(config({ env: "staging" }), fake({ ...green(), [workerRoute]: { json: { ...stagingWorker, fence: false } } }).fetch);
    expect(report(config({ env: "staging" }), results, false)).toContain("staging check: 1 failed");
    expect(JSON.parse(report(config({ env: "staging" }), results, true))).toMatchObject({ env: "staging", ok: false });
  });

  it("--env staging, --env=staging and NORTH_CHECK_ENV=staging select staging; the flag wins; production is the default and a blank variable is unset", () => {
    expect(configFrom(["--env", "staging"], urlEnv, NOW).env).toBe("staging");
    expect(configFrom(["--env=staging"], urlEnv, NOW).env).toBe("staging");
    expect(configFrom([], { ...urlEnv, NORTH_CHECK_ENV: " staging " }, NOW).env).toBe("staging");
    expect(configFrom(["--env", "production"], { ...urlEnv, NORTH_CHECK_ENV: "staging" }, NOW).env).toBe("production");
    expect(configFrom(["--env", "staging"], { ...urlEnv, NORTH_CHECK_ENV: "nonsense" }, NOW).env).toBe("staging");
    expect(configFrom([], urlEnv, NOW).env).toBe("production");
    expect(configFrom([], { ...urlEnv, NORTH_CHECK_ENV: "  " }, NOW).env).toBe("production");
  });
});

describe("TST-5 production check", () => {
  it("a fence that is on fails in production, naming the fence", async () => {
    expect(await workerCheck({ ...healthyWorker, fence: true })).toMatchObject(failing("fence is true"));
  });

  it("a staging profile, a staging env or a recording gateway fails in production", async () => {
    for (const [field, value] of [["profile", "smoke"], ["env", "staging"], ["gateway", "record"]] as const) expect(await workerCheck({ ...healthyWorker, [field]: value })).toMatchObject(failing(`${field} is "${value}"`));
  });

  it("a gateway that replays fails in production and in staging", async () => {
    expect(await workerCheck({ ...healthyWorker, gateway: "replay" })).toMatchObject(failing('gateway is "replay"'));
    expect(await workerCheck({ ...stagingWorker, gateway: "replay" }, "staging")).toMatchObject(failing('gateway is "replay"'));
  });

  it("a live worker that cannot verify unsubscribe links fails in both envs; a sandbox worker is not asked", async () => {
    for (const [env, line] of [["production", healthyWorker], ["staging", stagingWorker]] as const) {
      const live = await workerCheck({ ...line, mode: "live", unsubscribe: false }, env);
      expect(live).toMatchObject(failing("unsubscribe is false"));
      expect(live.detail).toContain("UNSUBSCRIBE_SECRET");
      expect((await workerCheck({ ...line, mode: "sandbox", unsubscribe: false }, env)).status).toBe("pass");
    }
  });

  it("a spent day's budget fails in production and is read, not failed, in staging", async () => {
    const spent = { capUsd: 0.5, spentUsd: 0.5, unpriced: 0, exhausted: true };
    expect(await workerCheck({ ...healthyWorker, runtime: "claude-agent-sdk", gateway: "live", budget: spent })).toMatchObject(failing("budget"));
    expect((await workerCheck({ ...healthyWorker, gateway: "live", budget: { ...spent, exhausted: false } })).status).toBe("pass");
    expect((await workerCheck({ ...stagingWorker, budget: spent }, "staging")).status).toBe("pass");
  });

  it("a worker older than this check (no profile, fence, gateway, env) fails, saying so", async () => {
    const result = await workerCheck({ ok: true, app: "north-worker", mode: "sandbox", runtime: "mock", webhooks: { stripe: true }, clockIsWall: true });
    expect(result.status).toBe("fail");
    for (const field of ["profile", "fence", "gateway", "env"]) expect(result.detail).toContain(`${field} is missing`);
    expect(result.detail).toContain("older than this check");
  });

  it("the web must not call the model: llm live fails and a missing llm fails as older than this check, in both envs", async () => {
    for (const env of ["production", "staging"] as const) {
      expect(await check("web-health", { [webHealthRoute]: { json: { ok: true, app: "north-web", llm: "live" } } }, { env })).toMatchObject(failing('llm is "live"'));
      const older = await check("web-health", { [webHealthRoute]: { json: { ok: true, app: "north-web", time: NOW.toISOString() } } }, { env });
      expect(older).toMatchObject(failing("older than this check"));
      expect(older.detail).toContain("llm");
      expect((await check("web-health", {}, { env })).status).toBe("pass");
    }
  });

  it("--env nonsense is a usage error naming the flag, the value and the two envs; so is a nonsense NORTH_CHECK_ENV or a second --env", () => {
    expect(() => configFrom(["--env", "nonsense"], urlEnv, NOW)).toThrow(/--env.*nonsense.*production.*staging/s);
    for (const value of ["Staging", ""]) expect(() => configFrom(["--env", value], urlEnv, NOW)).toThrow(/--env/);
    expect(() => configFrom([], { ...urlEnv, NORTH_CHECK_ENV: "nonsense" }, NOW)).toThrow(/NORTH_CHECK_ENV.*nonsense.*production.*staging/s);
    expect(() => configFrom(["--env"], urlEnv, NOW)).toThrow();
    expect(() => configFrom(["--env", "staging", "--env", "production"], urlEnv, NOW)).toThrow(/--env.*once/);
  });
});
