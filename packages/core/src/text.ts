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
 * uses to separate roles and instructions, and the `data` block every
 * untrusted text is quoted in (M5 review H1). `<b>` and other markup stay:
 * they are rendered as text everywhere anyway (never as HTML).
 */
const PROMPT_DELIMITERS = /<\/?\s*(instructions|system|assistant|human|user|tool|tool_result|function_calls?|data)\b[^>]*>/gi;

/** The data block's sentinel line; a value that is only the sentinel (or a line of it) is dropped so no text can pretend the block ended. */
const DATA_SENTINEL_LINE = /^\s*end of data\s*$/gim;

/** Strips control bytes, prompt delimiters and the data sentinel, then collapses whitespace. */
export function sanitizeText(value: string): string {
  return value
    .replace(DATA_SENTINEL_LINE, "")
    .replace(/\s+/g, " ")
    .replace(CONTROL_CHARS, "")
    .replace(PROMPT_DELIMITERS, "")
    .replace(/\s+/g, " ")
    .replace(DATA_SENTINEL_LINE, "")
    .trim();
}

const DATA_NONCE = /^[0-9a-f]{16}$/;

/** A random 16-hex nonce for one data block: no text a source controls can forge the closing tag. */
export function dataBlockNonce(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The lines of a data block: `<data source="…" id="<nonce>">`, the lines, the
 * sentinel and `</data id="<nonce>">`. Every line inside must already be
 * sanitised (`sanitizeText`), so the only `data` tags in the result are the
 * two with this call's nonce (M5 review H1).
 */
export function dataBlock(source: string, lines: readonly string[], nonce: string = dataBlockNonce()): readonly string[] {
  if (!DATA_NONCE.test(nonce)) throw new Error("data block nonce must be 16 hex characters");
  return Object.freeze([`<data source="${source}" id="${nonce}">`, ...lines, "End of data", `</data id="${nonce}">`]);
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
