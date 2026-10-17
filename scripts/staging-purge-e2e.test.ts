/** STG-1: the pure parts of the staging e2e purge (`staging-purge-e2e.ts`): which users are e2e users and old enough, when the script refuses to run, its flags and its env; no stack, no network. */
import { describe, expect, it } from "vitest";
import { PurgeReasonSchema } from "@north/db";
import { DEFAULT_OLDER_THAN_MINUTES, E2E_PURGE_REASON, isE2eEmail, NOT_PRODUCTION_FLAG, parsePurgeArgs, partitionE2eUsers, purgeConfigFrom, purgeGuard } from "./staging-purge-e2e";

const STAGING_REF = "stagingrefaaaaaaaaaa";
const PRODUCTION_REF = "prodrefbbbbbbbbbbbbb";
const DOMAIN = "staging.north.example";
const STAGING = { NORTH_ENV: "staging", SUPABASE_URL: `https://${STAGING_REF}.supabase.co`, NORTH_PRODUCTION_SUPABASE_REF: PRODUCTION_REF, E2E_MAIL_DOMAIN: DOMAIN };
const NO_FLAG = { notProduction: false };
const FLAG = { notProduction: true };
const NOW = new Date("2026-10-17T12:00:00.000Z");
const minutesAgo = (m: number): string => new Date(NOW.getTime() - m * 60_000).toISOString();

describe("STG-1 isE2eEmail: e2e-<anything>@<E2E_MAIL_DOMAIN>, exactly", () => {
  it("STG-1 matches the per-run addresses of the live journey at that host, in any case and with outer spaces", () => {
    expect(isE2eEmail("e2e-1760000000-chromium@staging.north.example", DOMAIN)).toBe(true);
    expect(isE2eEmail("E2E-Run-7@Staging.North.EXAMPLE", DOMAIN)).toBe(true);
    expect(isE2eEmail("  e2e-x@staging.north.example ", " Staging.North.Example ")).toBe(true);
    expect(isE2eEmail("e2e-@staging.north.example", DOMAIN)).toBe(true);
    expect(isE2eEmail("e2e-a+b.c@staging.example.co.uk", "staging.example.co.uk")).toBe(true);
  });

  it("STG-1 refuses the inbox itself, any other local part and any other host", () => {
    for (const email of [
      "e2e@staging.north.example",
      "x-e2e-1@staging.north.example",
      "e2e_1@staging.north.example",
      "smoke-m1-1@north.test",
      "founder@staging.north.example",
      "e2e-1@north.example",
      "e2e-1@staging.other.example",
      "e2e-1@sub.staging.north.example",
      "e2e-1@notstaging.north.example",
      "e2e-1@staging-north.example",
    ]) {
      expect(isE2eEmail(email, DOMAIN), email).toBe(false);
    }
  });

  it("STG-1 a domain that is not staging.<domain> (two labels or more after staging.) matches nothing, blank included (fail closed)", () => {
    for (const [email, domain] of [
      ["e2e-1@north.example", "north.example"],
      ["e2e-1@staging.com", "staging.com"],
      ["e2e-1@staging.north.example", "*.north.example"],
      ["e2e-1@staging.north.example", ""],
      ["e2e-1@staging.north.example", "   "],
      ["e2e-1@staging..north.example", "staging..north.example"],
      ["e2e-1@staging.north.example.", "staging.north.example."],
    ] as const) {
      expect(isE2eEmail(email, domain), `${email} / ${domain}`).toBe(false);
    }
  });

  it("STG-1 refuses anything that is not one plain address", () => {
    for (const email of ["", "e2e-1", "e2e-1@", "e2e 1@staging.north.example", "e2e-1@staging.north.example@staging.north.example", "e2e-1@staging.nor th.example"]) {
      expect(isE2eEmail(email, DOMAIN), email).toBe(false);
    }
  });
});

describe("STG-1 partitionE2eUsers: the e2e users, split by the age floor", () => {
  const users = [
    { id: "00000000-0000-4000-8000-000000000001", email: "e2e-1-chromium@staging.north.example", createdAt: minutesAgo(300) },
    { id: "00000000-0000-4000-8000-000000000002", email: "founder@north.example", createdAt: minutesAgo(900) },
    { id: "00000000-0000-4000-8000-000000000003", email: null, createdAt: minutesAgo(900) },
    { id: "00000000-0000-4000-8000-000000000004", email: "e2e-2-mobile@staging.north.example", createdAt: minutesAgo(30) },
    { id: "00000000-0000-4000-8000-000000000005", email: "e2e-3-mobile@staging.north.example", createdAt: minutesAgo(120) },
    { id: "00000000-0000-4000-8000-000000000006", email: "e2e-4-mobile@staging.north.example", createdAt: null },
    { id: "00000000-0000-4000-8000-000000000007", email: "e2e-5-mobile@staging.north.example", createdAt: "yesterday" },
  ];

  it("STG-1 purges only e2e users created at least the floor ago (the boundary counts); the younger ones, a run perhaps still going, are listed apart", () => {
    const split = partitionE2eUsers(users, DOMAIN, NOW, 120);
    expect(split.old.map((u) => u.id.slice(-1))).toEqual(["1", "5"]);
    expect(split.young.map((u) => u.id.slice(-1))).toEqual(["4", "6", "7"]);
  });

  it("STG-1 a user with no readable creation time is never old enough (fail safe); a floor of 0 takes every dated e2e user", () => {
    const split = partitionE2eUsers(users, DOMAIN, NOW, 0);
    expect(split.old.map((u) => u.id.slice(-1))).toEqual(["1", "4", "5"]);
    expect(split.young.map((u) => u.id.slice(-1))).toEqual(["6", "7"]);
  });

  it("STG-1 returns new frozen lists and leaves the input alone", () => {
    const split = partitionE2eUsers(users, DOMAIN, NOW, 120);
    expect(Object.isFrozen(split.old)).toBe(true);
    expect(Object.isFrozen(split.young)).toBe(true);
    expect(users).toHaveLength(7);
  });
});

describe("STG-1 purgeGuard", () => {
  it("STG-1 allows NORTH_ENV=staging, a staging.<domain> mail domain and a Supabase host that is not the production project's", () => {
    expect(purgeGuard(STAGING, NO_FLAG)).toEqual({ ok: true, problems: [] });
  });

  it("STG-1 refuses unless NORTH_ENV is exactly staging", () => {
    for (const value of [undefined, "", "production", "Staging", " staging"]) {
      const verdict = purgeGuard({ ...STAGING, NORTH_ENV: value }, FLAG);
      expect(verdict.ok, String(value)).toBe(false);
      expect(verdict.problems.join(" ")).toMatch(/NORTH_ENV/);
    }
  });

  it("STG-1 refuses a Supabase host with the production ref as one of its labels, in any case", () => {
    for (const url of [`https://${PRODUCTION_REF}.supabase.co`, `https://${PRODUCTION_REF.toUpperCase()}.supabase.co`, `https://db.${PRODUCTION_REF}.supabase.co:6543`]) {
      const verdict = purgeGuard({ ...STAGING, SUPABASE_URL: url }, NO_FLAG);
      expect(verdict.ok, url).toBe(false);
      expect(verdict.problems.join(" ")).toMatch(/production project/);
    }
  });

  it("STG-1 compares the host, not a substring: the ref in a path or inside a longer label is not the production host", () => {
    for (const url of [`https://proxy.example/${PRODUCTION_REF}`, `https://x${PRODUCTION_REF}.supabase.co`]) expect(purgeGuard({ ...STAGING, SUPABASE_URL: url }, NO_FLAG).ok, url).toBe(true);
  });

  it("STG-1 without NORTH_PRODUCTION_SUPABASE_REF it refuses unless the operator passes the flag (fail closed); a blank ref is unset", () => {
    for (const ref of [undefined, "", "   "]) {
      const refused = purgeGuard({ ...STAGING, NORTH_PRODUCTION_SUPABASE_REF: ref }, NO_FLAG);
      expect(refused.ok).toBe(false);
      expect(refused.problems.join(" ")).toContain(NOT_PRODUCTION_FLAG);
      expect(purgeGuard({ ...STAGING, NORTH_PRODUCTION_SUPABASE_REF: ref }, FLAG)).toEqual({ ok: true, problems: [] });
    }
  });

  it("STG-1 the flag never overrides a production host", () => {
    expect(purgeGuard({ ...STAGING, SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co` }, FLAG).ok).toBe(false);
  });

  it("STG-1 refuses a malformed production ref instead of guessing", () => {
    for (const ref of ["prod ref", "https://x.supabase.co", "ab"]) {
      const verdict = purgeGuard({ ...STAGING, NORTH_PRODUCTION_SUPABASE_REF: ref }, FLAG);
      expect(verdict.ok, ref).toBe(false);
      expect(verdict.problems.join(" ")).toMatch(/NORTH_PRODUCTION_SUPABASE_REF/);
    }
  });

  it("STG-1 refuses a missing, blank or non-staging E2E_MAIL_DOMAIN, naming it", () => {
    for (const domain of [undefined, "", "  ", "north.example", "staging.com"]) {
      const verdict = purgeGuard({ ...STAGING, E2E_MAIL_DOMAIN: domain }, FLAG);
      expect(verdict.ok, String(domain)).toBe(false);
      expect(verdict.problems.join(" ")).toMatch(/E2E_MAIL_DOMAIN/);
    }
  });

  it("STG-1 refuses a missing or non-http SUPABASE_URL, and lists every problem at once", () => {
    const verdict = purgeGuard({ NORTH_ENV: "production", SUPABASE_URL: "ftp://x.example", NORTH_PRODUCTION_SUPABASE_REF: PRODUCTION_REF }, NO_FLAG);
    expect(verdict.ok).toBe(false);
    expect(verdict.problems).toHaveLength(3);
    expect(purgeGuard({ ...STAGING, SUPABASE_URL: undefined }, NO_FLAG).problems.join(" ")).toMatch(/SUPABASE_URL/);
  });
});

describe("STG-1 parsePurgeArgs", () => {
  it("STG-1 reads --yes, the not-production flag and the age floor; a bare -- (pnpm's) is ignored; the default is a dry run with a 120-minute floor", () => {
    expect(DEFAULT_OLDER_THAN_MINUTES).toBe(120);
    expect(parsePurgeArgs([])).toEqual({ yes: false, notProduction: false, olderThanMinutes: 120 });
    expect(parsePurgeArgs(["--", "--yes"])).toEqual({ yes: true, notProduction: false, olderThanMinutes: 120 });
    expect(parsePurgeArgs([NOT_PRODUCTION_FLAG, "--yes", "--older-than-minutes", "30"])).toEqual({ yes: true, notProduction: true, olderThanMinutes: 30 });
    expect(parsePurgeArgs(["--older-than-minutes=0"]).olderThanMinutes).toBe(0);
  });

  it("STG-1 an unknown flag, a positional or a floor that is not a whole number of minutes is a usage error", () => {
    expect(() => parsePurgeArgs(["--force"])).toThrow();
    expect(() => parsePurgeArgs(["yes"])).toThrow();
    for (const bad of ["-5", "1.5", "soon", ""]) expect(() => parsePurgeArgs(["--older-than-minutes", bad]), bad).toThrow(/older-than-minutes/);
  });
});

describe("STG-1 purgeConfigFrom", () => {
  const env = { SUPABASE_URL: `https://${STAGING_REF}.supabase.co`, SUPABASE_SERVICE_ROLE_KEY: "service-role-key-0123", E2E_MAIL_DOMAIN: DOMAIN };

  it("STG-1 reads the service client, the mail domain (trimmed, lowercase) and the workspace root", () => {
    expect(purgeConfigFrom(env)).toEqual({ supabaseUrl: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY, mailDomain: DOMAIN, workspaceRoot: null });
    expect(purgeConfigFrom({ ...env, E2E_MAIL_DOMAIN: " Staging.North.Example ", WORKSPACE_ROOT: "/data/workspaces" })).toMatchObject({ mailDomain: DOMAIN, workspaceRoot: "/data/workspaces" });
  });

  it("STG-1 refuses a missing service role key and a missing or non-staging mail domain, naming the variable", () => {
    expect(() => purgeConfigFrom({ SUPABASE_URL: env.SUPABASE_URL, E2E_MAIL_DOMAIN: DOMAIN })).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
    for (const domain of [undefined, "", "north.example"]) expect(() => purgeConfigFrom({ ...env, E2E_MAIL_DOMAIN: domain }), String(domain)).toThrow(/E2E_MAIL_DOMAIN/);
  });

  it("STG-1 purges with the reason label e2e, which purge_owner accepts", () => {
    expect(PurgeReasonSchema.parse(E2E_PURGE_REASON)).toBe("e2e");
  });
});
