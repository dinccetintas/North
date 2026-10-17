import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

/** STG-1, TST-5: the web's health line says whether the web process could call the model; `scripts/production-check.ts` requires "mock". */

const KEY = "sk-ant-fake-key-for-the-health-test-0123456789";

afterEach(() => vi.unstubAllEnvs());

describe("STG-1 GET /api/health", () => {
  it("is the ok line of the web app with the time and llm mock when nothing configures the model", async () => {
    vi.stubEnv("AGENT_RUNTIME", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const res = GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ ok: true, app: "north-web", llm: "mock" });
    expect(Number.isNaN(Date.parse(String(body.time)))).toBe(false);
  });

  it("reads live only with the SDK runtime and a key together, and never carries the key", async () => {
    vi.stubEnv("AGENT_RUNTIME", "claude-agent-sdk");
    vi.stubEnv("ANTHROPIC_API_KEY", KEY);
    const res = GET();
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ llm: "live" });
    expect(text).not.toContain(KEY);
    expect(text).not.toContain("sk-ant");
  });

  it("stays mock with the SDK runtime but no key, with a key but the mock runtime, or with an unknown runtime", async () => {
    for (const [runtime, key] of [["claude-agent-sdk", ""], ["mock", KEY], ["", KEY], ["claude-agent-sdk ", KEY]] as const) {
      vi.stubEnv("AGENT_RUNTIME", runtime);
      vi.stubEnv("ANTHROPIC_API_KEY", key);
      expect(await GET().json()).toMatchObject({ llm: "mock" });
    }
  });
});
