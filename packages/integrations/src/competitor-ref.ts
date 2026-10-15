/**
 * The `source_ref` of a competitor-page observation: `<url>#<hash>`, so the
 * worker's known refs tell a rescan which pages it has seen and with what
 * content. The hash is a truncated sha256 of the title and the visible text;
 * the URL part is cut so the whole ref fits core's 200-character bound.
 */
export const COMPETITOR_HASH_LENGTH = 40;
const REF_MAX = 200;
const URL_PART_MAX = REF_MAX - 1 - COMPETITOR_HASH_LENGTH;

/** The URL as it appears in a ref: fragment dropped, cut to fit. */
export function competitorRefUrl(url: string): string {
  const hashIndex = url.indexOf("#");
  return (hashIndex === -1 ? url : url.slice(0, hashIndex)).slice(0, URL_PART_MAX);
}

export function competitorSourceRef(url: string, hash: string): string {
  return `${competitorRefUrl(url)}#${hash.slice(0, COMPETITOR_HASH_LENGTH)}`;
}

/** Splits a ref back into its URL part and hash; null when it is not a competitor ref. */
export function competitorRefParts(ref: string): { readonly url: string; readonly hash: string } | null {
  const index = ref.lastIndexOf("#");
  if (index <= 0 || index === ref.length - 1) return null;
  return Object.freeze({ url: ref.slice(0, index), hash: ref.slice(index + 1) });
}

/** The hashes already stored for a URL, read from the known refs. */
export function knownHashesFor(url: string, knownRefs: readonly string[]): readonly string[] {
  const wanted = competitorRefUrl(url);
  return Object.freeze(knownRefs.flatMap((ref) => {
    const parts = competitorRefParts(ref);
    return parts && parts.url === wanted ? [parts.hash] : [];
  }));
}
