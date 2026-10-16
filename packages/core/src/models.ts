/**
 * Model routing. The only place model IDs may appear in the codebase.
 *
 * Aliases map a job shape to a model so that cost/quality tuning is a one-line
 * change. Agent role YAML files reference aliases, never IDs.
 *
 * Profiles (TST-1) re-route the same aliases to cheaper models so tests can run
 * on Sonnet or Haiku while production keeps the Opus-class routing.
 */
export const MODEL_ALIASES = ["planner", "coder", "drafter", "classifier"] as const;
export type ModelAlias = (typeof MODEL_ALIASES)[number];

export type ModelEffort = "low" | "medium" | "high" | "xhigh";

const OPUS = "claude-opus-5-5";
const SONNET = "claude-sonnet-5-5";
const HAIKU = "claude-haiku-5-5";

export const MODEL_ROUTING: Readonly<Record<ModelAlias, string>> = Object.freeze({
  planner: OPUS,
  coder: OPUS,
  drafter: SONNET,
  classifier: HAIKU,
});

export const EFFORT_BY_ALIAS: Readonly<Record<ModelAlias, ModelEffort>> = Object.freeze({
  planner: "high",
  coder: "xhigh",
  drafter: "medium",
  classifier: "low",
});

export const MODEL_PROFILES = ["production", "staging", "smoke"] as const;
export type ModelProfile = (typeof MODEL_PROFILES)[number];
export const DEFAULT_PROFILE: ModelProfile = "production";

interface Route {
  readonly model: string;
  readonly effort: ModelEffort;
}

type ProfileTable = Readonly<Record<ModelAlias, Route>>;

const route = (model: string, effort: ModelEffort): Route => Object.freeze({ model, effort });

const PRODUCTION_TABLE: ProfileTable = Object.freeze(
  Object.fromEntries(
    MODEL_ALIASES.map((alias) => [alias, route(MODEL_ROUTING[alias], EFFORT_BY_ALIAS[alias])]),
  ) as Record<ModelAlias, Route>,
);

const STAGING_TABLE: ProfileTable = Object.freeze({
  planner: route(SONNET, "medium"),
  coder: route(SONNET, "medium"),
  drafter: route(SONNET, "low"),
  classifier: route(HAIKU, EFFORT_BY_ALIAS.classifier),
});

const SMOKE_TABLE: ProfileTable = Object.freeze(
  Object.fromEntries(MODEL_ALIASES.map((alias) => [alias, route(HAIKU, "low")])) as Record<
    ModelAlias,
    Route
  >,
);

/** Alias to model and effort, per profile. Production is derived from the two tables above. */
export const PROFILE_ROUTING: Readonly<Record<ModelProfile, ProfileTable>> = Object.freeze({
  production: PRODUCTION_TABLE,
  staging: STAGING_TABLE,
  smoke: SMOKE_TABLE,
});

/** Type guard: is this string a known model alias? */
export function isModelAlias(value: string): value is ModelAlias {
  return (MODEL_ALIASES as readonly string[]).includes(value);
}

/** Type guard: is this string a known model profile? */
export function isModelProfile(value: string): value is ModelProfile {
  return (MODEL_PROFILES as readonly string[]).includes(value);
}

function lookupRoute(alias: string, profile: string): Route {
  if (!isModelProfile(profile)) {
    throw new Error(`Unknown model profile "${profile}". Known: ${MODEL_PROFILES.join(", ")}`);
  }
  if (!isModelAlias(alias)) {
    throw new Error(`Unknown model alias "${alias}". Known: ${MODEL_ALIASES.join(", ")}`);
  }
  return PROFILE_ROUTING[profile][alias];
}

/** Resolves an alias to a concrete model ID under a profile; throws on unknown alias or profile. */
export function resolveModel(alias: string, profile: ModelProfile = DEFAULT_PROFILE): string {
  return lookupRoute(alias, profile).model;
}

/** Resolves an alias to its effort level under a profile; throws on unknown alias or profile. */
export function resolveEffort(alias: string, profile: ModelProfile = DEFAULT_PROFILE): ModelEffort {
  return lookupRoute(alias, profile).effort;
}

/** USD per million tokens for one tier. */
export interface Price {
  readonly input: number;
  /** Writing the prompt cache with the 5-minute lifetime. */
  readonly cacheWrite5m: number;
  /** Writing the prompt cache with the 1-hour lifetime. */
  readonly cacheWrite1h: number;
  readonly cacheRead: number;
  readonly output: number;
}

/** A model's price; `longPrompt` is the tier for prompts over `LONG_PROMPT_TOKENS`, when the model has one. */
export interface ModelPrice extends Price {
  readonly longPrompt?: Price;
}

/** Prompts longer than this (input + cache reads + cache writes, per request) bill the model's `longPrompt` tier. */
export const LONG_PROMPT_TOKENS = 100_000;

const tier = (rates: Price): Price => Object.freeze({ ...rates });
const withLongPrompt = (rates: Price, longPrompt: Price): ModelPrice => Object.freeze({ ...rates, longPrompt: tier(longPrompt) });

/**
 * USD per million tokens, keyed by model ID. Source: the official pricing page
 * (https://platform.claude.com/docs/en/about-claude/pricing), checked 2026-10-16.
 * Opus and Sonnet have one tier. Haiku bills prompts over 100,000 tokens at
 * the `longPrompt` tier, priced per request on the whole prompt.
 */
export const PRICE_USD_PER_MTOK: Readonly<Record<string, ModelPrice>> = Object.freeze({
  [OPUS]: tier({ input: 4, cacheWrite5m: 5, cacheWrite1h: 8, cacheRead: 0.2, output: 20 }),
  [SONNET]: tier({ input: 2, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.1, output: 10 }),
  [HAIKU]: withLongPrompt(
    { input: 0.1, cacheWrite5m: 0.125, cacheWrite1h: 0.2, cacheRead: 0.01, output: 0.5 },
    { input: 0.5, cacheWrite5m: 0.625, cacheWrite1h: 1, cacheRead: 0.05, output: 2.5 },
  ),
});

export interface ModelUsage {
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  /** Tokens written to the 5-minute prompt cache; 0 when absent. */
  readonly cacheWriteTokens?: number;
  /** Tokens written to the 1-hour prompt cache; 0 when absent. */
  readonly cacheWrite1hTokens?: number;
}

/**
 * Prices one usage record in USD: input, 5-minute and 1-hour cache writes,
 * cache reads and output. A model with a `longPrompt` tier bills the whole
 * request at that tier once input + reads + writes pass `LONG_PROMPT_TOKENS`.
 * Returns NaN for a model with no price entry: callers must treat NaN as
 * "unpriced", never as zero cost.
 */
export function costOfUsage(usage: ModelUsage): number {
  if (!Object.hasOwn(PRICE_USD_PER_MTOK, usage.model)) return Number.NaN;
  const entry = PRICE_USD_PER_MTOK[usage.model]!;
  const write5m = usage.cacheWriteTokens ?? 0;
  const write1h = usage.cacheWrite1hTokens ?? 0;
  const promptTokens = usage.inputTokens + usage.cacheReadTokens + write5m + write1h;
  const rate = entry.longPrompt !== undefined && promptTokens > LONG_PROMPT_TOKENS ? entry.longPrompt : entry;
  return (
    (usage.inputTokens * rate.input +
      write5m * rate.cacheWrite5m +
      write1h * rate.cacheWrite1h +
      usage.cacheReadTokens * rate.cacheRead +
      usage.outputTokens * rate.output) /
    1_000_000
  );
}
