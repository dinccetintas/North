// Cutting untrusted text to a size without breaking it: a cut that lands
// between the two halves of a surrogate pair would leave a lone surrogate,
// which is not valid Unicode (JSON encoders and Postgres reject or mangle it).
// The same rule as `clip` in `packages/agents/src/runtime/memory-tool.ts`.

/**
 * `text` when it fits in `max` UTF-16 units; otherwise its longest prefix that
 * leaves room for `ending` and does not end on a high surrogate, followed by
 * `ending`. The result is never longer than `max`.
 */
export function clipText(text: string, max: number, ending = ""): string {
  if (text.length <= max) return text;
  let end = Math.max(0, max - ending.length);
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return text.slice(0, end) + ending;
}
