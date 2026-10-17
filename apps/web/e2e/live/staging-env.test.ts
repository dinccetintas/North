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
  DRY_RUN_REASON,
  e2eAddress,
  evidenceDate,
  evidenceDir,
  isFencedPreview,
  JOURNEY_STEPS,
  missingStagingEnv,
  shotFileName,
  stagingEnvVerdict,
  tasksSettled,
} from "./staging-env";

const KEY = "re_secret_value_never_printed";
const FULL = { E2E_BASE_URL: "https://staging.north.example", E2E_MAIL_PROVIDER: "resend", E2E_RESEND_KEY: KEY, E2E_MAIL_DOMAIN: "staging.north.example" };

describe("TST-3 missingStagingEnv: every variable a staging run needs", () => {
  it("TST-3 lists all four on an empty env, in a fixed order", () => {
    expect(missingStagingEnv({})).toEqual(["E2E_BASE_URL", "E2E_MAIL_PROVIDER=resend", "E2E_RESEND_KEY", "E2E_MAIL_DOMAIN"]);
  });

  it("TST-3 counts blank values and the mailpit provider as missing", () => {
    expect(missingStagingEnv({ ...FULL, E2E_RESEND_KEY: "  ", E2E_MAIL_PROVIDER: "mailpit" })).toEqual(["E2E_MAIL_PROVIDER=resend", "E2E_RESEND_KEY"]);
  });

  it("TST-3 lists nothing when the env is complete", () => {
    expect(missingStagingEnv(FULL)).toEqual([]);
  });
});

describe("TST-3 stagingEnvVerdict: skip without staging, fail on a half-configured run", () => {
  it("TST-3 skips with the dry-run reason when E2E_BASE_URL is unset, naming the other missing variables", () => {
    const verdict = stagingEnvVerdict({});
    expect(verdict.kind).toBe("skip");
    expect(verdict.kind === "skip" && verdict.message).toBe(`${DRY_RUN_REASON}; also missing: E2E_MAIL_PROVIDER=resend, E2E_RESEND_KEY, E2E_MAIL_DOMAIN`);
    expect(DRY_RUN_REASON).toBe("E2E_BASE_URL not set: the live journey runs against staging only (docs/runbooks/staging.md §15)");
  });

  it("TST-3 skips with the reason alone when only E2E_BASE_URL is missing, and never echoes a value", () => {
    const verdict = stagingEnvVerdict({ ...FULL, E2E_BASE_URL: "" });
    expect(verdict).toEqual({ kind: "skip", message: DRY_RUN_REASON });
    expect(JSON.stringify(verdict)).not.toContain(KEY);
  });

  it("TST-3 fails when E2E_BASE_URL is set but another variable is missing, naming each", () => {
    const verdict = stagingEnvVerdict({ ...FULL, E2E_RESEND_KEY: undefined, E2E_MAIL_DOMAIN: "" });
    expect(verdict.kind).toBe("fail");
    expect(verdict.kind === "fail" && verdict.message).toMatch(/E2E_BASE_URL is set.*missing E2E_RESEND_KEY, E2E_MAIL_DOMAIN/);
  });

  it("TST-3 fails on an E2E_BASE_URL that is not an http(s) URL, naming the variable and not the key", () => {
    const verdict = stagingEnvVerdict({ ...FULL, E2E_BASE_URL: "staging.north.example" });
    expect(verdict.kind).toBe("fail");
    expect(verdict.kind === "fail" && verdict.message).toContain("E2E_BASE_URL");
    expect(JSON.stringify(verdict)).not.toContain(KEY);
  });

  it("TST-3 answers ok with the trimmed values, the domain lowercased and the base URL without a trailing slash", () => {
    expect(stagingEnvVerdict({ ...FULL, E2E_BASE_URL: " https://staging.north.example/ ", E2E_MAIL_DOMAIN: " Staging.North.Example " })).toEqual({
      kind: "ok",
      env: { baseUrl: "https://staging.north.example", mailDomain: "staging.north.example" },
    });
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
});
