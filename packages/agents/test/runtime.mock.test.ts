import { describe, expect, it } from "vitest";
import { MockRuntime, mockUsage } from "../src/runtime/mock.js";
import type { AgentRunInput } from "../src/runtime/types.js";

const input: AgentRunInput = {
  companyId: "c",
  taskId: "t",
  role: "research",
  taskType: "market_report",
  instructions: "x",
  memoryDigest: "",
  workspaceDir: "/tmp",
  outputSchema: {},
};

describe("MockRuntime", () => {
  it("replays scripted results and records calls", async () => {
    const runtime = MockRuntime.fromRecord({
      "research:market_report": () => ({ status: "succeeded", output: { ok: true }, actions: [], sessionId: "s1", usage: mockUsage() }),
    });
    const result = await runtime.run(input);
    expect(result.status).toBe("succeeded");
    expect(runtime.history).toHaveLength(1);
  });

  it("fails loudly for unknown scripts", async () => {
    const runtime = MockRuntime.fromRecord({});
    const result = await runtime.run(input);
    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.error).toMatch(/no script/);
  });
});
