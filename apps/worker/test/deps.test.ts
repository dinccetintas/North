import { describe, expect, it } from "vitest";
import { AUDIT_INPUT_MAX_CHARS, auditInput, capAuditInput } from "../src/deps";
import { workerEnv } from "../src/env";

describe("capAuditInput", () => {
  it("keeps small inputs intact and truncates large ones", () => {
    expect(capAuditInput({ query: "x" })).toEqual({ json: '{"query":"x"}', truncated: false });
    const big = capAuditInput({ blob: "a".repeat(AUDIT_INPUT_MAX_CHARS * 2) });
    expect(big.truncated).toBe(true);
    expect(big.json.length).toBe(AUDIT_INPUT_MAX_CHARS);
  });

  it("M6 review M4: auditInput keeps a cut input as its text (a cut JSON does not parse), inside the database's 64 KiB check", () => {
    expect(auditInput({ query: "x" })).toEqual({ value: { query: "x" }, truncated: false });
    const big = auditInput({ blob: "\"".repeat(AUDIT_INPUT_MAX_CHARS * 3) });
    expect(big.truncated).toBe(true);
    expect(typeof big.value).toBe("string");
    expect((big.value as string).length).toBe(AUDIT_INPUT_MAX_CHARS);
    expect(Buffer.byteLength(JSON.stringify(big), "utf8")).toBeLessThan(65_536);
  });

  it("never throws on unserializable input", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(capAuditInput(circular).json).toContain("unserializable");
  });
});

describe("workerEnv", () => {
  const base = { SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: "service-role-key-xyz" };

  it("defaults to mock runtime, sandbox mode and loopback host", () => {
    const env = workerEnv(base as NodeJS.ProcessEnv);
    expect(env).toMatchObject({ AGENT_RUNTIME: "mock", INTEGRATIONS_MODE: "sandbox", WORKER_HOST: "127.0.0.1", WORKER_PORT: 3101 });
  });

  it("requires the Inngest signing key in production", () => {
    expect(() => workerEnv({ ...base, NODE_ENV: "production" } as NodeJS.ProcessEnv)).toThrow(/INNGEST_SIGNING_KEY/);
    expect(() => workerEnv({ ...base, NODE_ENV: "production", INNGEST_SIGNING_KEY: "signkey-1234567890" } as NodeJS.ProcessEnv)).not.toThrow();
  });
});
