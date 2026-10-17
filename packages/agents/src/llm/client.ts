import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { DEFAULT_PROFILE, isModelProfile, resolveEffort, resolveModel, type ModelAlias, type ModelProfile } from "@north/core";

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

/** Where the Anthropic client sends its calls, and with which key. Absent fields fall back to the SDK's own env defaults. */
export interface AnthropicClientOptions {
  readonly apiKey?: string;
  /** The API base URL; in the worker, the loopback model gateway (SEC-1). */
  readonly baseURL?: string;
}

/** Options of `AnthropicLlm`: the client options plus the model profile (TST-1) aliases resolve on. */
export interface AnthropicLlmOptions extends AnthropicClientOptions {
  /** Defaults to `DEFAULT_PROFILE` (production). */
  readonly profile?: ModelProfile;
}

/** Builds the messages API a live client calls; a seam so tests can see the client options. */
export type AnthropicApiFactory = (options: AnthropicClientOptions) => AnthropicMessagesApi;

/** The SDK's messages API with only the options that are set (so an absent one keeps the SDK's env default). */
export const anthropicMessagesApi: AnthropicApiFactory = (options) =>
  new Anthropic({ ...(options.apiKey !== undefined ? { apiKey: options.apiKey } : {}), ...(options.baseURL !== undefined ? { baseURL: options.baseURL } : {}) }).messages;

/** The client options of a set of options, without the fields that are absent or undefined. */
const clientOptionsOf = (options: { readonly apiKey?: string | undefined; readonly baseURL?: string | undefined }): AnthropicClientOptions => ({
  ...(options.baseURL !== undefined ? { baseURL: options.baseURL } : {}),
  ...(options.apiKey !== undefined ? { apiKey: options.apiKey } : {}),
});

/**
 * Live client over `@anthropic-ai/sdk`. Without `api` it builds the SDK
 * client from `options` (`apiKey`, `baseURL`; an absent one falls back to the
 * SDK's ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL). Model aliases resolve on
 * `options.profile`.
 */
export class AnthropicLlm implements LlmClient {
  readonly name = "anthropic" as const;
  private readonly api: AnthropicMessagesApi;
  private readonly profile: ModelProfile;

  constructor(api?: AnthropicMessagesApi, options: AnthropicLlmOptions = {}) {
    this.api = api ?? anthropicMessagesApi(clientOptionsOf(options));
    this.profile = options.profile ?? DEFAULT_PROFILE;
  }

  async structured<T>(args: StructuredArgs<T>): Promise<T> {
    let message: Anthropic.Message;
    try {
      message = await this.api.create({
        model: resolveModel(args.model, this.profile),
        max_tokens: STRUCTURED_MAX_TOKENS,
        system: args.system,
        messages: [{ role: "user", content: args.user }],
        output_config: { effort: resolveEffort(args.model, this.profile), format: zodOutputFormat(args.schema) },
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

/** Options of `selectLlm`: they win over the env's `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY` and `NORTH_MODEL_PROFILE`. */
export interface SelectLlmOptions extends AnthropicLlmOptions {
  /** Builds the messages API (defaults to the SDK); a seam for tests. */
  readonly createApi?: AnthropicApiFactory;
}

/** The profile named by the option or `NORTH_MODEL_PROFILE`; the default when neither is set; throws on an unknown name. */
function profileFrom(option: ModelProfile | undefined, raw: string | undefined): ModelProfile {
  if (option !== undefined) return option;
  if (raw === undefined || raw === "") return DEFAULT_PROFILE;
  if (!isModelProfile(raw)) throw new LlmError(`NORTH_MODEL_PROFILE "${raw}" is not a model profile`);
  return raw;
}

/**
 * STG-1, TST-5: whether `env` would arm the live model, "live" only when
 * `AGENT_RUNTIME` is exactly `claude-agent-sdk` and an API key is present,
 * otherwise "mock". It reads the two settings and never returns, logs or
 * carries the key, and it never throws (an unknown `NORTH_MODEL_PROFILE` is
 * `selectLlm`'s concern). `selectLlm` decides with this same predicate, so the
 * two cannot drift. The web health line reports it through this function, so
 * the web app never names the key itself (the CI worker-only-secrets grep).
 */
export function llmModeOf(env: NodeJS.ProcessEnv = process.env): "mock" | "live" {
  return env.AGENT_RUNTIME === "claude-agent-sdk" && Boolean(env.ANTHROPIC_API_KEY) ? "live" : "mock";
}

/**
 * Mock unless `llmModeOf(env)` is "live" (`AGENT_RUNTIME=claude-agent-sdk` and
 * an API key both present). The live client is built with `options.baseURL ??
 * env.ANTHROPIC_BASE_URL`, `options.apiKey ?? env.ANTHROPIC_API_KEY` and the
 * profile `options.profile ?? env.NORTH_MODEL_PROFILE` (default production; an
 * unknown name throws).
 */
export function selectLlm(env: NodeJS.ProcessEnv = process.env, mockResponses?: Record<string, unknown>, options: SelectLlmOptions = {}): LlmClient {
  if (llmModeOf(env) !== "live") return MockLlm.fromRecord(mockResponses ?? {});
  const profile = profileFrom(options.profile, env.NORTH_MODEL_PROFILE);
  const client = clientOptionsOf({ baseURL: options.baseURL ?? env.ANTHROPIC_BASE_URL, apiKey: options.apiKey ?? env.ANTHROPIC_API_KEY });
  return new AnthropicLlm((options.createApi ?? anthropicMessagesApi)(client), { profile });
}
