import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { fenceVerdict } from "@north/core";
import { SANDBOX_STRIPE_WEBHOOK_SECRET } from "@north/integrations";
import { fencePolicyFor, langfuseConfigured, SANDBOX_UNSUBSCRIBE_SECRET, stripeSecretFor, stripeWebhookLabel, unsubscribeSecretFor, workerEnv } from "../src/env";

/**
 * D6-1 (BIL-1, OBS-1): the Stripe webhook secret resolves like the Sentry one
 * (M5 review M1): the sandbox default `whsec_sandbox` only on a loopback bind
 * in sandbox mode; live mode without `STRIPE_WEBHOOK_SECRET` mounts no route.
 * Langfuse is on only with all three keys; prompts are redacted by default.
 */

const base = { SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: "service-role-key-xyz" };
const live = { ...base, INTEGRATIONS_MODE: "live", CONNECTIONS_ENCRYPTION_KEY: "k".repeat(44) };

describe("D6-1 stripeSecretFor", () => {
  it("sandbox on loopback defaults to the sandbox secret; any other bind gets none", () => {
    for (const host of ["127.0.0.1", "localhost", "::1"]) expect(stripeSecretFor(workerEnv({ ...base, WORKER_HOST: host } as NodeJS.ProcessEnv))).toBe(SANDBOX_STRIPE_WEBHOOK_SECRET);
    for (const host of ["0.0.0.0", "10.0.0.5", "worker.internal"]) expect(stripeSecretFor(workerEnv({ ...base, WORKER_HOST: host } as NodeJS.ProcessEnv))).toBeNull();
    expect(stripeWebhookLabel(workerEnv({ ...base, WORKER_HOST: "0.0.0.0" } as NodeJS.ProcessEnv))).toBe("webhook off (no secret)");
    expect(stripeWebhookLabel(workerEnv(base as NodeJS.ProcessEnv))).toBe("webhook on");
  });

  it("live mode without STRIPE_WEBHOOK_SECRET turns the route off, even on loopback; a configured secret always wins", () => {
    expect(stripeSecretFor(workerEnv(live as NodeJS.ProcessEnv))).toBeNull();
    expect(stripeSecretFor(workerEnv({ ...live, STRIPE_WEBHOOK_SECRET: "fake-endpoint-secret" } as NodeJS.ProcessEnv))).toBe("fake-endpoint-secret");
    expect(stripeSecretFor(workerEnv({ ...base, WORKER_HOST: "0.0.0.0", STRIPE_WEBHOOK_SECRET: "fake-endpoint-secret" } as NodeJS.ProcessEnv))).toBe("fake-endpoint-secret");
  });
});

describe("D6-1 / D6-10 optional keys", () => {
  it("Stripe, Stripe Connect and Langfuse keys are optional; LANGFUSE_REDACT defaults to 1", () => {
    const env = workerEnv(base as NodeJS.ProcessEnv);
    expect(env).toMatchObject({ LANGFUSE_REDACT: "1" });
    expect(env.STRIPE_SECRET_KEY).toBeUndefined();
    expect(env.STRIPE_CONNECT_CLIENT_ID).toBeUndefined();
    expect(langfuseConfigured(env)).toBe(false);
    expect(() => workerEnv({ ...base, LANGFUSE_REDACT: "maybe" } as NodeJS.ProcessEnv)).toThrow(/LANGFUSE_REDACT/);
  });

  it("Langfuse is configured only when the public key, the secret key and the host are all set", () => {
    const keys = { LANGFUSE_PUBLIC_KEY: "pk-lf-fake", LANGFUSE_SECRET_KEY: "fake-secret", LANGFUSE_HOST: "https://cloud.langfuse.com" };
    expect(langfuseConfigured(workerEnv({ ...base, ...keys } as NodeJS.ProcessEnv))).toBe(true);
    expect(langfuseConfigured(workerEnv({ ...base, ...keys, LANGFUSE_HOST: undefined } as NodeJS.ProcessEnv))).toBe(false);
    expect(langfuseConfigured(workerEnv({ ...base, ...keys, LANGFUSE_SECRET_KEY: undefined } as NodeJS.ProcessEnv))).toBe(false);
    expect(workerEnv({ ...base, ...keys, LANGFUSE_REDACT: "0" } as NodeJS.ProcessEnv).LANGFUSE_REDACT).toBe("0");
  });
});

const prod = { ...base, NODE_ENV: "production", INNGEST_SIGNING_KEY: "signkey-1234567890" };
const KEY = "sk-ant-api03-a-fake-key-for-tests";
const parse = (extra: Record<string, string | undefined>) => workerEnv({ ...base, ...extra } as NodeJS.ProcessEnv);
const parseProd = (extra: Record<string, string | undefined>) => workerEnv({ ...prod, ...extra } as NodeJS.ProcessEnv);

describe("SEC-1 / TST-1 / TST-5 / STG-1 the gateway, model profile and fence settings", () => {
  it("STG-1 defaults: production env and profile, fence off, cassettes off under the repo root, no cap, no query embedding", () => {
    const env = workerEnv(base as NodeJS.ProcessEnv);
    expect(env).toMatchObject({ NORTH_ENV: "production", NORTH_MODEL_PROFILE: "production", NORTH_TEST_FENCE: "0", NORTH_CASSETTE_MODE: "off", NORTH_DAILY_CAP_USD: 0, NORTH_EMBED_QUERIES: "0" });
    expect(env.AGENT_CONFIG_ROOT).toBe(resolve(process.cwd(), ".agent-config"));
    expect(env.NORTH_CASSETTE_DIR).toBe(resolve(env.AGENTS_DIR, "..", "cassettes"));
    for (const key of ["NORTH_FENCE_META_AD_ACCOUNTS", "NORTH_FENCE_GITHUB_OWNERS", "NORTH_FENCE_RECIPIENT_DOMAINS", "NORTH_FENCE_VERCEL_PREFIX", "UNSUBSCRIBE_SECRET", "ANTHROPIC_BASE_URL", "ANTHROPIC_API_KEY"] as const) expect(env[key], key).toBeUndefined();
  });

  it("TST-2 NORTH_CASSETTE_DIR defaults to <repo root>/cassettes (the repo root is AGENTS_DIR/..); a relative value is read from the repo root", () => {
    expect(parse({ AGENTS_DIR: "/srv/north/agents" }).NORTH_CASSETTE_DIR).toBe("/srv/north/cassettes");
    expect(parse({ AGENTS_DIR: "/srv/north/agents", NORTH_CASSETTE_DIR: "cassettes/smoke" }).NORTH_CASSETTE_DIR).toBe("/srv/north/cassettes/smoke");
    expect(parse({ AGENTS_DIR: "/srv/north/agents", NORTH_CASSETTE_DIR: "/data/cassettes" }).NORTH_CASSETTE_DIR).toBe("/data/cassettes");
  });

  it("TST-5 NODE_ENV=production refuses NORTH_TEST_FENCE=1 unless NORTH_ENV=staging", () => {
    expect(() => parseProd({ NORTH_TEST_FENCE: "1" })).toThrow(/NORTH_TEST_FENCE/);
    expect(parseProd({ NORTH_TEST_FENCE: "1", NORTH_ENV: "staging" }).NORTH_TEST_FENCE).toBe("1");
    expect(parse({ NORTH_TEST_FENCE: "1" }).NORTH_TEST_FENCE).toBe("1");
  });

  it("TST-5 NORTH_TEST_FENCE is 0 or 1 and nothing else, so a typo cannot leave the fence silently off", () => {
    for (const value of ["maybe", "true", "", "2"]) expect(() => parse({ NORTH_TEST_FENCE: value }), value).toThrow(/NORTH_TEST_FENCE/);
  });

  it("TST-2 NODE_ENV=production refuses a cassette mode other than off unless NORTH_ENV=staging", () => {
    expect(() => parseProd({ NORTH_CASSETTE_MODE: "replay" })).toThrow(/NORTH_CASSETTE_MODE/);
    expect(() => parseProd({ NORTH_CASSETTE_MODE: "record" })).toThrow(/NORTH_CASSETTE_MODE/);
    expect(parseProd({ NORTH_CASSETTE_MODE: "replay", NORTH_ENV: "staging" }).NORTH_CASSETTE_MODE).toBe("replay");
    expect(() => parse({ NORTH_CASSETTE_MODE: "tape" })).toThrow(/NORTH_CASSETTE_MODE/);
  });

  it("TST-1 under NODE_ENV=production, NORTH_ENV=production refuses a model profile other than production; staging may pick any", () => {
    expect(() => parseProd({ NORTH_MODEL_PROFILE: "smoke" })).toThrow(/NORTH_MODEL_PROFILE/);
    expect(() => parseProd({ NORTH_MODEL_PROFILE: "staging" })).toThrow(/NORTH_MODEL_PROFILE/);
    expect(parseProd({ NORTH_MODEL_PROFILE: "smoke", NORTH_ENV: "staging" }).NORTH_MODEL_PROFILE).toBe("smoke");
    expect(() => parse({ NORTH_MODEL_PROFILE: "cheap", NORTH_ENV: "staging" })).toThrow(/NORTH_MODEL_PROFILE/);
    expect(() => parse({ NORTH_ENV: "dev" })).toThrow(/NORTH_ENV/);
  });

  it("TST-1 in development and test any profile runs without NORTH_ENV=staging (local pnpm dev on the smoke profile)", () => {
    expect(parse({ NORTH_MODEL_PROFILE: "smoke" })).toMatchObject({ NODE_ENV: "development", NORTH_ENV: "production", NORTH_MODEL_PROFILE: "smoke" });
    expect(parse({ NODE_ENV: "test", NORTH_MODEL_PROFILE: "staging" }).NORTH_MODEL_PROFILE).toBe("staging");
  });

  it("SEC-2 AGENT_CONFIG_ROOT is always absolute: blank is the default, a relative value is read from the cwd, an absolute one is kept", () => {
    expect(parse({ AGENT_CONFIG_ROOT: "" }).AGENT_CONFIG_ROOT).toBe(resolve(process.cwd(), ".agent-config"));
    expect(parse({ AGENT_CONFIG_ROOT: "cfg/agents" }).AGENT_CONFIG_ROOT).toBe(resolve(process.cwd(), "cfg/agents"));
    expect(parse({ AGENT_CONFIG_ROOT: ".agent-config" }).AGENT_CONFIG_ROOT).toBe(resolve(process.cwd(), ".agent-config"));
    expect(parse({ AGENT_CONFIG_ROOT: "/data/agent-config" }).AGENT_CONFIG_ROOT).toBe("/data/agent-config");
  });

  it("TST-5 a malformed fence list fails boot in the env's own format, naming the key", () => {
    const malformed: Array<[string, string]> = [
      ["NORTH_FENCE_GITHUB_OWNERS", "north e2e"],
      ["NORTH_FENCE_GITHUB_OWNERS", "north-e2e;other"],
      ["NORTH_FENCE_RECIPIENT_DOMAINS", "@north.test"],
      ["NORTH_FENCE_RECIPIENT_DOMAINS", "north.test resend.app"],
      ["NORTH_FENCE_RECIPIENT_DOMAINS", "localhost"],
      ["NORTH_FENCE_META_AD_ACCOUNTS", "act 1"],
      ["NORTH_FENCE_META_AD_ACCOUNTS", "act_1;act_2"],
      ["NORTH_FENCE_VERCEL_PREFIX", "E2E prefix"],
    ];
    for (const [key, value] of malformed) expect(() => parse({ NORTH_TEST_FENCE: "1", [key]: value }), `${key}=${value}`).toThrow(new RegExp(`^Worker env invalid: ${key}: `));
    const ok = parse({ NORTH_FENCE_META_AD_ACCOUNTS: "act_123, 456", NORTH_FENCE_GITHUB_OWNERS: "north-e2e, Octo-Cat", NORTH_FENCE_RECIPIENT_DOMAINS: "resend.app, mail.north.test,", NORTH_FENCE_VERCEL_PREFIX: "e2e-" });
    expect(fencePolicyFor(ok)).toMatchObject({ metaAdAccounts: ["act_123", "act_456"], githubOwners: ["north-e2e", "Octo-Cat"], recipientDomains: ["resend.app", "mail.north.test"], vercelProjectPrefix: "e2e-" });
  });

  it("TST-5 Meta ad account ids are normalised to act_<digits>, so 123 and act_123 name the same account", () => {
    const bare = fencePolicyFor(parse({ NORTH_TEST_FENCE: "1", NORTH_FENCE_META_AD_ACCOUNTS: "123" }));
    const prefixed = fencePolicyFor(parse({ NORTH_TEST_FENCE: "1", NORTH_FENCE_META_AD_ACCOUNTS: "act_123" }));
    expect(bare.metaAdAccounts).toEqual(["act_123"]);
    expect(prefixed.metaAdAccounts).toEqual(["act_123"]);
    for (const policy of [bare, prefixed]) {
      expect(fenceVerdict([{ kind: "meta_ad_account", id: "act_123" }], policy)).toEqual({ allowed: true });
      expect(fenceVerdict([{ kind: "meta_ad_account", id: "act_1234" }], policy)).toMatchObject({ allowed: false });
      expect(Object.isFrozen(policy)).toBe(true);
    }
    expect(fencePolicyFor(parse({ NORTH_FENCE_META_AD_ACCOUNTS: " 7, act_8 ,9" })).metaAdAccounts).toEqual(["act_7", "act_8", "act_9"]);
  });

  it("SEC-1 NODE_ENV=production refuses an ANTHROPIC_BASE_URL that is not loopback, so the real key cannot be sent elsewhere", () => {
    expect(() => parseProd({ ANTHROPIC_BASE_URL: "https://evil.example" })).toThrow(/ANTHROPIC_BASE_URL/);
    expect(parseProd({ ANTHROPIC_BASE_URL: "http://127.0.0.1:9999" }).ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:9999");
    expect(parseProd({ ANTHROPIC_BASE_URL: "http://[::1]:9999" }).ANTHROPIC_BASE_URL).toBe("http://[::1]:9999");
    expect(parse({ ANTHROPIC_BASE_URL: "https://proxy.example" }).ANTHROPIC_BASE_URL).toBe("https://proxy.example");
    expect(() => parse({ ANTHROPIC_BASE_URL: "not a url" })).toThrow(/ANTHROPIC_BASE_URL/);
  });

  it("SEC-1 the SDK runtime needs ANTHROPIC_API_KEY unless it replays cassettes; a blank key counts as none", () => {
    expect(() => parse({ AGENT_RUNTIME: "claude-agent-sdk" })).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => parse({ AGENT_RUNTIME: "claude-agent-sdk", ANTHROPIC_API_KEY: "" })).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => parse({ AGENT_RUNTIME: "claude-agent-sdk", NORTH_CASSETTE_MODE: "record" })).toThrow(/ANTHROPIC_API_KEY/);
    expect(parse({ AGENT_RUNTIME: "claude-agent-sdk", NORTH_CASSETTE_MODE: "replay" }).ANTHROPIC_API_KEY).toBeUndefined();
    expect(parse({ AGENT_RUNTIME: "claude-agent-sdk", ANTHROPIC_API_KEY: KEY }).ANTHROPIC_API_KEY).toBe(KEY);
    expect(() => parse({ ANTHROPIC_API_KEY: "short" })).toThrow(/ANTHROPIC_API_KEY/);
    expect(parse({ ANTHROPIC_API_KEY: "" }).ANTHROPIC_API_KEY).toBeUndefined();
    expect(() => parse({ ANTHROPIC_API_KEY: "sk-ant-x" })).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => parse({ ANTHROPIC_API_KEY: "sk-ant-x" })).not.toThrow(/sk-ant-x/);
  });

  it("TST-1 NORTH_DAILY_CAP_USD is a number of USD, 0 or more", () => {
    expect(parse({ NORTH_DAILY_CAP_USD: "0.5" }).NORTH_DAILY_CAP_USD).toBe(0.5);
    expect(() => parse({ NORTH_DAILY_CAP_USD: "-1" })).toThrow(/NORTH_DAILY_CAP_USD/);
    expect(() => parse({ NORTH_DAILY_CAP_USD: "ten" })).toThrow(/NORTH_DAILY_CAP_USD/);
    expect(() => parse({ NORTH_DAILY_CAP_USD: "Infinity" })).toThrow(/NORTH_DAILY_CAP_USD/);
  });

  it("CMP-1 NORTH_WORKER_PUBLIC_URL defaults to the worker's own URL in sandbox mode and is required for live mode in production", () => {
    expect(parse({}).NORTH_WORKER_PUBLIC_URL).toBe("http://127.0.0.1:3101");
    expect(parse({ WORKER_HOST: "::1", WORKER_PORT: "4000" }).NORTH_WORKER_PUBLIC_URL).toBe("http://[::1]:4000");
    const liveProd = { INTEGRATIONS_MODE: "live", CONNECTIONS_ENCRYPTION_KEY: "k".repeat(44) };
    expect(() => parseProd(liveProd)).toThrow(/NORTH_WORKER_PUBLIC_URL/);
    expect(parseProd({ ...liveProd, NORTH_WORKER_PUBLIC_URL: "https://worker.north.example" }).NORTH_WORKER_PUBLIC_URL).toBe("https://worker.north.example");
    expect(parse(liveProd).NORTH_WORKER_PUBLIC_URL).toBeUndefined();
    expect(() => parse({ NORTH_WORKER_PUBLIC_URL: "worker.north.example" })).toThrow(/NORTH_WORKER_PUBLIC_URL/);
  });

  it("CMP-1 UNSUBSCRIBE_SECRET is at least 16 characters; sandbox on loopback defaults it, any other bind or live mode without it gets none", () => {
    expect(() => parse({ UNSUBSCRIBE_SECRET: "too-short" })).toThrow(/UNSUBSCRIBE_SECRET/);
    expect(SANDBOX_UNSUBSCRIBE_SECRET).toBe("sandbox-unsubscribe-secret");
    for (const host of ["127.0.0.1", "localhost", "::1"]) expect(unsubscribeSecretFor(parse({ WORKER_HOST: host }))).toBe(SANDBOX_UNSUBSCRIBE_SECRET);
    expect(unsubscribeSecretFor(parse({ WORKER_HOST: "0.0.0.0" }))).toBeNull();
    expect(unsubscribeSecretFor(workerEnv(live as NodeJS.ProcessEnv))).toBeNull();
    const secret = "a-real-unsubscribe-secret-0123";
    expect(unsubscribeSecretFor(workerEnv({ ...live, UNSUBSCRIBE_SECRET: secret } as NodeJS.ProcessEnv))).toBe(secret);
    expect(unsubscribeSecretFor(parse({ WORKER_HOST: "0.0.0.0", UNSUBSCRIBE_SECRET: secret }))).toBe(secret);
  });

  it("ruling 4: live mode refuses the public sandbox literal as UNSUBSCRIBE_SECRET (anyone could forge opt-outs); sandbox may name it", () => {
    expect(() => workerEnv({ ...live, UNSUBSCRIBE_SECRET: SANDBOX_UNSUBSCRIBE_SECRET } as NodeJS.ProcessEnv)).toThrow(/UNSUBSCRIBE_SECRET: .*sandbox/);
    expect(unsubscribeSecretFor(parse({ UNSUBSCRIBE_SECRET: SANDBOX_UNSUBSCRIBE_SECRET }))).toBe(SANDBOX_UNSUBSCRIBE_SECRET);
    expect(unsubscribeSecretFor(workerEnv({ ...live, UNSUBSCRIBE_SECRET: "a-real-unsubscribe-secret-0123" } as NodeJS.ProcessEnv))).toBe("a-real-unsubscribe-secret-0123");
  });

  it("CMP-1 NORTH_TRUST_PROXY is exactly 0 (default: forwarded client-IP headers are ignored) or 1", () => {
    expect(parse({}).NORTH_TRUST_PROXY).toBe("0");
    expect(parse({ NORTH_TRUST_PROXY: "1" }).NORTH_TRUST_PROXY).toBe("1");
    for (const value of ["yes", "true", "2"]) expect(() => parse({ NORTH_TRUST_PROXY: value })).toThrow(/NORTH_TRUST_PROXY/);
  });

  it("TST-5 / LRN-7 the fence lists and NORTH_EMBED_QUERIES parse; NORTH_EMBED_QUERIES is 0 or 1", () => {
    const env = parse({ NORTH_FENCE_META_AD_ACCOUNTS: "act_1, act_2", NORTH_FENCE_GITHUB_OWNERS: "north-e2e", NORTH_FENCE_RECIPIENT_DOMAINS: "north.test", NORTH_FENCE_VERCEL_PREFIX: "stg-", NORTH_EMBED_QUERIES: "1" });
    expect(env).toMatchObject({ NORTH_FENCE_META_AD_ACCOUNTS: "act_1, act_2", NORTH_FENCE_GITHUB_OWNERS: "north-e2e", NORTH_FENCE_RECIPIENT_DOMAINS: "north.test", NORTH_FENCE_VERCEL_PREFIX: "stg-", NORTH_EMBED_QUERIES: "1" });
    expect(() => parse({ NORTH_EMBED_QUERIES: "yes" })).toThrow(/NORTH_EMBED_QUERIES/);
  });

  it("TST-5 fencePolicyFor reads the fence from the parsed env: on only with NORTH_TEST_FENCE=1, the lists comma-separated, e2e- by default", () => {
    expect(fencePolicyFor(parse({}))).toEqual({ enabled: false, metaAdAccounts: [], githubOwners: [], recipientDomains: [], vercelProjectPrefix: "e2e-", stripeKeyPrefix: "sk_test_" });
    const fence = fencePolicyFor(parse({ NORTH_TEST_FENCE: "1", NORTH_FENCE_META_AD_ACCOUNTS: "act_1, act_2", NORTH_FENCE_GITHUB_OWNERS: "north-e2e", NORTH_FENCE_RECIPIENT_DOMAINS: "north.test,", NORTH_FENCE_VERCEL_PREFIX: "stg-" }));
    expect(fence).toEqual({ enabled: true, metaAdAccounts: ["act_1", "act_2"], githubOwners: ["north-e2e"], recipientDomains: ["north.test"], vercelProjectPrefix: "stg-", stripeKeyPrefix: "sk_test_" });
    expect(Object.isFrozen(fence)).toBe(true);
  });
});
