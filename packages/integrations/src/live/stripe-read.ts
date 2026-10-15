import { z } from "zod";
import { NotConfiguredError, ProviderError } from "../errors";
import type { PaymentsProvider, PaymentsSnapshot } from "../growth-types";
import type { ProviderAuth } from "../types";
import type { FetchLike } from "./github";
import { stripeCall } from "./stripe-http";

/** Stripe's largest page, and the most objects one read takes from a list (ten pages); a bigger account is summarised from its newest 1 000. */
export const STRIPE_READ_PAGE_SIZE = 100;
export const STRIPE_READ_MAX_OBJECTS = 1000;
/** `revenue_usd` is the paid, unrefunded USD of the trailing window. */
export const STRIPE_REVENUE_WINDOW_DAYS = 30;

const NOT_CONNECTED = "Stripe is not connected for this user (connect it in Settings → Connections)";
const ACCOUNT = /^acct_[A-Za-z0-9]{1,64}$/;
const DAY_SECONDS = 86_400;

/** The connected account (`acct_…`) from the connection's `scope`, else from its `scopes`; undefined when the token is the account's own. */
export function stripeAccountOf(auth: ProviderAuth): string | undefined {
  return [auth.scope, ...(auth.scopes ?? [])].find((value): value is string => typeof value === "string" && ACCOUNT.test(value));
}

const Price = z.object({
  currency: z.string(),
  unit_amount: z.number().nullable().default(null),
  unit_amount_decimal: z.string().nullable().default(null),
  recurring: z.object({ interval: z.enum(["day", "week", "month", "year"]), interval_count: z.number().int().positive().default(1), usage_type: z.string().optional() }).nullable().default(null),
});
const Item = z.object({ quantity: z.number().nonnegative().nullable().default(1), price: Price });
export type SubscriptionItemShape = z.input<typeof Item>;

const Subscription = z.object({
  id: z.string().min(1),
  customer: z.union([z.string(), z.object({ id: z.string() })]),
  items: z.object({ data: z.array(Item) }),
});
const Charge = z.object({
  id: z.string().min(1),
  amount: z.number().int().nonnegative(),
  amount_refunded: z.number().int().nonnegative().default(0),
  currency: z.string(),
  paid: z.boolean(),
  status: z.string(),
  refunded: z.boolean().default(false),
});
const Page = <T extends z.ZodTypeAny>(item: T) => z.object({ data: z.array(item), has_more: z.boolean().default(false) });

const PER_MONTH: Readonly<Record<"day" | "week" | "month" | "year", number>> = Object.freeze({ day: 365 / 12, week: 52 / 12, month: 1, year: 1 / 12 });

/** One item's amount per month in cents (USD or not; the caller filters the currency); metered, unpriced or one-off items count 0. */
export function monthlyCents(raw: SubscriptionItemShape): number {
  const item = Item.parse(raw);
  const { recurring } = item.price;
  if (!recurring || recurring.usage_type === "metered") return 0;
  const unit = item.price.unit_amount ?? Number(item.price.unit_amount_decimal ?? Number.NaN);
  if (!Number.isFinite(unit)) return 0;
  return (unit * (item.quantity ?? 1) * PER_MONTH[recurring.interval]) / recurring.interval_count;
}

const usd = (cents: number): number => Math.round(cents) / 100;
const isUsd = (currency: string): boolean => currency.toLowerCase() === "usd";

/**
 * The user's own Stripe through their Stripe Connect connection (OUT-2,
 * read_only scope, ADR 0010): active subscriptions give `paying_customers`
 * (distinct customers, any currency) and `mrr_usd` (USD items normalised to a
 * month; other currencies are not converted), the trailing window's charges
 * give `revenue_usd` (paid and succeeded, net of partial refunds, fully
 * refunded charges excluded). Read only: nothing here writes to the account.
 */
export class StripeReadPayments implements PaymentsProvider {
  constructor(
    readonly auth: ProviderAuth | null = null,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** Every object of a list up to `STRIPE_READ_MAX_OBJECTS`, newest first, following `starting_after`. */
  private async list<T extends z.ZodTypeAny>(auth: ProviderAuth, path: string, query: readonly (readonly [string, string])[], item: T): Promise<readonly (z.output<T> & { id: string })[]> {
    const account = stripeAccountOf(auth);
    const objects: (z.output<T> & { id: string })[] = [];
    for (let pageIndex = 0; pageIndex < STRIPE_READ_MAX_OBJECTS / STRIPE_READ_PAGE_SIZE; pageIndex += 1) {
      const after = objects.at(-1)?.id;
      const request = { method: "GET" as const, path, query: [...query, ["limit", String(STRIPE_READ_PAGE_SIZE)] as const, ...(after ? [["starting_after", after] as const] : [])], ...(account ? { account } : {}) };
      const response = await stripeCall(this.fetchImpl, auth.token, request);
      if (!response.ok) throw new ProviderError("stripe", `GET /v1${path} → ${response.status ?? "-"} ${response.code}`);
      const parsed = Page(item).safeParse(response.json);
      if (!parsed.success) throw new ProviderError("stripe", `GET /v1${path} → ${response.status} invalid_response`);
      objects.push(...(parsed.data.data as (z.output<T> & { id: string })[]).slice(0, STRIPE_READ_MAX_OBJECTS - objects.length));
      if (!parsed.data.has_more || parsed.data.data.length === 0 || objects.length >= STRIPE_READ_MAX_OBJECTS) break;
    }
    return Object.freeze(objects);
  }

  async read(_companyId: string): Promise<PaymentsSnapshot> {
    const auth = this.auth;
    if (!auth) throw new NotConfiguredError(NOT_CONNECTED);
    const subscriptions = await this.list(auth, "/subscriptions", [["status", "active"]], Subscription);
    const since = Math.floor(this.clock().getTime() / 1000) - STRIPE_REVENUE_WINDOW_DAYS * DAY_SECONDS;
    const charges = await this.list(auth, "/charges", [["created[gte]", String(since)]], Charge);
    const customers = new Set(subscriptions.map((s) => (typeof s.customer === "string" ? s.customer : s.customer.id)));
    const mrrCents = subscriptions.flatMap((s) => s.items.data).reduce((sum, item) => sum + (isUsd(item.price.currency) ? monthlyCents(item) : 0), 0);
    const revenueCents = charges.filter((c) => c.paid && c.status === "succeeded" && !c.refunded && isUsd(c.currency)).reduce((sum, c) => sum + Math.max(0, c.amount - c.amount_refunded), 0);
    return Object.freeze({ payingCustomers: customers.size, mrrUsd: usd(mrrCents), revenueUsd: usd(revenueCents), sandbox: false });
  }
}
