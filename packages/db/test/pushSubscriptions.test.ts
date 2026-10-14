import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DbError } from "../src/errors";
import { listPushSubscriptions, removePushSubscription, upsertPushSubscription } from "../src/pushSubscriptions";
import { createTestUser, deleteTestUser, service, type TestUser } from "./fixtures";

describe("push subscriptions repository (decision notifications)", () => {
  let alice: TestUser;
  let bob: TestUser;
  const endpoint = (label: string) => `https://push.example.com/${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  beforeAll(async () => {
    alice = await createTestUser("push-alice");
    bob = await createTestUser("push-bob");
  });

  afterAll(async () => {
    await deleteTestUser(alice);
    await deleteTestUser(bob);
  });

  it("upsertPushSubscription stores one row per endpoint and refreshes the keys on re-subscribe", async () => {
    const ep = endpoint("alice");
    await upsertPushSubscription(alice.client, { userId: alice.id, endpoint: ep, p256dh: "p1", auth: "a1" });
    await upsertPushSubscription(alice.client, { userId: alice.id, endpoint: ep, p256dh: "p2", auth: "a2" });
    const mine = await listPushSubscriptions(alice.client, alice.id);
    expect(mine.filter((s) => s.endpoint === ep)).toEqual([{ endpoint: ep, p256dh: "p2", auth: "a2" }]);
    expect(Object.isFrozen(mine)).toBe(true);
  });

  it("listPushSubscriptions is scoped to the signed-in user; the service role sees everyone", async () => {
    const ep = endpoint("bob");
    await upsertPushSubscription(bob.client, { userId: bob.id, endpoint: ep, p256dh: "pb", auth: "ab" });
    expect((await listPushSubscriptions(bob.client, bob.id)).map((s) => s.endpoint)).toEqual([ep]);
    expect(await listPushSubscriptions(alice.client, bob.id)).toEqual([]);
    expect((await listPushSubscriptions(service, bob.id)).map((s) => s.endpoint)).toEqual([ep]);
  });

  it("removePushSubscription deletes only the caller's row", async () => {
    const ep = endpoint("alice-remove");
    await upsertPushSubscription(alice.client, { userId: alice.id, endpoint: ep, p256dh: "p", auth: "a" });
    await removePushSubscription(bob.client, alice.id, ep);
    expect((await listPushSubscriptions(service, alice.id)).some((s) => s.endpoint === ep)).toBe(true);
    await removePushSubscription(alice.client, alice.id, ep);
    expect((await listPushSubscriptions(service, alice.id)).some((s) => s.endpoint === ep)).toBe(false);
  });

  it("another user cannot claim or forge a subscription for someone else", async () => {
    const [mine] = await listPushSubscriptions(service, alice.id);
    await expect(upsertPushSubscription(bob.client, { userId: bob.id, endpoint: mine!.endpoint, p256dh: "x", auth: "y" })).rejects.toBeInstanceOf(DbError);
    await expect(upsertPushSubscription(bob.client, { userId: alice.id, endpoint: endpoint("forged"), p256dh: "x", auth: "y" })).rejects.toBeInstanceOf(DbError);
    expect((await listPushSubscriptions(service, alice.id)).find((s) => s.endpoint === mine!.endpoint)?.p256dh).toBe(mine!.p256dh);
  });

  it("rejects malformed input before touching the database", async () => {
    await expect(upsertPushSubscription(service, { userId: alice.id, endpoint: "not a url", p256dh: "p", auth: "a" })).rejects.toThrow();
    await expect(upsertPushSubscription(service, { userId: alice.id, endpoint: endpoint("x"), p256dh: "", auth: "a" })).rejects.toThrow();
    await expect(upsertPushSubscription(service, { userId: "nope", endpoint: endpoint("x"), p256dh: "p", auth: "a" })).rejects.toThrow();
    await expect(listPushSubscriptions(service, "nope")).rejects.toThrow();
  });
});
