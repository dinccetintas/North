import type { ActionSpec } from "@north/core";
import type { FakeState } from "./fake-db";

/**
 * Seed helpers for the in-memory `@north/db` stand-in, re-exported from
 * `fake-db.ts` (kept apart so that file stays under 400 lines).
 */

export interface SeedCompanyOptions {
  readonly id?: string;
  readonly slug?: string;
  readonly name?: string;
  readonly ownerId?: string;
  readonly timezone?: string;
  readonly email?: string;
  /** The owner's `users.brief_hour` (M6, BRF-1); 7 when absent. */
  readonly briefHour?: number;
}

/** A company with its owner's profile and zone, listed for the proactive crons. */
export function seedCompany(state: FakeState, overrides: SeedCompanyOptions = {}): string {
  const id = overrides.id ?? "company-1";
  const ownerId = overrides.ownerId ?? "user-1";
  const slug = overrides.slug ?? "lumen";
  const name = overrides.name ?? "Lumen";
  state.companies.set(id, { id, slug, name, ownerId });
  state.profiles.set(ownerId, { id: ownerId, email: overrides.email ?? "ceo@example.test", timezone: overrides.timezone ?? "UTC", dailyDecisionQuota: 3, plan: "free" });
  state.activeCompanies.push({ companyId: id, ownerId, timezone: overrides.timezone ?? "UTC", name, slug, killSwitchActive: false });
  if (overrides.briefHour !== undefined) state.briefHours.set(ownerId, overrides.briefHour);
  return id;
}

export const adsStart = (overrides: Partial<ActionSpec> = {}): ActionSpec => ({
  kind: "ads.start",
  companyId: "company-1",
  agentRole: "growth",
  description: "Start the $10/day launch test",
  amountUsd: 50,
  category: "ads",
  payload: { name: "Launch test", dailyBudgetUsd: 10, audience: "solo consultants", creativeMarkdown: "# Hi" },
  ...overrides,
});
