// TST-1: the Messages API `usage` object, read at the boundary and mapped to
// the ModelUsage that `costOfUsage` prices. Used by the model gateway on
// responses it does not trust (JSON bodies and SSE events alike).
import { z } from "zod";
import type { ModelUsage } from "../models";

const Count = z.number().int().nonnegative();
/** A count the API may leave out or send as null; both mean 0. */
const OptionalCount = Count.nullish();

const CacheCreationSchema = z.object({
  ephemeral_5m_input_tokens: OptionalCount,
  ephemeral_1h_input_tokens: OptionalCount,
});

const ApiUsageSchema = z.object({
  input_tokens: Count,
  output_tokens: Count,
  cache_creation_input_tokens: OptionalCount,
  cache_read_input_tokens: OptionalCount,
  cache_creation: CacheCreationSchema.nullish(),
  /** `fast` is the only value that changes the price; anything else is standard. */
  speed: z.string().nullish(),
});

const ApiMessageSchema = z.object({
  model: z.string().min(1),
  usage: ApiUsageSchema,
});

/**
 * Maps a Messages API body (`{ model, usage }`, extra fields ignored) to
 * `ModelUsage`. Cache writes come from the `cache_creation` breakdown when it
 * is present; whatever `cache_creation_input_tokens` reports beyond the
 * breakdown (or all of it, when there is none) counts as 5-minute writes, so a
 * short breakdown can never price fewer writes than the API said. `usage.speed`
 * "fast" is carried as `speed: "fast"` (it doubles the cost), anything else as
 * "standard". Returns null
 * when the body has no model or no usable counts: callers treat that as
 * "unpriced", never as free.
 */
export function usageFromApi(body: unknown): ModelUsage | null {
  const parsed = ApiMessageSchema.safeParse(body);
  if (!parsed.success) return null;
  const { model, usage } = parsed.data;
  const write5m = usage.cache_creation?.ephemeral_5m_input_tokens ?? 0;
  const write1h = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const unexplained = Math.max(0, (usage.cache_creation_input_tokens ?? 0) - write5m - write1h);
  return Object.freeze({
    model,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: write5m + unexplained,
    cacheWrite1hTokens: write1h,
    speed: usage.speed === "fast" ? "fast" : "standard",
  });
}
