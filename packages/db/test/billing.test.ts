import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBillingSession, getBillingEvent, getBillingSession, insertBillingEvent, markBillingEventApplied, setBillingSessionFailed, setBillingSessionReady } from "../src/billing";
import { DbError } from "../src/errors";
import { createTestUser, deleteTestUser, raw, service, type RawClient, type TestUser } from "./fixtures";

const rand = () => Math.random().toString(36).slice(2, 10);
/** The sha256 of a raw body the worker stores with the reduced event (L2); its value does not matter here. */
const HASH = "a".repeat(64);

describe("billing repository (BIL-1: sessions and events)", () => {
  let owner: TestUser;
  let stranger: TestUser;

  beforeAll(async () => {
    owner = await createTestUser("billing");
    stranger = await createTestUser("billing-stranger");
  });

  afterAll(async () => {
    await deleteTestUser(owner);
    await deleteTestUser(stranger);
  });

  it("the owner requests a checkout, a portal or a credit-pack session; the plan and pack are validated before any write", async () => {
    const checkout = await createBillingSession(owner.client, { userId: owner.id, kind: "checkout", planId: "pro" });
    expect(checkout).toMatchObject({ userId: owner.id, kind: "checkout", planId: "pro", packId: null, status: "requested", url: null, providerRef: null, error: null });
    expect(Object.isFrozen(checkout)).toBe(true);
    expect(await createBillingSession(owner.client, { userId: owner.id, kind: "portal" })).toMatchObject({ kind: "portal", planId: null });
    expect(await createBillingSession(owner.client, { userId: owner.id, kind: "credit_pack", packId: "pack_100" })).toMatchObject({ kind: "credit_pack", packId: "pack_100" });
    await expect(createBillingSession(owner.client, { userId: owner.id, kind: "credit_pack", packId: "pack_free" })).rejects.toThrow();
    await expect(createBillingSession(owner.client, { userId: owner.id, kind: "checkout", planId: "gold" as never })).rejects.toThrow();
    await expect(createBillingSession(owner.client, { userId: stranger.id, kind: "portal" })).rejects.toBeInstanceOf(DbError);
    expect(await getBillingSession(owner.client, checkout.id)).toEqual(checkout);
    expect(await getBillingSession(stranger.client, checkout.id)).toBeNull();
  });

  it("the owner cannot insert a ready session; the worker writes the URL once and a failure with a fixed message", async () => {
    const forged = await (owner.client as unknown as RawClient).from("billing_sessions").insert({ user_id: owner.id, kind: "portal", status: "ready", url: "https://evil.example" });
    expect(forged.error).not.toBeNull();
    const session = await createBillingSession(owner.client, { userId: owner.id, kind: "checkout", planId: "scale" });
    await expect(setBillingSessionReady(owner.client, session.id, { url: "https://evil.example", providerRef: "cs_evil" })).rejects.toBeInstanceOf(DbError);
    const url = `http://127.0.0.1:3101/sandbox/billing/checkout/${session.id}`;
    const ready = await setBillingSessionReady(service, session.id, { url, providerRef: `cs_${rand()}` });
    expect(ready).toMatchObject({ status: "ready", url });
    expect(await setBillingSessionReady(service, session.id, { url: "https://elsewhere.example", providerRef: "cs_again" })).toEqual(ready);
    await expect(setBillingSessionReady(service, session.id, { url: "javascript:alert(1)", providerRef: null })).rejects.toThrow();
    expect((await getBillingSession(owner.client, session.id))?.url).toBe(url);
    const other = await createBillingSession(owner.client, { userId: owner.id, kind: "portal" });
    expect(await setBillingSessionFailed(service, other.id, "The billing provider is unavailable.")).toMatchObject({ status: "failed", error: "The billing provider is unavailable.", url: null });
    await expect(setBillingSessionReady(service, other.id, { url, providerRef: null })).rejects.toBeInstanceOf(DbError);
  });

  it("insertBillingEvent is idempotent by the Stripe event id: a duplicate returns the first row and changes nothing", async () => {
    const eventId = `evt_${rand()}`;
    const payload = { id: eventId, type: "invoice.paid", created: 1, data: { object: { id: "in_1" } } };
    const first = await insertBillingEvent(service, { eventId, type: "invoice.paid", userId: owner.id, payload, payloadSha256: HASH });
    expect(first.duplicate).toBe(false);
    const replay = await insertBillingEvent(service, { eventId, type: "invoice.paid", userId: owner.id, payload: { forged: true }, payloadSha256: HASH });
    expect(replay).toEqual({ id: first.id, duplicate: true });
    const stored = await getBillingEvent(service, first.id);
    expect(stored).toMatchObject({ id: first.id, eventId, type: "invoice.paid", userId: owner.id, payload, appliedAt: null });
    const unknown = await insertBillingEvent(service, { eventId: `evt_${rand()}`, type: "customer.subscription.deleted", userId: null, payload: {}, payloadSha256: HASH });
    expect((await getBillingEvent(service, unknown.id))?.userId).toBeNull();
    await expect(insertBillingEvent(service, { eventId: `evt_${rand()}`, type: "charge.refunded" as never, userId: null, payload: {}, payloadSha256: HASH })).rejects.toThrow();
    await expect(insertBillingEvent(owner.client, { eventId: `evt_${rand()}`, type: "invoice.paid", userId: owner.id, payload: {}, payloadSha256: HASH })).rejects.toBeInstanceOf(DbError);
    expect(await getBillingEvent(owner.client, first.id)).toBeNull();
  });

  it("markBillingEventApplied sets applied_at once and reports whether this call did", async () => {
    const event = await insertBillingEvent(service, { eventId: `evt_${rand()}`, type: "invoice.payment_failed", userId: owner.id, payload: {}, payloadSha256: HASH });
    expect(await markBillingEventApplied(service, event.id)).toBe(true);
    expect(await markBillingEventApplied(service, event.id)).toBe(false);
    expect((await getBillingEvent(service, event.id))?.appliedAt).toEqual(expect.any(String));
    expect((await raw.from("billing_events").select("id", { count: "exact", head: true }).eq("event_id", (await getBillingEvent(service, event.id))!.eventId)).count).toBe(1);
  });
});
