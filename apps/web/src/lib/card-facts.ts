/**
 * The gate writes a card's rationale as "<sentence> Details: <facts>." (core
 * `cardRationale`). Cards carry no separate facts column, so the facts line a
 * card shows is read back from that tail. Kept verbatim: facts contain commas
 * (recipient lists, audiences), so they are never split.
 */
export interface SplitRationale {
  readonly summary: string;
  readonly facts: string | null;
}

const DETAILS_MARKER = " Details: ";

export function splitRationale(rationale: string): SplitRationale {
  const at = rationale.indexOf(DETAILS_MARKER);
  if (at < 0) return Object.freeze({ summary: rationale, facts: null });
  const tail = rationale.slice(at + DETAILS_MARKER.length).trim();
  const facts = tail.endsWith(".") ? tail.slice(0, -1) : tail;
  return Object.freeze({ summary: rationale.slice(0, at).trim(), facts: facts.length > 0 ? facts : null });
}

const CAMPAIGN_FACT = /(?:^|, )campaign: (.+)$/;

/** The campaign named in a cap card's or an ads card's facts ("…, campaign: Acme launch test"), or null. */
export function campaignNameOf(facts: string | null): string | null {
  const match = facts?.match(CAMPAIGN_FACT);
  const name = match?.[1]?.trim() ?? "";
  return name.length > 0 ? name : null;
}
