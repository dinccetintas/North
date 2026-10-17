import { afterEach, describe, expect, it, vi } from "vitest";
import { llmModeOf } from "@north/agents/llm/client";
import { GET } from "./route";

/**
 * STG-1, TST-5: the web's health line says whether the web process could call the model; `scripts/production-check.ts` requires "mock".
 * The decision lives in `llmModeOf` (`packages/agents/test/llm.client.test.ts` covers every env combination); this file pins that the route
 * mirrors it and nothing else. The route holds no credential to leak, so "never carries the key" is structural, not a runtime property.
 */

vi.mock("@north/agents/llm/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@north/agents/llm/client")>()),
  llmModeOf: vi.fn(),
}));

const llmModeOfMock = vi.mocked(llmModeOf);

afterEach(() => llmModeOfMock.mockReset());

describe("STG-1 GET /api/health", () => {
  it.each(["mock", "live"] as const)("mirrors llmModeOf: llm %s", async (mode) => {
    llmModeOfMock.mockReturnValue(mode);
    const res = GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.llm).toBe(mode);
    expect(body).toMatchObject({ ok: true, app: "north-web" });
  });

  it("asks llmModeOf about this process's environment", () => {
    llmModeOfMock.mockReturnValue("mock");
    GET();
    expect(llmModeOfMock).toHaveBeenCalledExactlyOnceWith(process.env);
  });

  it("has exactly the keys ok, app, time and llm, and the time parses", async () => {
    llmModeOfMock.mockReturnValue("mock");
    const body = (await GET().json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["app", "llm", "ok", "time"]);
    expect(Number.isNaN(Date.parse(String(body.time)))).toBe(false);
  });
});
