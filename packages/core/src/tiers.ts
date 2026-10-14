/**
 * Authority tiers (K0..K3) from docs/SPEC.md "Yetki ve bütçe modeli".
 *
 * K0 automatic, K1 notify, K2 decision card, K3 user only. Ordered by risk; an
 * agent may raise a tier but never lower it.
 */
export const TIERS = ["K0", "K1", "K2", "K3"] as const;
export type Tier = (typeof TIERS)[number];

const RANK: Readonly<Record<Tier, number>> = Object.freeze({ K0: 0, K1: 1, K2: 2, K3: 3 });

export function tierRank(tier: Tier): number {
  return RANK[tier];
}

export function isTier(value: unknown): value is Tier {
  return typeof value === "string" && (TIERS as readonly string[]).includes(value);
}

/** The higher-risk of two tiers. */
export function maxTier(a: Tier, b: Tier): Tier {
  return RANK[a] >= RANK[b] ? a : b;
}

/** True when `tier` is at or below `limit` (e.g. a role's max_action_tier). */
export function tierWithin(tier: Tier, limit: Tier): boolean {
  return RANK[tier] <= RANK[limit];
}
