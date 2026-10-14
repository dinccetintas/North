import { describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { AnthropicLlm, LlmError, MockLlm, parseStructured, selectLlm, type AnthropicMessagesApi } from "../src/llm/client";

const Answer = z.object({ answer: z.number() });

const message = (overrides: Partial<Anthropic.Message>): Anthropic.Message =>
  ({
    id: "m",
    type: "message",
    role: "assistant",
    model: "claude-haiku-5-5",
    content: [{ type: "text", text: '{"answer": 4}', citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
    ...overrides,
  }) as Anthropic.Message;

const fakeApi = (respond: (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>): AnthropicMessagesApi => ({ create: respond });

describe("MockLlm", () => {
  it("returns schema-validated values by key and records calls", async () => {
    const llm = MockLlm.fromRecord({ sum: { answer: 4 } });
    const out = await llm.structured({ schema: Answer, system: "s", user: "u", model: "classifier", key: "sum" });
    expect(out).toEqual({ answer: 4 });
    expect(llm.history).toHaveLength(1);
  });

  it("throws LlmError for a missing key and for a value that fails the schema", async () => {
    const llm = MockLlm.fromRecord({ bad: { answer: "four" } });
    await expect(llm.structured({ schema: Answer, system: "s", user: "u", model: "classifier", key: "nope" })).rejects.toBeInstanceOf(LlmError);
    await expect(llm.structured({ schema: Answer, system: "s", user: "u", model: "classifier", key: "bad" })).rejects.toThrow(/validation/);
  });
});

describe("AnthropicLlm", () => {
  it("sends the resolved model, system, user and output_config, then parses the text block", async () => {
    let seen: Anthropic.MessageCreateParamsNonStreaming | undefined;
    const llm = new AnthropicLlm(
      fakeApi(async (params) => {
        seen = params;
        return message({});
      }),
    );
    const out = await llm.structured({ schema: Answer, system: "sys", user: "2+2?", model: "classifier" });
    expect(out).toEqual({ answer: 4 });
    expect(seen?.model).toBe("claude-haiku-5-5");
    expect(seen?.system).toBe("sys");
    expect(seen?.messages).toEqual([{ role: "user", content: "2+2?" }]);
    expect(seen?.output_config?.format?.type).toBe("json_schema");
    expect(seen?.output_config?.effort).toBe("low");
  });

  it("wraps SDK errors in LlmError with the status", async () => {
    const llm = new AnthropicLlm(fakeApi(async () => Promise.reject(new Anthropic.RateLimitError(429, { message: "slow down" }, "slow down", new Headers()))));
    const error = await llm.structured({ schema: Answer, system: "s", user: "u", model: "classifier" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).status).toBe(429);
    expect((error as LlmError).message).toMatch(/429/);
  });

  it("rejects refusals, truncation, and non-JSON text", async () => {
    const run = (overrides: Partial<Anthropic.Message>) =>
      new AnthropicLlm(fakeApi(async () => message(overrides))).structured({ schema: Answer, system: "s", user: "u", model: "classifier" });
    await expect(run({ stop_reason: "refusal" })).rejects.toThrow(/refused/);
    await expect(run({ stop_reason: "max_tokens" })).rejects.toThrow(/max_tokens/);
    await expect(run({ content: [{ type: "text", text: "not json", citations: null }] })).rejects.toThrow(/non-JSON/);
  });
});

describe("parseStructured and selectLlm", () => {
  it("parseStructured validates JSON against the schema", () => {
    expect(parseStructured(Answer, '{"answer":1}')).toEqual({ answer: 1 });
    expect(() => parseStructured(Answer, '{"answer":"x"}')).toThrow(LlmError);
  });

  it("selects the mock unless the live runtime and an API key are both configured", () => {
    expect(selectLlm({}).name).toBe("mock");
    expect(selectLlm({ AGENT_RUNTIME: "claude-agent-sdk" }).name).toBe("mock");
    expect(selectLlm({ ANTHROPIC_API_KEY: "sk-test" }).name).toBe("mock");
    expect(selectLlm({ AGENT_RUNTIME: "claude-agent-sdk", ANTHROPIC_API_KEY: "sk-test" }).name).toBe("anthropic");
  });
});
