/**
 * Text helpers for content the platform must treat as data: error titles from
 * Sentry, posts from Reddit, pages from competitor sites. Nothing here parses
 * meaning; it only bounds and cleans strings before they reach a prompt, a
 * card or a row.
 */

/** Every control character (C0, DEL, C1); whitespace is collapsed before this runs so newlines still separate words. */
const CONTROL_CHARS = /\p{Cc}/gu;

/**
 * Prompt delimiters: an opening or closing tag of the names a model prompt
 * uses to separate roles and instructions. `<b>` and other markup stay: they
 * are rendered as text everywhere anyway (never as HTML).
 */
const PROMPT_DELIMITERS = /<\/?\s*(instructions|system|assistant|human|user|tool|tool_result|function_calls?)\b[^>]*>/gi;

/** Strips control bytes and prompt delimiters, then collapses whitespace. */
export function sanitizeText(value: string): string {
  return value.replace(/\s+/g, " ").replace(CONTROL_CHARS, "").replace(PROMPT_DELIMITERS, "").replace(/\s+/g, " ").trim();
}

/** The first `n` whitespace-separated words, with an ellipsis when more followed. */
export function firstWords(value: string, n: number): string {
  const words = value.split(/\s+/).filter((w) => w.length > 0);
  return words.length <= n ? words.join(" ") : `${words.slice(0, n).join(" ")}…`;
}

/** Words of a text: whitespace-separated runs that carry at least one letter or digit (list markers and punctuation do not count). */
export function wordCount(value: string): number {
  return value.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}
