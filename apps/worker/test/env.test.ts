import { describe, expect, it } from "vitest";
import { SANDBOX_STRIPE_WEBHOOK_SECRET } from "@north/integrations";
import { langfuseConfigured, stripeSecretFor, stripeWebhookLabel, workerEnv } from "../src/env";

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
