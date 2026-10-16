import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EVENT, parseBillingEvent } from "@north/core";
import { isSandboxBilling, SANDBOX_STRIPE_WEBHOOK_SECRET, signedSandboxEvent, signSandboxWebhook, type SandboxBilling, type SandboxStripeEvent } from "@north/integrations";
import { SimClock } from "../src/services/clock";
import { emptyState, fakeDbModule, fakeDeps, seedCompany, type FakeState } from "./fake-db";

/**
 * D6-2 (BIL-1, ADR 0014): a signed sandbox `subscription.created` → 200 and
 * one row; the same body → 200 duplicate, one row; tampered → 401; a
 * timestamp 10 min old → 401; a `charge.refunded` → 200 ignored, no row; a
 * 2 MB body → 413 before reading; an unknown customer → 202 and `user_id
 * null`; a known type with a bad shape → 400.
 */

const state: FakeState = emptyState();
const dbModule = fakeDbModule(state);
vi.mock("@north/db", () => dbModule);

const { stripeWebhookApp, stripeWebhookRoutes, verifyStripeSignature, MAX_STRIPE_BODY_BYTES } = await import("../src/webhooks/stripe");

const SECRET = SANDBOX_STRIPE_WEBHOOK_SECRET;
const OWNER = "7a1f0c4e-2b3d-4e5f-8a9b-0c1d2e3f4a5b";
const STRANGER = "5b4a3f2e-1d0c-4b9a-8f7e-6d5c4b3a2f1e";
let clock: SimClock;
let root: string;
let emitted: { name: string; data: Record<string, unknown> }[];
const deps = () => fakeDeps(state, [], 200, "sandbox", root, clock);
const app = () => stripeWebhookRoutes(deps(), { secret: SECRET, emit: async (event) => void emitted.push(event) });
const post = (body: string, signature: string | null, headers: Record<string, string> = {}) =>
  app().request("/webhooks/stripe", { method: "POST", headers: { "content-type": "application/json", ...(signature === null ? {} : { "stripe-signature": signature }), ...headers }, body });
const signed = (event: SandboxStripeEvent | Record<string, unknown>, at = clock.now()) => signedSandboxEvent(event as SandboxStripeEvent, SECRET, at);
const rows = () => [...state.billingEvents.values()];

function sandboxBilling(): SandboxBilling {
  const billing = deps().integrations.billing;
  if (!isSandboxBilling(billing)) throw new Error("expected the sandbox billing adapter");
  return billing;
}

/** A Pro checkout completed in the sandbox: checkout.session.completed, customer.subscription.created, invoice.paid. `sessionOf` records the billing_sessions row the worker would have written for that user (L1). */
async function proCheckout(userId = OWNER, storeCustomer = true, sessionOf: string | null = null): Promise<{ readonly customerId: string; readonly events: readonly SandboxStripeEvent[] }> {
  const billing = sandboxBilling();
  const { customerId } = await billing.ensureCustomer({ userId, email: "ceo@example.test" });
  if (storeCustomer) await dbModule.setStripeCustomer({} as never, userId, customerId);
  const session = await billing.createCheckoutSession({ customerId, lookupKey: "north_pro_monthly", mode: "subscription", clientReferenceId: userId, successUrl: "http://localhost:3100/settings/billing?checkout=s1", cancelUrl: "http://localhost:3100/settings/billing?canceled=1", idempotencyKey: `bs-${userId}` });
  if (sessionOf) {
    const id = `b${state.billingSessions.size + 1}000000-0000-4000-8000-000000000000`.slice(0, 36);
    state.billingSessions.set(id, { id, userId: sessionOf, kind: "checkout", planId: "pro", packId: null, status: "ready", url: session.url, providerRef: session.providerRef, error: null });
  }
  return { customerId, events: await billing.completeCheckout(session.providerRef) };
}

beforeEach(async () => {
  Object.assign(state, emptyState());
  clock = new SimClock("2026-11-02T04:00:00.000Z");
  root = await mkdtemp(join(tmpdir(), "north-stripe-"));
  emitted = [];
  seedCompany(state, { id: "c1000000-0000-4000-8000-000000000001", ownerId: OWNER, timezone: "Europe/Istanbul" });
});

describe("D6-2 verifyStripeSignature", () => {
  it("accepts HMAC-SHA256 of t.body with the endpoint secret within 300 s, any of several v1, and refuses everything else", () => {
    const body = '{"id":"evt_1"}';
    const now = clock.now();
    const header = signSandboxWebhook(body, SECRET, now);
    expect(verifyStripeSignature(body, header, SECRET, now)).toBe(true);
    expect(verifyStripeSignature(Buffer.from(body), header, SECRET, now)).toBe(true);
    expect(verifyStripeSignature(body, `${header},v1=${"0".repeat(64)}`, SECRET, now)).toBe(true);
    expect(verifyStripeSignature(`${body} `, header, SECRET, now)).toBe(false);
    expect(verifyStripeSignature(body, header, "whsec_other", now)).toBe(false);
    expect(verifyStripeSignature(body, header, SECRET, new Date(now.getTime() + 301_000))).toBe(false);
    expect(verifyStripeSignature(body, header.replace(/v1=[0-9a-f]+/, "v1=zz"), SECRET, now)).toBe(false);
    for (const bad of [undefined, "", "t=abc,v1=00", `v1=${"a".repeat(64)}`, `t=${Math.floor(now.getTime() / 1000)}`, "x".repeat(3000)]) expect(verifyStripeSignature(body, bad, SECRET, now)).toBe(false);
  });
});

describe("D6-2 POST /webhooks/stripe", () => {
  it("a signed subscription.created → 200, one row for the customer's user, billing/event emitted; the same body → 200 duplicate, still one row", async () => {
    const { events } = await proCheckout();
    const created = signed(events[1]!);
    const first = await post(created.body, created.signature);
    expect(first.status).toBe(200);
    const body = (await first.json()) as { billingEventId: string; duplicate: boolean };
    expect(body).toEqual({ billingEventId: expect.any(String), duplicate: false });
    expect(rows()).toEqual([expect.objectContaining({ id: body.billingEventId, eventId: events[1]!.id, type: "customer.subscription.created", userId: OWNER, appliedAt: null })]);
    expect(emitted).toEqual([{ name: EVENT.billingEvent, data: { billingEventId: body.billingEventId, userId: OWNER } }]);

    const replay = await post(created.body, created.signature);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ billingEventId: body.billingEventId, duplicate: true });
    expect(rows()).toHaveLength(1);
    // Not applied yet (the first emit could have been lost): the replay asks again; once applied, a replay emits nothing.
    expect(emitted).toHaveLength(2);
    state.billingEvents.get(body.billingEventId)!.appliedAt = clock.now().toISOString();
    expect((await post(created.body, created.signature)).status).toBe(200);
    expect(emitted).toHaveLength(2);
  });

  it("tampered by one byte → 401 and nothing; a signature 10 minutes old → 401; no header → 401", async () => {
    const { events } = await proCheckout();
    const paid = signed(events[2]!);
    const tampered = paid.body.replace('"amount_paid":29900', '"amount_paid":29901');
    expect(tampered).not.toBe(paid.body);
    expect((await post(tampered, paid.signature)).status).toBe(401);
    const stale = signed(events[2]!, new Date(clock.now().getTime() - 10 * 60_000));
    expect((await post(stale.body, stale.signature)).status).toBe(401);
    expect((await post(paid.body, null)).status).toBe(401);
    expect(rows()).toEqual([]);
    expect(emitted).toEqual([]);
  });

  it("a charge.refunded → 200 ignored and no row; a known type with a bad shape → 400", async () => {
    const refund = signed({ id: "evt_refund_1", object: "event", type: "charge.refunded", created: 1, data: { object: { id: "ch_1" } } });
    const ignored = await post(refund.body, refund.signature);
    expect(ignored.status).toBe(200);
    expect(await ignored.json()).toEqual({ ignored: "charge.refunded" });
    const bad = signed({ id: "evt_bad_1", object: "event", type: "invoice.paid", created: 1, data: { object: { customer: "cus_x" } } });
    expect((await post(bad.body, bad.signature)).status).toBe(400);
    const notJson = "not json";
    expect((await post(notJson, signSandboxWebhook(notJson, SECRET, clock.now()))).status).toBe(200);
    expect(rows()).toEqual([]);
  });

  it("a 2 MB body → 413 before it is read or verified, declared or streamed", async () => {
    const declared = await post("{}", "t=1,v1=00", { "content-length": String(2 * 1024 * 1024) });
    expect(declared.status).toBe(413);
    const chunks = Buffer.from("x".repeat(2 * 1024 * 1024));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < chunks.length; i += 64 * 1024) controller.enqueue(chunks.subarray(i, i + 64 * 1024));
        controller.close();
      },
    });
    const streamed = await app().request("/webhooks/stripe", { method: "POST", headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=00" }, body: stream, duplex: "half" } as RequestInit);
    expect(streamed.status).toBe(413);
    expect(MAX_STRIPE_BODY_BYTES).toBe(256 * 1024);
    expect(rows()).toEqual([]);
  });

  it("an unknown customer → 202, stored with user_id null, nothing emitted", async () => {
    const { events } = await proCheckout(STRANGER, false);
    const created = signed(events[1]!);
    const response = await post(created.body, created.signature);
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ duplicate: false, ignored: "unknown customer" });
    expect(rows()).toEqual([expect.objectContaining({ userId: null, type: "customer.subscription.created" })]);
    expect(emitted).toEqual([]);
  });

  it("checkout.session.completed only: an existing user's client_reference_id resolves a customer not stored yet; a stranger's does not", async () => {
    const { events } = await proCheckout(OWNER, false, OWNER);
    const checkout = signed(events[0]!);
    expect((await post(checkout.body, checkout.signature)).status).toBe(200);
    expect(rows()[0]).toMatchObject({ type: "checkout.session.completed", userId: OWNER });
    const sub = signed(events[1]!);
    expect((await post(sub.body, sub.signature)).status).toBe(202);
    const other = await proCheckout(STRANGER, false, STRANGER);
    const strangers = signed(other.events[0]!);
    expect((await post(strangers.body, strangers.signature)).status).toBe(202);
  });

  it("L1: the hint is trusted only for a session the worker created for that user: none, or another user's, is unknown (202)", async () => {
    const noRow = await proCheckout(OWNER, false, null);
    const unproven = signed(noRow.events[0]!);
    expect((await post(unproven.body, unproven.signature)).status).toBe(202);
    Object.assign(state, emptyState());
    seedCompany(state, { id: "c1000000-0000-4000-8000-000000000001", ownerId: OWNER, timezone: "Europe/Istanbul" });
    root = await mkdtemp(join(tmpdir(), "north-stripe-"));
    const foreign = await proCheckout(OWNER, false, STRANGER);
    const forged = signed(foreign.events[0]!);
    expect((await post(forged.body, forged.signature)).status).toBe(202);
    expect(rows().map((r) => r.userId)).toEqual([null]);
    expect(emitted).toEqual([]);
  });

  it("L2: the stored payload is the reduced event core parsed (no email, address or invoice URL) plus the sha256 of the raw body; it re-parses to itself", async () => {
    const { events } = await proCheckout();
    const raw = { ...events[2]!, data: { object: { ...(events[2]!.data.object as Record<string, unknown>), customer_email: "ceo@example.test", customer_address: { line1: "1 Main St" }, hosted_invoice_url: "https://invoice.stripe.com/i/x" } } };
    const delivery = signed(raw);
    expect((await post(delivery.body, delivery.signature)).status).toBe(200);
    const [row] = rows();
    expect(row!.payloadSha256).toBe(createHash("sha256").update(delivery.body).digest("hex"));
    const stored = JSON.stringify(row!.payload);
    for (const leaked of ["ceo@example.test", "1 Main St", "hosted_invoice_url", "invoice.stripe.com", "api_version", "livemode"]) expect(stored).not.toContain(leaked);
    expect(parseBillingEvent(row!.payload)).toEqual(row!.payload);
    expect(row!.payload).toMatchObject({ id: events[2]!.id, type: "invoice.paid", data: { object: { amount_paid: 29_900, billing_reason: "subscription_create" } } });
  });
});

describe("D6-1 stripeWebhookApp", () => {
  it("is mounted with the sandbox secret on loopback and absent (404) off loopback or in live mode without a secret", async () => {
    const { events } = await proCheckout();
    const created = signed(events[1]!);
    const request = (a: ReturnType<typeof stripeWebhookApp>) => a.request("/webhooks/stripe", { method: "POST", headers: { "stripe-signature": created.signature }, body: created.body });
    const emit = async () => undefined;
    expect((await request(stripeWebhookApp(deps(), { INTEGRATIONS_MODE: "sandbox", WORKER_HOST: "127.0.0.1" }, emit))).status).toBe(200);
    expect((await request(stripeWebhookApp(deps(), { INTEGRATIONS_MODE: "sandbox", WORKER_HOST: "0.0.0.0" }, emit))).status).toBe(404);
    expect((await request(stripeWebhookApp(deps(), { INTEGRATIONS_MODE: "live", WORKER_HOST: "127.0.0.1" }, emit))).status).toBe(404);
    expect((await request(stripeWebhookApp(deps(), { INTEGRATIONS_MODE: "live", WORKER_HOST: "0.0.0.0", STRIPE_WEBHOOK_SECRET: "fake-endpoint-secret" }, emit))).status).toBe(401);
  });
});
