import { expect, type Page } from "@playwright/test";
import { serviceEnv } from "./stack";

/**
 * M6 test-only access to the local stack (BIL-1, BIL-2, EXP-1, PUB-1, PWA-1):
 * entitlements and credits through Supabase REST with the service role, the
 * worker's sandbox billing pages (WP-D6: sandbox mode, loopback only) and a
 * few browser steps. Lives next to `stack.ts` to keep both files under 400
 * lines; never used by the app itself. Plan numbers are inlined because
 * Playwright does not transform workspace sources (they mirror core
 * `billing/plans.ts`).
 */

const WORKER_URL = process.env.E2E_WORKER_URL ?? "http://localhost:3101";

export const PLAN_LIMITS = Object.freeze({
  solo: { companyLimit: 1, monthlyCredits: 300, priceUsd: 99 },
  pro: { companyLimit: 3, monthlyCredits: 1000, priceUsd: 299 },
  scale: { companyLimit: 10, monthlyCredits: 4000, priceUsd: 999 },
});
export type PlanId = keyof typeof PLAN_LIMITS;

async function rest<T>(path: string, init: RequestInit = { method: "GET" }): Promise<T> {
  const env = serviceEnv();
  const response = await fetch(`${env.url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: env.serviceRoleKey, Authorization: `Bearer ${env.serviceRoleKey}`, "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers ?? {}) },
  });
  if (!response.ok) throw new Error(`Supabase REST ${init.method ?? "GET"} ${path} → ${response.status}: ${await response.text()}`);
  return (await response.json()) as T;
}

/** The profile id of a signed-in test user (the magic link created it). */
export async function userIdByEmail(email: string): Promise<string> {
  const rows = await rest<{ id: string }[]>(`users?email=eq.${encodeURIComponent(email)}&select=id`);
  const id = rows[0]?.id;
  if (!id) throw new Error(`No user with email ${email}`);
  return id;
}

export interface EntitlementRow {
  readonly planId: string;
  readonly status: string;
  readonly companyLimit: number;
  readonly monthlyCredits: number;
  readonly stripeCustomerId: string | null;
  readonly stripeSubscriptionId: string | null;
  readonly retentionUntil: string | null;
}

export async function entitlementFor(userId: string): Promise<EntitlementRow> {
  const rows = await rest<
    { plan_id: string; status: string; company_limit: number; monthly_credits: number; stripe_customer_id: string | null; stripe_subscription_id: string | null; retention_until: string | null }[]
  >(`entitlements?user_id=eq.${encodeURIComponent(userId)}&select=plan_id,status,company_limit,monthly_credits,stripe_customer_id,stripe_subscription_id,retention_until`);
  const r = rows[0];
  if (!r) throw new Error(`No entitlement for ${userId}`);
  return { planId: r.plan_id, status: r.status, companyLimit: r.company_limit, monthlyCredits: r.monthly_credits, stripeCustomerId: r.stripe_customer_id, stripeSubscriptionId: r.stripe_subscription_id, retentionUntil: r.retention_until };
}

/** The ledger's sum, as `credit_balance(user_id)` computes it. */
export async function creditBalance(userId: string): Promise<number> {
  return (await creditLedger(userId)).balance;
}

export interface CreditLedger {
  readonly balance: number;
  /** Plan and pack grants (the trial's 300, a plan's period credits, packs). */
  readonly granted: number;
  /** One per agent run (mock runs count, BIL-2). */
  readonly consumed: number;
}

export async function creditLedger(userId: string): Promise<CreditLedger> {
  const rows = await rest<{ kind: string; amount: number }[]>(`credit_entries?user_id=eq.${encodeURIComponent(userId)}&select=kind,amount`);
  const sum = (kinds: readonly string[]) => rows.filter((r) => kinds.includes(r.kind)).reduce((s, r) => s + r.amount, 0);
  return { balance: rows.reduce((s, r) => s + r.amount, 0), granted: sum(["grant_plan", "grant_pack"]), consumed: -sum(["consume"]) };
}

/**
 * Service role: puts the user on a plan without Stripe, for specs that need
 * more than the trial's one company (M6: every new user starts on a 14-day
 * Solo trial). The webhook is the only path that does this in the product.
 */
export async function grantPlan(userId: string, planId: PlanId): Promise<void> {
  const limits = PLAN_LIMITS[planId];
  await rest<unknown[]>(`entitlements?user_id=eq.${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: JSON.stringify({ plan_id: planId, status: "active", company_limit: limits.companyLimit, monthly_credits: limits.monthlyCredits, price_usd: limits.priceUsd }),
  });
}

/** Service role: an `adjust` entry that takes the balance to zero (BIL-2: dispatch then refuses with `credits_exhausted`). */
export async function drainCredits(userId: string): Promise<void> {
  const balance = await creditBalance(userId);
  if (balance <= 0) return;
  await rest<unknown[]>("credit_entries", { method: "POST", body: JSON.stringify({ user_id: userId, kind: "adjust", amount: -balance, ref: `adjust:e2e-drain:${Date.now()}`, note: "e2e drain" }) });
}

/** On the worker's sandbox checkout page: press its one button; the worker signs the events, posts its own webhook and sends the browser back to North. */
export async function completeSandboxCheckout(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/sandbox\/billing\/checkout\//, { timeout: 30_000 });
  await page.locator('form [type="submit"]').first().click();
  await page.waitForURL(/\/settings\/billing\?checkout=/, { timeout: 30_000 });
}

export type PortalAction = "cancel" | "end" | "advance" | "fail";

/** On the worker's sandbox portal page: press the form whose action ends with `/<action>`. */
export async function sandboxPortal(page: Page, action: PortalAction): Promise<void> {
  await expect(page).toHaveURL(/\/sandbox\/billing\/portal\//, { timeout: 30_000 });
  await page.locator(`form[action$="/${action}"] [type="submit"]`).first().click();
  await page.waitForLoadState("load");
}

async function portalPost(customerId: string, action: PortalAction): Promise<void> {
  const response = await fetch(`${WORKER_URL}/sandbox/billing/portal/${encodeURIComponent(customerId)}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "",
    redirect: "manual",
  });
  if (response.status >= 400) throw new Error(`Worker portal ${action} → ${response.status}: ${await response.text()}`);
}

/** `invoice.paid` for the next period (the sandbox's period roll). */
export function advanceBillingPeriod(customerId: string): Promise<void> {
  return portalPost(customerId, "advance");
}

/** `customer.subscription.deleted` now: the entitlement ends and every company is paused. */
export function endSubscriptionNow(customerId: string): Promise<void> {
  return portalPost(customerId, "end");
}

/** On `/settings/export`: choose the kind for every company and submit. */
export async function requestExport(page: Page, kind: "full" | "artifacts" | "data"): Promise<void> {
  await page.goto("/settings/export");
  await page.getByTestId(`export-kind-${kind}`).check();
  await page.getByTestId("export-company").selectOption("");
  await page.getByTestId("export-submit").click();
  await expect(page.getByTestId("export-requested")).toBeVisible();
}

export interface PublicPageContent {
  readonly headline: string;
  readonly blurb: string;
  readonly showGoal: boolean;
  readonly metricKeys: readonly string[];
  readonly showSiteLink: boolean;
  readonly listed: boolean;
}

/** Service role: writes the company's public page and turns it on (the owner's form does the same under RLS). */
export async function enablePublicPage(companyId: string, page: PublicPageContent): Promise<void> {
  await rest<unknown[]>("public_pages?on_conflict=company_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ company_id: companyId, headline: page.headline, blurb: page.blurb, show_goal: page.showGoal, metric_keys: page.metricKeys, show_site_link: page.showSiteLink, listed: page.listed }),
  });
  await rest<unknown[]>(`companies?id=eq.${encodeURIComponent(companyId)}`, { method: "PATCH", body: JSON.stringify({ public_page_enabled: true }) });
}

export interface WebManifestJson {
  readonly name: string;
  readonly start_url: string;
  readonly display: string;
  readonly theme_color: string;
  readonly background_color: string;
  readonly icons: readonly { readonly src: string; readonly sizes: string; readonly type: string; readonly purpose?: string }[];
}

/** The manifest the page links to, fetched with the page's own request context. */
export async function manifestOf(page: Page): Promise<WebManifestJson> {
  const href = await page.locator('link[rel="manifest"]').first().getAttribute("href");
  if (!href) throw new Error("The page links no manifest");
  const response = await page.request.get(href);
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"] ?? "").toContain("manifest+json");
  return (await response.json()) as WebManifestJson;
}
