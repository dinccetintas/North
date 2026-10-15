/**
 * PRO-1: the search keywords a scan uses, from the thesis and the personas.
 * Deterministic and model-free; a thesis word weighs twice a persona word.
 */
export const MAX_SIGNAL_QUERIES = 6;
const MIN_TOKEN_LENGTH = 3;
const THESIS_WEIGHT = 2;
const PERSONA_WEIGHT = 1;

/** Function words and generic product words that never make a good search. */
const STOP_WORDS: ReadonlySet<string> = new Set([
  "a", "an", "the", "and", "or", "but", "nor", "so", "yet", "of", "to", "in", "on", "at", "by", "as", "is", "are", "was", "were",
  "be", "been", "being", "it", "its", "that", "this", "these", "those", "with", "without", "from", "into", "than", "then", "they",
  "them", "their", "we", "our", "us", "you", "your", "he", "she", "his", "her", "who", "whom", "which", "what", "when", "where",
  "why", "how", "have", "has", "had", "do", "does", "did", "not", "no", "yes", "can", "could", "will", "would", "should", "may",
  "might", "must", "all", "any", "each", "every", "some", "such", "only", "own", "same", "more", "most", "other", "out", "up",
  "down", "over", "under", "again", "there", "here", "also", "about", "via", "per", "one", "two", "new", "use", "using", "used",
  "get", "make", "help", "helps", "tool", "tools", "sell", "sold", "sells", "done", "like", "just", "very", "way", "for", "my",
]);

function tokens(text: string): readonly string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= MIN_TOKEN_LENGTH && !STOP_WORDS.has(token));
}

interface Weighted {
  readonly token: string;
  readonly weight: number;
  readonly first: number;
}

/**
 * At most six keywords: thesis and persona words that are not stop-words,
 * weighted by repetition, lowercased and unique, ties broken by first
 * appearance.
 */
export function signalQueries(thesis: string, personas: readonly string[]): readonly string[] {
  const weighted = new Map<string, Weighted>();
  const add = (token: string, weight: number): void => {
    const existing = weighted.get(token);
    weighted.set(token, existing ? { ...existing, weight: existing.weight + weight } : { token, weight, first: weighted.size });
  };
  for (const token of tokens(thesis)) add(token, THESIS_WEIGHT);
  for (const token of tokens(personas.join(" "))) add(token, PERSONA_WEIGHT);
  return Object.freeze(
    [...weighted.values()]
      .sort((a, b) => b.weight - a.weight || a.first - b.first)
      .slice(0, MAX_SIGNAL_QUERIES)
      .map((w) => w.token),
  );
}
