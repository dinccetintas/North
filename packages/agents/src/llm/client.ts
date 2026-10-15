import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { EFFORT_BY_ALIAS, resolveModel, type ModelAlias } from "@north/core";

/** Default output budget for one structured call (clarifying questions, classifications). */
export const STRUCTURED_MAX_TOKENS = 4096;

/** Arguments for one structured (JSON) completion. */
export interface StructuredArgs<T> {
  readonly schema: z.ZodType<T>;
  readonly system: string;
  readonly user: string;
  readonly model: ModelAlias;
  /** Lookup key for `MockLlm` scripts; ignored by live clients. */
  readonly key?: string;
}

/** Single-call LLM client that returns schema-validated JSON (M1 WP-B). */
export interface LlmClient {
  readonly name: "anthropic" | "mock";
  structured<T>(args: StructuredArgs<T>): Promise<T>;
}

/** Readable error raised by any `LlmClient`; wraps SDK errors with status when known. */
export class LlmError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

/** The slice of the Anthropic client `AnthropicLlm` needs; narrow so tests can inject a fake. */
export interface AnthropicMessagesApi {
  create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
}

const textOf = (message: Anthropic.Message): string =>
  message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

const toLlmError = (error: unknown): LlmError => {
  if (error instanceof LlmError) return error;
  if (error instanceof Anthropic.APIError) {
    return new LlmError(`Anthropic API error${error.status ? ` ${error.status}` : ""}: ${error.message}`, error.status, error);
  }
  const message = error instanceof Error ? error.message : String(error);
  return new LlmError(`LLM call failed: ${message}`, undefined, error);
};

/** Parses the model's text as JSON and validates it; throws `LlmError` with the first schema issue. */
export function parseStructured<T>(schema: z.ZodType<T>, text: string): T {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new LlmError("Model returned non-JSON text for a structured call");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new LlmError(`Structured output failed validation: ${issue?.path.join(".") ?? ""} ${issue?.message ?? ""}`.trim());
  }
  return parsed.data;
}

/** Live client over `@anthropic-ai/sdk`; `new Anthropic()` reads ANTHROPIC_API_KEY from the environment. */
export class AnthropicLlm implements LlmClient {
  readonly name = "anthropic" as const;

  constructor(private readonly api: AnthropicMessagesApi = new Anthropic().messages) {}

  async structured<T>(args: StructuredArgs<T>): Promise<T> {
    let message: Anthropic.Message;
    try {
      message = await this.api.create({
        model: resolveModel(args.model),
        max_tokens: STRUCTURED_MAX_TOKENS,
        system: args.system,
        messages: [{ role: "user", content: args.user }],
        output_config: { effort: EFFORT_BY_ALIAS[args.model], format: zodOutputFormat(args.schema) },
      });
    } catch (error) {
      throw toLlmError(error);
    }
    if (message.stop_reason === "refusal") throw new LlmError("Model refused the structured request");
    if (message.stop_reason === "max_tokens") throw new LlmError("Structured output was cut off by max_tokens");
    return parseStructured(args.schema, textOf(message));
  }
}

/**
 * A scripted answer that depends on the call: the `signal:score` fixture
 * reads the candidate ids out of the prompt and scores them by pattern. A
 * plain value is returned as is.
 */
export type MockResponder = (args: StructuredArgs<unknown>) => unknown;

const isResponder = (value: unknown): value is MockResponder => typeof value === "function";

/** Deterministic client: answers come from a map keyed by `args.key` (a value or a `MockResponder`); unknown keys throw. */
export class MockLlm implements LlmClient {
  readonly name = "mock" as const;
  private readonly calls: StructuredArgs<unknown>[] = [];

  constructor(private readonly responses: ReadonlyMap<string, unknown> = new Map()) {}

  static fromRecord(record: Record<string, unknown>): MockLlm {
    return new MockLlm(new Map(Object.entries(record)));
  }

  get history(): readonly StructuredArgs<unknown>[] {
    return Object.freeze([...this.calls]);
  }

  async structured<T>(args: StructuredArgs<T>): Promise<T> {
    this.calls.push(args);
    const key = args.key ?? "";
    if (!this.responses.has(key)) throw new LlmError(`MockLlm has no response for key "${key}"`);
    const scripted = this.responses.get(key);
    const value = isResponder(scripted) ? scripted(args) : scripted;
    return parseStructured(args.schema, JSON.stringify(value));
  }
}

/** Mock unless `AGENT_RUNTIME=claude-agent-sdk` and an API key are both present. */
export function selectLlm(env: NodeJS.ProcessEnv = process.env, mockResponses?: Record<string, unknown>): LlmClient {
  const live = env.AGENT_RUNTIME === "claude-agent-sdk" && Boolean(env.ANTHROPIC_API_KEY);
  return live ? new AnthropicLlm() : MockLlm.fromRecord(mockResponses ?? {});
}
