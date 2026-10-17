/**
 * TST-3, TST-4: the pure rules of the live journey (`staging-env.ts`, used by
 * `helpers.ts`, the spec and `playwright.staging.config.ts`): which variables
 * a staging run needs and what a run without them says, where the evidence
 * goes, the per-run address, the fence on the preview host, when the
 * onboarding tasks count as settled and the timing assertion. No browser.
 */
import { describe, expect, it } from "vitest";
import {
  assertWithin,
  BYPASS_HEADER,
  DRY_RUN_REASON,
  e2eAddress,
  evidenceDate,
  evidenceDir,
  isFencedPreview,
  isStagingRequest,
  JOURNEY_STEPS,
  JOURNEY_TIMEOUT_MS,
  missingStagingEnv,
  OTHER_STEPS_MS,
  shotFileName,
  stagingEnvVerdict,
  STEP_BUDGET_MS,
  tasksSettled,
} from "./staging-env";

const KEY = "re_secret_value_never_printed";
const BYPASS = "bypass_secret_value_never_printed";
const FULL = {
  E2E_BASE_URL: "https://staging.north.example",
  VERCEL_AUTOMATION_BYPASS_SECRET: BYPASS,
  E2E_SUPABASE_URL: "https://stagingref.supabase.co",
  E2E_MAIL_PROVIDER: "resend",
  E2E_RESEND_KEY: KEY,
  E2E_MAIL_DOMAIN: "staging.north.example",
};

describe("TST-3 missingStagingEnv: every variable a staging run needs", () => {
  it("TST-3 lists all six on an empty env, in a fixed order", () => {
    expect(missingStagingEnv({})).toEqual(["E2E_BASE_URL", "VERCEL_AUTOMATION_BYPASS_SECRET", "E2E_SUPABASE_URL", "E2E_MAIL_PROVIDER=resend", "E2E_RESEND_KEY", "E2E_MAIL_DOMAIN"]);
  });

  it("TST-3 counts blank values and the mailpit provider as missing", () => {
    expect(missingStagingEnv({ ...FULL, E2E_RESEND_KEY: "  ", E2E_MAIL_PROVIDER: "mailpit" })).toEqual(["E2E_MAIL_PROVIDER=resend", "E2E_RESEND_KEY"]);
  });

  it("TST-3 needs the bypass secret for an https base URL only", () => {
    expect(missingStagingEnv({ ...FULL, VERCEL_AUTOMATION_BYPASS_SECRET: "" })).toEqual(["VERCEL_AUTOMATION_BYPASS_SECRET"]);
    expect(missingStagingEnv({ ...FULL, E2E_BASE_URL: "http://localhost:3100", VERCEL_AUTOMATION_BYPASS_SECRET: undefined })).toEqual([]);
  });

  it("TST-3 accepts NEXT_PUBLIC_SUPABASE_URL for the Supabase project", () => {
    expect(missingStagingEnv({ ...FULL, E2E_SUPABASE_URL: undefined, NEXT_PUBLIC_SUPABASE_URL: "https://stagingref.supabase.co" })).toEqual([]);
  });

  it("TST-3 lists nothing when the env is complete", () => {
    expect(missingStagingEnv(FULL)).toEqual([]);
  });
});

describe("TST-3 stagingEnvVerdict: skip without staging, fail on a half-configured run", () => {
  it("TST-3 skips with the dry-run reason when E2E_BASE_URL is unset, naming the other missing variables", () => {
    const verdict = stagingEnvVerdict({});
    expect(verdict.kind).toBe("skip");
    expect(verdict.kind === "skip" && verdict.message).toBe(
      `${DRY_RUN_REASON}; also missing: VERCEL_AUTOMATION_BYPASS_SECRET, E2E_SUPABASE_URL, E2E_MAIL_PROVIDER=resend, E2E_RESEND_KEY, E2E_MAIL_DOMAIN`,
    );
    expect(DRY_RUN_REASON).toBe("E2E_BASE_URL not set: the live journey runs against staging only (docs/runbooks/staging.md §15)");
  });

  it("TST-3 skips with the reason alone when only E2E_BASE_URL is missing, and never echoes a value", () => {
    const verdict = stagingEnvVerdict({ ...FULL, E2E_BASE_URL: "" });
    expect(verdict).toEqual({ kind: "skip", message: DRY_RUN_REASON });
    expect(JSON.stringify(verdict)).not.toContain(KEY);
    expect(JSON.stringify(verdict)).not.toContain(BYPASS);
  });

  it("TST-3 fails when E2E_BASE_URL is set but another variable is missing, naming each", () => {
    const verdict = stagingEnvVerdict({ ...FULL, E2E_RESEND_KEY: undefined, E2E_MAIL_DOMAIN: "", VERCEL_AUTOMATION_BYPASS_SECRET: " " });
    expect(verdict.kind).toBe("fail");
    expect(verdict.kind === "fail" && verdict.message).toMatch(/E2E_BASE_URL is set.*missing VERCEL_AUTOMATION_BYPASS_SECRET, E2E_RESEND_KEY, E2E_MAIL_DOMAIN/);
  });

  it("TST-3 fails on an E2E_BASE_URL or E2E_SUPABASE_URL that is not an http(s) URL, naming the variable and no value", () => {
    for (const [name, env] of [
      ["E2E_BASE_URL", { ...FULL, E2E_BASE_URL: "staging.north.example" }],
      ["E2E_SUPABASE_URL", { ...FULL, E2E_SUPABASE_URL: "stagingref.supabase.co" }],
    ] as const) {
      const verdict = stagingEnvVerdict(env);
      expect(verdict.kind).toBe("fail");
      expect(verdict.kind === "fail" && verdict.message).toContain(name);
      expect(JSON.stringify(verdict)).not.toContain(KEY);
      expect(JSON.stringify(verdict)).not.toContain(BYPASS);
    }
  });

  it("TST-3 answers ok with the trimmed values (no secret among them), the domain lowercased and the URLs without a trailing slash", () => {
    const verdict = stagingEnvVerdict({ ...FULL, E2E_BASE_URL: " https://staging.north.example/ ", E2E_MAIL_DOMAIN: " Staging.North.Example ", E2E_SUPABASE_URL: "https://stagingref.supabase.co/" });
    expect(verdict).toEqual({
      kind: "ok",
      env: { baseUrl: "https://staging.north.example", mailDomain: "staging.north.example", supabaseUrl: "https://stagingref.supabase.co" },
    });
    expect(JSON.stringify(verdict)).not.toContain(BYPASS);
  });
});

describe("TST-5 isStagingRequest: the bypass header goes to the staging origin only", () => {
  const BASE = "https://staging.north.example";

  it("TST-5 is true for any path and query on the staging origin", () => {
    expect(isStagingRequest("https://staging.north.example/login", BASE)).toBe(true);
    expect(isStagingRequest("https://staging.north.example/c/x/artifacts/1?y=2", `${BASE}/`)).toBe(true);
    expect(BYPASS_HEADER).toBe("x-vercel-protection-bypass");
  });

  it("TST-5 is false for Supabase, a sub- or look-alike domain, another scheme or port, and garbage", () => {
    for (const url of [
      "https://stagingref.supabase.co/auth/v1/verify?token=x",
      "https://evil.staging.north.example/",
      "https://staging.north.example.evil.com/",
      "http://staging.north.example/",
      "https://staging.north.example:8443/",
      "https://o1.ingest.sentry.io/api/1/envelope/",
      "not a url",
    ]) {
      expect(isStagingRequest(url, BASE), url).toBe(false);
    }
    expect(isStagingRequest("https://staging.north.example/", "not a url")).toBe(false);
  });
});

describe("TST-3 the step budgets end before the test timeout, so a wait names its step", () => {
  it("TST-3 tasks + plan + planned cards + the other steps stay below the 30 min test timeout", () => {
    const sum = STEP_BUDGET_MS.tasks + STEP_BUDGET_MS.plan + STEP_BUDGET_MS.plannedCards + OTHER_STEPS_MS;
    expect(JOURNEY_TIMEOUT_MS).toBe(30 * 60_000);
    expect(sum).toBeLessThan(JOURNEY_TIMEOUT_MS);
  });
});

describe("TST-4 evidence: the dated directory and the per-step file names", () => {
  const NOW = new Date("2026-10-17T23:30:00.000Z");

  it("TST-4 reads E2E_EVIDENCE_DATE, else the UTC day of now", () => {
    expect(evidenceDate({ E2E_EVIDENCE_DATE: "2026-10-20" }, NOW)).toBe("2026-10-20");
    expect(evidenceDate({ E2E_EVIDENCE_DATE: " " }, NOW)).toBe("2026-10-17");
    expect(evidenceDate({}, NOW)).toBe("2026-10-17");
  });

  it("TST-4 refuses an E2E_EVIDENCE_DATE that is not YYYY-MM-DD, naming the variable", () => {
    expect(() => evidenceDate({ E2E_EVIDENCE_DATE: "17.10.2026" }, NOW)).toThrow(/E2E_EVIDENCE_DATE/);
    expect(() => evidenceDate({ E2E_EVIDENCE_DATE: "2026-13-40" }, NOW)).toThrow(/E2E_EVIDENCE_DATE/);
  });

  it("TST-4 puts the evidence under docs/evidence/M7/acceptance/<date> of the repo root", () => {
    expect(evidenceDir("2026-10-17", "/repo")).toBe("/repo/docs/evidence/M7/acceptance/2026-10-17");
  });

  it("TST-4 refuses a date that could leave the evidence directory", () => {
    expect(() => evidenceDir("../../etc", "/repo")).toThrow(/YYYY-MM-DD/);
  });

  it("TST-4 numbers each step by its place in the journey: <nn>-<step>-<project>.png", () => {
    expect(shotFileName("signed-in", "mobile")).toBe("01-signed-in-mobile.png");
    expect(shotFileName("kill-switch", "desktop")).toBe(`${String(JOURNEY_STEPS.length).padStart(2, "0")}-kill-switch-desktop.png`);
    expect(new Set(JOURNEY_STEPS).size).toBe(JOURNEY_STEPS.length);
  });

  it("TST-4 refuses a step the journey does not know", () => {
    expect(() => shotFileName("made-up", "mobile")).toThrow(/unknown journey step "made-up"/);
  });
});

describe("TST-3 e2eAddress and isFencedPreview", () => {
  it("TST-3 builds e2e-<stamp>-<project>@<domain> in lowercase (the purge's shape)", () => {
    expect(e2eAddress("kz3abc", "Mobile", "Staging.North.Example")).toBe("e2e-kz3abc-mobile@staging.north.example");
  });

  it("TST-5 accepts only an https preview whose host starts with the e2e- fence prefix", () => {
    expect(isFencedPreview("https://e2e-cold-hive-k2x9-north-team.vercel.app/")).toBe(true);
    expect(isFencedPreview("https://north-cold-hive.vercel.app/")).toBe(false);
    expect(isFencedPreview("http://e2e-cold-hive.vercel.app/")).toBe(false);
    expect(isFencedPreview("https://x.example/e2e-cold-hive")).toBe(false);
    expect(isFencedPreview("not a url")).toBe(false);
  });
});

describe("TST-3 tasksSettled: all six onboarding tasks in one of the statuses", () => {
  const rows = (statuses: string[]) => statuses.map((status, i) => ({ taskType: `t${i}`, status }));

  it("TST-3 is true only with the expected count, every one settled", () => {
    expect(tasksSettled(rows(["done", "done", "failed", "done", "done", "done"]), ["done", "failed"], 6)).toBe(true);
    expect(tasksSettled(rows(["done", "running", "done", "done", "done", "done"]), ["done", "failed"], 6)).toBe(false);
    expect(tasksSettled(rows(["done", "done"]), ["done", "failed"], 6)).toBe(false);
  });
});

describe("TST-3 assertWithin: an assertion that must hold within a time limit", () => {
  it("TST-3 resolves with the elapsed milliseconds when the assertion holds in time", async () => {
    const elapsed = await assertWithin(1000, async () => undefined, "fast");
    expect(elapsed).toBeGreaterThanOrEqual(0);
    expect(elapsed).toBeLessThan(1000);
  });

  it("TST-3 rejects naming the label and the limit when the assertion is slower", async () => {
    await expect(assertWithin(20, () => new Promise((r) => setTimeout(r, 200)), "the paused state")).rejects.toThrow("the paused state did not hold within 20 ms");
  });

  it("TST-3 rejects with the assertion's own error, prefixed with the label", async () => {
    await expect(
      assertWithin(1000, async () => {
        throw new Error("expected Resume agents");
      }, "the kill switch"),
    ).rejects.toThrow("the kill switch: expected Resume agents");
  });

  it("TST-3 leaves no unhandled rejection when a slow assertion fails after the limit", async () => {
    const late = () => new Promise<never>((_, reject) => setTimeout(() => reject(new Error("late failure")), 30));
    await expect(assertWithin(5, late, "the slow one")).rejects.toThrow("the slow one did not hold within 5 ms");
    await new Promise((r) => setTimeout(r, 60));
  });
});
