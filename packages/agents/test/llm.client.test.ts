import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { AnthropicLlm, LlmError, llmModeOf, MockLlm, parseStructured, selectLlm, type AnthropicClientOptions, type AnthropicMessagesApi } from "../src/llm/client";

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

describe("STG-1 / TST-5 llmModeOf, the one predicate behind selectLlm and the web health line", () => {
  const SDK = "claude-agent-sdk";

  it("is live only with the SDK runtime and a key together", () => {
    expect(llmModeOf({ AGENT_RUNTIME: SDK, ANTHROPIC_API_KEY: "k" })).toBe("live");
  });

  it("is mock for an empty env, the SDK runtime without a key, and a key without the SDK runtime", () => {
    expect(llmModeOf({})).toBe("mock");
    expect(llmModeOf({ AGENT_RUNTIME: SDK })).toBe("mock");
    expect(llmModeOf({ AGENT_RUNTIME: SDK, ANTHROPIC_API_KEY: "" })).toBe("mock");
    expect(llmModeOf({ AGENT_RUNTIME: "mock", ANTHROPIC_API_KEY: "k" })).toBe("mock");
    expect(llmModeOf({ AGENT_RUNTIME: "", ANTHROPIC_API_KEY: "k" })).toBe("mock");
    expect(llmModeOf({ ANTHROPIC_API_KEY: "k" })).toBe("mock");
  });

  it("is mock for an unknown runtime spelling, such as the SDK name with a trailing space", () => {
    expect(llmModeOf({ AGENT_RUNTIME: `${SDK} `, ANTHROPIC_API_KEY: "k" })).toBe("mock");
  });

  it("never throws, whatever NORTH_MODEL_PROFILE holds (that is selectLlm's concern, not the health line's)", () => {
    expect(llmModeOf({ AGENT_RUNTIME: SDK, ANTHROPIC_API_KEY: "k", NORTH_MODEL_PROFILE: "cheap" })).toBe("live");
    expect(llmModeOf({ NORTH_MODEL_PROFILE: "cheap" })).toBe("mock");
  });

  it("agrees with selectLlm on every combination, so the two cannot drift", () => {
    for (const runtime of [undefined, "", "mock", SDK, `${SDK} `]) {
      for (const key of [undefined, "", "k"]) {
        const env = { AGENT_RUNTIME: runtime, ANTHROPIC_API_KEY: key };
        expect(selectLlm(env).name).toBe(llmModeOf(env) === "live" ? "anthropic" : "mock");
      }
    }
  });
});

/** A `createApi` seam that records the client options and answers every call with `message({})`. */
function recordingFactory() {
  const options: AnthropicClientOptions[] = [];
  const params: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const createApi = (opts: AnthropicClientOptions): AnthropicMessagesApi => {
    options.push(opts);
    return fakeApi(async (p) => (params.push(p), message({})));
  };
  return { createApi, options, params };
}

describe("TST-1 / SEC-1 selectLlm through the model gateway, on the model profile", () => {
  it("TST-1 constructs the live client with the given base URL and key, and resolves aliases on the given profile", async () => {
    const seam = recordingFactory();
    const llm = selectLlm({ AGENT_RUNTIME: "claude-agent-sdk", ANTHROPIC_API_KEY: "north-gateway" }, {}, { baseURL: "http://127.0.0.1:4310", apiKey: "north-gateway", profile: "smoke", createApi: seam.createApi });
    expect(llm.name).toBe("anthropic");
    expect(seam.options).toEqual([{ baseURL: "http://127.0.0.1:4310", apiKey: "north-gateway" }]);
    await llm.structured({ schema: Answer, system: "s", user: "u", model: "planner" });
    expect(seam.params[0]?.model).toBe("claude-haiku-5-5");
    expect(seam.params[0]?.output_config?.effort).toBe("low");
  });

  it("TST-1 reads ANTHROPIC_BASE_URL, the key and NORTH_MODEL_PROFILE from the env when no option names them", async () => {
    const seam = recordingFactory();
    const env = { AGENT_RUNTIME: "claude-agent-sdk", ANTHROPIC_API_KEY: "sk-test-key", ANTHROPIC_BASE_URL: "http://127.0.0.1:1", NORTH_MODEL_PROFILE: "staging" };
    const llm = selectLlm(env, {}, { createApi: seam.createApi });
    expect(seam.options).toEqual([{ baseURL: "http://127.0.0.1:1", apiKey: "sk-test-key" }]);
    await llm.structured({ schema: Answer, system: "s", user: "u", model: "planner" });
    expect(seam.params[0]?.model).toBe("claude-sonnet-5-5");
    expect(seam.params[0]?.output_config?.effort).toBe("medium");
  });

  it("TST-1 defaults to the production profile and refuses a profile it does not know", async () => {
    const seam = recordingFactory();
    await selectLlm({ AGENT_RUNTIME: "claude-agent-sdk", ANTHROPIC_API_KEY: "k" }, {}, { createApi: seam.createApi }).structured({ schema: Answer, system: "s", user: "u", model: "planner" });
    expect(seam.params[0]?.model).toBe("claude-opus-5-5");
    expect(seam.params[0]?.output_config?.effort).toBe("high");
    expect(() => selectLlm({ AGENT_RUNTIME: "claude-agent-sdk", ANTHROPIC_API_KEY: "k", NORTH_MODEL_PROFILE: "cheap" }, {}, { createApi: seam.createApi })).toThrow(/NORTH_MODEL_PROFILE/);
    expect(selectLlm({ NORTH_MODEL_PROFILE: "cheap" }).name).toBe("mock");
  });

  it("SEC-1 AnthropicLlm sends its calls to baseURL with the key it was given (a loopback server stands in for the gateway)", async () => {
    const seen: Array<{ url: string; headers: IncomingHttpHeaders }> = [];
    const server = createServer((req, res) => {
      seen.push({ url: req.url ?? "", headers: req.headers });
      req.resume();
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(message({})));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const llm = new AnthropicLlm(undefined, { baseURL, apiKey: "north-gateway", profile: "smoke" });
      expect(await llm.structured({ schema: Answer, system: "s", user: "u", model: "coder" })).toEqual({ answer: 4 });
      expect(seen).toHaveLength(1);
      expect(seen[0]?.url).toBe("/v1/messages");
      expect(seen[0]?.headers["x-api-key"]).toBe("north-gateway");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
