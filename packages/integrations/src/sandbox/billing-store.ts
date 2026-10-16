import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { BILLING_EVENT_TYPES, STRIPE_SUBSCRIPTION_STATUSES } from "@north/core";
import { z } from "zod";
import { BILLING_CHECKOUT_MODES } from "../billing-types";
import { safeJoin } from "./files";

/**
 * On-disk state of the sandbox Stripe account, under `<root>/billing`:
 * `customers/<id>.json`, `sessions/<id>.json`, `subscriptions/<customerId>.json`
 * (the customer's current subscription), `index/<namespace>/<key>.json`
 * (idempotency: user → customer, session key → session) and `counter.json`
 * (the per-root id counters and the newest `created` emitted). Files, not
 * memory, so a worker restart continues the counters and a replayed click
 * returns the very events it produced the first time.
 */

const Unix = z.number().int().nonnegative();

/** A Stripe-shaped webhook event exactly as the sandbox emitted it (stored so a replay is byte-identical). */
export const SandboxStripeEventSchema = z.object({
  id: z.string().min(1),
  object: z.literal("event"),
  api_version: z.string(),
  created: Unix,
  livemode: z.literal(false),
  pending_webhooks: z.number().int(),
  request: z.object({ id: z.null(), idempotency_key: z.null() }),
  type: z.enum(BILLING_EVENT_TYPES),
  data: z.object({ object: z.record(z.string(), z.unknown()), previous_attributes: z.record(z.string(), z.unknown()).optional() }),
});
export type SandboxStripeEvent = z.infer<typeof SandboxStripeEventSchema>;

export const SandboxCustomerSchema = z.object({ id: z.string().min(1), userId: z.uuid(), email: z.string(), createdAt: z.string() });
export type SandboxCustomer = z.infer<typeof SandboxCustomerSchema>;

export const SANDBOX_SESSION_STATUSES = ["open", "complete"] as const;

export const SandboxCheckoutSessionSchema = z.object({
  id: z.string().min(1),
  customerId: z.string().min(1),
  mode: z.enum(BILLING_CHECKOUT_MODES),
  lookupKey: z.string().min(1),
  packId: z.string().nullable(),
  clientReferenceId: z.uuid(),
  successUrl: z.string(),
  cancelUrl: z.string(),
  url: z.string(),
  status: z.enum(SANDBOX_SESSION_STATUSES),
  created: Unix,
  completedAt: z.string().nullable(),
  subscriptionId: z.string().nullable(),
  /** What `completeCheckout` emitted; returned unchanged on every later call. */
  events: z.array(SandboxStripeEventSchema),
});
export type SandboxCheckoutSession = z.infer<typeof SandboxCheckoutSessionSchema>;

/** The open renewal invoice a `failPayment` left behind; the next `advancePeriod` pays that same invoice. */
const FailedInvoice = z.object({ cycle: z.number().int().nonnegative(), invoiceId: z.string(), lineId: z.string(), event: SandboxStripeEventSchema });

export const SandboxSubscriptionSchema = z.object({
  id: z.string().min(1),
  customerId: z.string().min(1),
  userId: z.uuid(),
  lookupKey: z.string().min(1),
  itemId: z.string().min(1),
  status: z.enum(STRIPE_SUBSCRIPTION_STATUSES),
  cancelAtPeriodEnd: z.boolean(),
  cancelAt: Unix.nullable(),
  canceledAt: Unix.nullable(),
  endedAt: Unix.nullable(),
  /** Unix seconds the subscription started; period `n` runs from anchor + n months to anchor + n + 1 months. */
  anchor: Unix,
  cycle: z.number().int().nonnegative(),
  /** Earlier subscriptions of the customer this one replaced (a new checkout after an end). */
  superseded: z.array(z.string()),
  /** The lookup key each superseded subscription was sold at (files written before this field read as none). */
  supersededLookupKeys: z.record(z.string(), z.string()).default({}),
  replay: z.object({ cancel: SandboxStripeEventSchema.nullable(), end: SandboxStripeEventSchema.nullable(), failed: FailedInvoice.nullable() }),
});
export type SandboxSubscription = z.infer<typeof SandboxSubscriptionSchema>;

const CounterSchema = z.object({ next: z.record(z.string(), z.number().int().positive()), lastCreated: Unix });
type Counter = z.infer<typeof CounterSchema>;

/** Every id the sandbox reads back from a URL or a route; anything else is "not found", never a path. */
const ID = /^[A-Za-z0-9_]{1,120}$/;
const INDEX_KEY = /^[A-Za-z0-9:._-]{1,255}$/;

export type IndexNamespace = "user" | "checkout" | "portal";

/** One promise chain per billing directory: every mutation of a root runs alone, so counters never repeat. */
const chains = new Map<string, Promise<unknown>>();

async function readJson<T>(path: string | null, schema: z.ZodType<T>): Promise<T | null> {
  if (!path) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(await readFile(path, "utf8")));
    return parsed.success ? Object.freeze(parsed.data) : null;
  } catch {
    return null;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2), "utf8");
}

export class BillingStore {
  readonly dir: string;

  constructor(root: string) {
    this.dir = resolve(join(root, "billing"));
  }

  private file(folder: string, id: string): string | null {
    return ID.test(id) ? safeJoin(join(this.dir, folder), `${id}.json`) : null;
  }

  /** Runs `task` after every earlier mutation of this root in the process has settled. */
  exclusive<T>(task: () => Promise<T>): Promise<T> {
    const previous = chains.get(this.dir) ?? Promise.resolve();
    const run = previous.then(task, task);
    const tail = run.catch(() => undefined);
    chains.set(this.dir, tail);
    void tail.then(() => {
      if (chains.get(this.dir) === tail) chains.delete(this.dir);
    });
    return run;
  }

  private async counter(): Promise<Counter> {
    return (await readJson(join(this.dir, "counter.json"), CounterSchema)) ?? { next: {}, lastCreated: 0 };
  }

  /** `count` fresh ids `<prefix>_sandbox_<n>`; call inside `exclusive`. */
  async nextIds(prefix: string, count = 1): Promise<readonly string[]> {
    const counter = await this.counter();
    const first = counter.next[prefix] ?? 1;
    await writeJson(join(this.dir, "counter.json"), { ...counter, next: { ...counter.next, [prefix]: first + count } });
    return Object.freeze(Array.from({ length: count }, (_, i) => `${prefix}_sandbox_${first + i}`));
  }

  /** Unix seconds for a new event: the clock, but never before the newest event already emitted (Stripe's clock does not run back). */
  async stamp(now: Date): Promise<number> {
    const counter = await this.counter();
    const created = Math.max(Math.floor(now.getTime() / 1000), counter.lastCreated);
    await writeJson(join(this.dir, "counter.json"), { ...counter, lastCreated: created });
    return created;
  }

  async lookup(namespace: IndexNamespace, key: string): Promise<string | null> {
    if (!INDEX_KEY.test(key)) return null;
    const hit = await readJson(safeJoin(join(this.dir, "index", namespace), `${key}.json`), z.object({ id: z.string() }));
    return hit?.id ?? null;
  }

  async remember(namespace: IndexNamespace, key: string, id: string): Promise<void> {
    if (!INDEX_KEY.test(key)) throw new Error(`Invalid index key for ${namespace}`);
    await writeJson(safeJoin(join(this.dir, "index", namespace), `${key}.json`), { id });
  }

  readCustomer(id: string): Promise<SandboxCustomer | null> {
    return readJson(this.file("customers", id), SandboxCustomerSchema);
  }

  async writeCustomer(customer: SandboxCustomer): Promise<void> {
    await this.write("customers", customer.id, SandboxCustomerSchema.parse(customer));
  }

  readSession(id: string): Promise<SandboxCheckoutSession | null> {
    return readJson(this.file("sessions", id), SandboxCheckoutSessionSchema);
  }

  async writeSession(session: SandboxCheckoutSession): Promise<void> {
    await this.write("sessions", session.id, SandboxCheckoutSessionSchema.parse(session));
  }

  readSubscription(customerId: string): Promise<SandboxSubscription | null> {
    return readJson(this.file("subscriptions", customerId), SandboxSubscriptionSchema);
  }

  async writeSubscription(subscription: SandboxSubscription): Promise<void> {
    await this.write("subscriptions", subscription.customerId, SandboxSubscriptionSchema.parse(subscription));
  }

  private async write(folder: string, id: string, value: unknown): Promise<void> {
    const path = this.file(folder, id);
    if (!path) throw new Error(`Invalid sandbox billing id ${id}`);
    await writeJson(path, value);
  }
}
