import { describe, expect, it } from "vitest";
import { elapsedMinutes, sandboxMinutesOf } from "../src/runtime/meta";
import { MockRuntime, mockUsage } from "../src/runtime/mock";
import type { AgentRunInput } from "../src/runtime/types";

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

describe("B6-5 MockRuntime run facts (BIL-2 usage, OBS-1 traces)", () => {
  const scripted = MockRuntime.fromRecord({
    "research:market_report": () => ({ status: "succeeded", output: { ok: true }, actions: [], sessionId: "s1", usage: mockUsage() }),
  });

  it("reports sandboxMinutes 0 on every result, scripted or not", async () => {
    expect(await scripted.run(input)).toMatchObject({ status: "succeeded", sandboxMinutes: 0 });
    expect(await MockRuntime.fromRecord({}).run(input)).toMatchObject({ status: "failed", sandboxMinutes: 0 });
    expect(await MockRuntime.fromRecord({ "research:market_report": () => ({ status: "failed", error: "x", sessionId: null, usage: mockUsage(), sandboxMinutes: 9 }) }).run(input)).toMatchObject({ sandboxMinutes: 0 });
  });

  it("echoes the worker's trace id when one is given and adds none otherwise", async () => {
    expect(await scripted.run({ ...input, traceId: "trace-1" })).toMatchObject({ traceId: "trace-1" });
    expect(await scripted.run(input)).not.toHaveProperty("traceId");
  });

  it("sandboxMinutesOf reads the field and treats a hand-built result without it as 0", () => {
    expect(sandboxMinutesOf({ status: "failed", error: "x", sessionId: null, usage: mockUsage(), sandboxMinutes: 2.5 })).toBe(2.5);
    expect(sandboxMinutesOf({ status: "failed", error: "x", sessionId: null, usage: mockUsage() })).toBe(0);
    expect(elapsedMinutes(90_000)).toBe(1.5);
    expect(elapsedMinutes(30)).toBe(0.001);
    expect(elapsedMinutes(-5)).toBe(0);
  });
});
