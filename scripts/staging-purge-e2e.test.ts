/** STG-1: the pure parts of the staging e2e purge (`staging-purge-e2e.ts`): which users are e2e users, when the script refuses to run, its flags and its env; no stack, no network. */
import { describe, expect, it } from "vitest";
import { PurgeReasonSchema } from "@north/db";
import { E2E_PURGE_REASON, isE2eEmail, NOT_PRODUCTION_FLAG, parsePurgeArgs, purgeConfigFrom, purgeGuard, selectE2eUsers } from "./staging-purge-e2e";

const STAGING_REF = "stagingrefaaaaaaaaaa";
const PRODUCTION_REF = "prodrefbbbbbbbbbbbbb";
const STAGING = { NORTH_ENV: "staging", SUPABASE_URL: `https://${STAGING_REF}.supabase.co`, NORTH_PRODUCTION_SUPABASE_REF: PRODUCTION_REF };
const NO_FLAG = { notProduction: false };
const FLAG = { notProduction: true };

describe("STG-1 isE2eEmail without E2E_MAIL_DOMAIN: e2e-<anything>@staging.<domain>", () => {
  it("matches the per-run addresses of the live journey, in any case and with outer spaces", () => {
    expect(isE2eEmail("e2e-1760000000-chromium@staging.north.example")).toBe(true);
    expect(isE2eEmail("E2E-Run-7@Staging.Example.COM")).toBe(true);
    expect(isE2eEmail("  e2e-x@staging.example.com ")).toBe(true);
    expect(isE2eEmail("e2e-@staging.example.com")).toBe(true);
    expect(isE2eEmail("e2e-a+b.c@staging.example.co.uk")).toBe(true);
  });

  it("refuses the inbox itself, any other local part and any other host", () => {
    for (const email of [
      "e2e@staging.example.com",
      "x-e2e-1@staging.example.com",
      "e2e_1@staging.example.com",
      "smoke-m1-1@north.test",
      "founder@staging.example.com",
      "e2e-1@example.com",
      "e2e-1@notstaging.example.com",
      "e2e-1@foo.staging.example.com",
      "e2e-1@staging-example.com",
    ]) {
      expect(isE2eEmail(email), email).toBe(false);
    }
  });

  it("needs staging. followed by a domain of two labels or more (staging.com is somebody else's)", () => {
    for (const email of ["e2e-1@staging.com", "e2e-1@staging.", "e2e-1@staging", "e2e-1@staging..example.com", "e2e-1@staging.example.com."]) {
      expect(isE2eEmail(email), email).toBe(false);
    }
  });

  it("refuses anything that is not one plain address", () => {
    for (const email of ["", "e2e-1", "e2e-1@", "e2e 1@staging.example.com", "e2e-1@staging.example.com@staging.example.com", "e2e-1@staging.exa mple.com"]) {
      expect(isE2eEmail(email), email).toBe(false);
    }
  });
});

describe("STG-1 isE2eEmail with E2E_MAIL_DOMAIN", () => {
  const domain = "staging.north.example";

  it("matches only that exact host, in any case", () => {
    expect(isE2eEmail("e2e-1760000000-mobile@staging.north.example", domain)).toBe(true);
    expect(isE2eEmail("e2e-1@STAGING.NORTH.EXAMPLE", " Staging.North.Example ")).toBe(true);
    expect(isE2eEmail("e2e-1@staging.other.example", domain)).toBe(false);
    expect(isE2eEmail("e2e-1@sub.staging.north.example", domain)).toBe(false);
    expect(isE2eEmail("e2e@staging.north.example", domain)).toBe(false);
  });

  it("a domain that is not staging.<domain> matches nothing (fail closed)", () => {
    expect(isE2eEmail("e2e-1@north.example", "north.example")).toBe(false);
    expect(isE2eEmail("e2e-1@staging.com", "staging.com")).toBe(false);
    expect(isE2eEmail("e2e-1@staging.north.example", "*.north.example")).toBe(false);
  });

  it("a blank domain counts as unset", () => {
    expect(isE2eEmail("e2e-1@staging.example.com", "")).toBe(true);
    expect(isE2eEmail("e2e-1@staging.example.com", "   ")).toBe(true);
  });
});

describe("STG-1 selectE2eUsers", () => {
  it("keeps the e2e users with their address, skips users without one, and returns a frozen list", () => {
    const users = [
      { id: "00000000-0000-4000-8000-000000000001", email: "e2e-1-chromium@staging.north.example" },
      { id: "00000000-0000-4000-8000-000000000002", email: "founder@north.example" },
      { id: "00000000-0000-4000-8000-000000000003", email: null },
      { id: "00000000-0000-4000-8000-000000000004", email: "e2e-2-mobile@staging.north.example" },
    ];
    const selected = selectE2eUsers(users, "staging.north.example");
    expect(selected.map((u) => u.id)).toEqual(["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000004"]);
    expect(Object.isFrozen(selected)).toBe(true);
    expect(users).toHaveLength(4);
  });
});

describe("STG-1 purgeGuard", () => {
  it("allows NORTH_ENV=staging on a Supabase URL that does not name the production ref", () => {
    expect(purgeGuard(STAGING, NO_FLAG)).toEqual({ ok: true, problems: [] });
  });

  it("refuses unless NORTH_ENV is exactly staging", () => {
    for (const value of [undefined, "", "production", "Staging", " staging"]) {
      const verdict = purgeGuard({ ...STAGING, NORTH_ENV: value }, FLAG);
      expect(verdict.ok, String(value)).toBe(false);
      expect(verdict.problems.join(" ")).toMatch(/NORTH_ENV/);
    }
  });

  it("refuses a Supabase URL that contains the production ref anywhere, in any case", () => {
    for (const url of [`https://${PRODUCTION_REF}.supabase.co`, `https://${PRODUCTION_REF.toUpperCase()}.supabase.co`, `https://proxy.example/${PRODUCTION_REF}`]) {
      const verdict = purgeGuard({ ...STAGING, SUPABASE_URL: url }, NO_FLAG);
      expect(verdict.ok, url).toBe(false);
      expect(verdict.problems.join(" ")).toMatch(/production project/);
    }
  });

  it("without NORTH_PRODUCTION_SUPABASE_REF it refuses unless the operator passes the flag (fail closed); a blank ref is unset", () => {
    for (const ref of [undefined, "", "   "]) {
      const refused = purgeGuard({ ...STAGING, NORTH_PRODUCTION_SUPABASE_REF: ref }, NO_FLAG);
      expect(refused.ok).toBe(false);
      expect(refused.problems.join(" ")).toContain(NOT_PRODUCTION_FLAG);
      expect(purgeGuard({ ...STAGING, NORTH_PRODUCTION_SUPABASE_REF: ref }, FLAG)).toEqual({ ok: true, problems: [] });
    }
  });

  it("the flag never overrides a production ref the URL contains", () => {
    expect(purgeGuard({ ...STAGING, SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co` }, FLAG).ok).toBe(false);
  });

  it("refuses a malformed production ref instead of guessing", () => {
    for (const ref of ["prod ref", "https://x.supabase.co", "ab"]) {
      const verdict = purgeGuard({ ...STAGING, NORTH_PRODUCTION_SUPABASE_REF: ref }, FLAG);
      expect(verdict.ok, ref).toBe(false);
      expect(verdict.problems.join(" ")).toMatch(/NORTH_PRODUCTION_SUPABASE_REF/);
    }
  });

  it("refuses a missing or non-http SUPABASE_URL, and lists every problem at once", () => {
    const verdict = purgeGuard({ NORTH_ENV: "production", SUPABASE_URL: "ftp://x.example", NORTH_PRODUCTION_SUPABASE_REF: PRODUCTION_REF }, NO_FLAG);
    expect(verdict.ok).toBe(false);
    expect(verdict.problems).toHaveLength(2);
    expect(purgeGuard({ ...STAGING, SUPABASE_URL: undefined }, NO_FLAG).problems.join(" ")).toMatch(/SUPABASE_URL/);
  });
});

describe("STG-1 parsePurgeArgs", () => {
  it("reads --yes and the not-production flag; a bare -- (pnpm's) is ignored; the default is a dry run", () => {
    expect(parsePurgeArgs([])).toEqual({ yes: false, notProduction: false });
    expect(parsePurgeArgs(["--", "--yes"])).toEqual({ yes: true, notProduction: false });
    expect(parsePurgeArgs([NOT_PRODUCTION_FLAG, "--yes"])).toEqual({ yes: true, notProduction: true });
  });

  it("an unknown flag or a positional is a usage error", () => {
    expect(() => parsePurgeArgs(["--force"])).toThrow();
    expect(() => parsePurgeArgs(["yes"])).toThrow();
  });
});

describe("STG-1 purgeConfigFrom", () => {
  const env = { SUPABASE_URL: `https://${STAGING_REF}.supabase.co`, SUPABASE_SERVICE_ROLE_KEY: "service-role-key-0123" };

  it("reads the service client, the mail domain (lowercase, blank = unset) and the workspace root", () => {
    expect(purgeConfigFrom(env)).toEqual({ supabaseUrl: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY, mailDomain: null, workspaceRoot: null });
    expect(purgeConfigFrom({ ...env, E2E_MAIL_DOMAIN: " Staging.North.Example ", WORKSPACE_ROOT: "/data/workspaces" })).toMatchObject({ mailDomain: "staging.north.example", workspaceRoot: "/data/workspaces" });
    expect(purgeConfigFrom({ ...env, E2E_MAIL_DOMAIN: "" }).mailDomain).toBeNull();
  });

  it("refuses a missing service role key and a mail domain that is not staging.<domain>, naming the variable", () => {
    expect(() => purgeConfigFrom({ SUPABASE_URL: env.SUPABASE_URL })).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(() => purgeConfigFrom({ ...env, E2E_MAIL_DOMAIN: "north.example" })).toThrow(/E2E_MAIL_DOMAIN/);
  });

  it("purges with the reason label e2e, which purge_owner accepts", () => {
    expect(PurgeReasonSchema.parse(E2E_PURGE_REASON)).toBe("e2e");
  });
});
