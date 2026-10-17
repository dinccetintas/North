/**
 * TST-3: `playwright.staging.config.ts` as Playwright resolves it, with a
 * complete staging env: the bypass secret is nowhere in it (no header, no
 * context option: the browser starts from the primed cookie's storage state
 * only), the global setup and teardown that prime and remove that cookie are
 * wired, and a dry run has no storage state at all.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const SECRET = "bypass-secret-value-3d9f";
const STAGING = {
  E2E_BASE_URL: "https://staging.north.example",
  VERCEL_AUTOMATION_BYPASS_SECRET: SECRET,
  E2E_SUPABASE_URL: "https://stagingref.supabase.co",
  E2E_MAIL_PROVIDER: "resend",
  E2E_RESEND_KEY: "re_key_value_77",
  E2E_MAIL_DOMAIN: "staging.north.example",
};

/** The config module evaluated afresh under `env`. */
async function configUnder(env: Record<string, string>) {
  vi.resetModules();
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  return (await import("../../playwright.staging.config")).default;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("TST-3 the staging config never holds the bypass secret", () => {
  it("TST-3 a staging run starts both projects from the storage state, with no header and no secret anywhere", async () => {
    const config = await configUnder(STAGING);
    const text = JSON.stringify(config);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("x-vercel-protection-bypass");
    expect(config.use?.extraHTTPHeaders).toBeUndefined();
    expect(String(config.use?.storageState)).toMatch(/apps\/web\/test-results\/staging-storage-state\.json$/);
    expect(config.globalSetup).toBe("./e2e/global-setup.ts");
    expect(config.globalTeardown).toBe("./e2e/global-teardown.ts");
    expect(config.use?.trace).toBe("retain-on-failure");
  });

  it("TST-3 a dry run (no E2E_BASE_URL) has no storage state, so no file is needed", async () => {
    const config = await configUnder({ E2E_BASE_URL: "", VERCEL_AUTOMATION_BYPASS_SECRET: SECRET });
    expect(config.use?.storageState).toBeUndefined();
    expect(JSON.stringify(config)).not.toContain(SECRET);
  });
});
