import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SANDBOX_STRIPE_WEBHOOK_SECRET } from "@north/integrations";
import { SimClock } from "../src/services/clock";
import { directSteps, emptyState, fakeDbModule, fakeDeps, seedCompany, type FakeState } from "./fake-db";

/**
 * D6-1 (BIL-1, ADR 0014): the worker's sandbox checkout and portal pages.
 * Text-only HTML with one form per action; every POST signs the sandbox
 * events and posts them to the worker's own `/webhooks/stripe` in order; the
 * browser is sent to the session's stored success URL (never one from the
 * request), a harness gets JSON with each delivery and its exact bytes.
 */

const state: FakeState = emptyState();
const dbModule = fakeDbModule(state);
vi.mock("@north/db", () => dbModule);

const { sandboxRoutes } = await import("../src/sandbox-routes");
const { appliedPoller, webhookDelivery } = await import("../src/sandbox-billing");
const { stripeWebhookRoutes } = await import("../src/webhooks/stripe");
const { applyBillingEvent, createBillingSession } = await import("../src/services/billing");

const OWNER = "7a1f0c4e-2b3d-4e5f-8a9b-0c1d2e3f4a5b";
const C1 = "c1000000-0000-4000-8000-000000000001";
const APP = "http://localhost:3100";
let clock: SimClock;
let root: string;
const deps = () => fakeDeps(state, [], 200, "sandbox", root, clock);

/** In-process stand-in for the HTTP POST: the real webhook route, then the apply the Inngest function would run. */
const deliver = async (signed: { eventId: string; body: string; signature: string }, type: string) => {
  const webhook = stripeWebhookRoutes(deps(), { secret: SANDBOX_STRIPE_WEBHOOK_SECRET, emit: async () => undefined });
  const response = await webhook.request("/webhooks/stripe", { method: "POST", headers: { "stripe-signature": signed.signature }, body: signed.body });
  const body = (await response.json()) as { billingEventId?: string; duplicate?: boolean };
  if (response.status === 200 && body.duplicate === false) await applyBillingEvent(deps(), directSteps, body.billingEventId!, APP);
  return { eventId: signed.eventId, type, status: response.status, response: body, applied: response.status === 200 ? true : null, request: { body: signed.body, signature: signed.signature } };
};
/** The worker's own loopback origin: plain requests (the harness) and the pages' own forms reach the routes through it (M6 review L4). */
const SELF = "http://127.0.0.1:3101";
const routes = (host = "127.0.0.1", integrations = deps().integrations) => {
  const app = sandboxRoutes(integrations, host, clock, { clock: () => clock.now(), deliver, appUrl: APP });
  return { request: (path: string, init?: RequestInit) => app.request(new URL(path, SELF).href, init) };
};

async function checkout(planId: "pro" | "solo" = "pro"): Promise<{ sessionId: string; url: string; csId: string }> {
  const sessionId = "b1000000-0000-4000-8000-000000000001";
  state.billingSessions.set(sessionId, { id: sessionId, userId: OWNER, kind: "checkout", planId, packId: null, status: "requested", url: null, providerRef: null, error: null });
  const ready = await createBillingSession(deps(), directSteps, sessionId, { appUrl: APP, finalAttempt: false });
  if (ready.status !== "ready") throw new Error("checkout not ready");
  return { sessionId, url: ready.url, csId: state.billingSessions.get(sessionId)!.providerRef! };
}

beforeEach(async () => {
  Object.assign(state, emptyState());
  clock = new SimClock("2026-11-02T04:00:00.000Z");
  root = await mkdtemp(join(tmpdir(), "north-sbx-billing-"));
  seedCompany(state, { id: C1, ownerId: OWNER, timezone: "Europe/Istanbul" });
});

describe("D6-1 sandbox checkout page", () => {
  it("GET shows what is bought as escaped text with one form whose submit completes it; no script; an unknown session is 404", async () => {
    const { url, csId } = await checkout();
    const path = new URL(url).pathname;
    const response = await routes().request(path);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'");
    const html = await response.text();
    expect(html).toContain("North Pro: $299 a month, 3 companies, 1000 credits a month.");
    expect(html.match(/<form /g)).toHaveLength(1);
    expect(html).toContain(`action="/sandbox/billing/checkout/${csId}/complete"`);
    expect(html).toContain('type="submit"');
    expect(html).toContain(`href="${APP}/settings/billing?canceled=1"`);
    expect(html).not.toMatch(/<script/i);
    expect((await routes().request("/sandbox/billing/checkout/cs_sandbox_999")).status).toBe(404);
    expect((await routes().request("/sandbox/billing/checkout/..%2Fetc")).status).toBe(404);
  });

  it("POST complete signs the three events, posts them in order and redirects to the stored success URL, whatever the request says", async () => {
    const { sessionId, csId } = await checkout();
    const response = await routes().request(`/sandbox/billing/checkout/${csId}/complete?next=https://evil.example`, { method: "POST", headers: { referer: "https://evil.example" } });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${APP}/settings/billing?checkout=${sessionId}`);
    expect([...state.billingEvents.values()].map((e) => [e.type, e.appliedAt !== null])).toEqual([
      ["checkout.session.completed", true],
      ["customer.subscription.created", true],
      ["invoice.paid", true],
    ]);
    expect(state.entitlements.get(OWNER)).toMatchObject({ status: "active", planId: "pro" });
  });

  it("with Accept: application/json the harness gets each delivery and its bytes; a second click replays the same events as duplicates", async () => {
    const { csId } = await checkout();
    const first = await routes().request(`/sandbox/billing/checkout/${csId}/complete`, { method: "POST", headers: { accept: "application/json" } });
    expect(first.status).toBe(200);
    const body = (await first.json()) as { ok: boolean; deliveries: { eventId: string; type: string; status: number; response: { duplicate: boolean }; request: { body: string; signature: string } }[] };
    expect(body.ok).toBe(true);
    expect(body.deliveries.map((d) => [d.type, d.status, d.response.duplicate])).toEqual([
      ["checkout.session.completed", 200, false],
      ["customer.subscription.created", 200, false],
      ["invoice.paid", 200, false],
    ]);
    expect(body.deliveries[2]?.request.signature).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    const again = (await (await routes().request(`/sandbox/billing/checkout/${csId}/complete`, { method: "POST", headers: { accept: "application/json" } })).json()) as typeof body;
    expect(again.deliveries.map((d) => [d.eventId, d.response.duplicate])).toEqual(body.deliveries.map((d) => [d.eventId, true]));
    expect(state.billingEvents.size).toBe(3);
  });
});

describe("D6-1 sandbox portal page", () => {
  it("GET has one form per action ending in /cancel, /end, /advance, /fail and a way back to North; POST end ends the entitlement and returns to the portal page", async () => {
    const { csId } = await checkout();
    await routes().request(`/sandbox/billing/checkout/${csId}/complete`, { method: "POST" });
    const customer = state.entitlements.get(OWNER)!.stripeCustomerId!;
    const html = await (await routes().request(`/sandbox/billing/portal/${customer}`)).text();
    for (const action of ["cancel", "end", "advance", "fail"]) expect(html).toContain(`action="/sandbox/billing/portal/${customer}/${action}"`);
    expect(html.match(/<form /g)).toHaveLength(4);
    expect(html).toContain(`href="${APP}/settings/billing"`);
    expect(html).toContain("active");
    const end = await routes().request(`/sandbox/billing/portal/${customer}/end`, { method: "POST" });
    expect(end.status).toBe(303);
    expect(end.headers.get("location")).toBe(`/sandbox/billing/portal/${customer}?done=end`);
    expect(state.entitlements.get(OWNER)?.status).toBe("ended");
    expect(state.pausedReasons.get(C1)).toBe("subscription_ended");
    expect(await (await routes().request(`/sandbox/billing/portal/${customer}?done=end`)).text()).toContain("Done: end.");
    expect((await routes().request(`/sandbox/billing/portal/${customer}/cancel`, { method: "POST" })).status).toBe(400);
  });

  it("M6 review L4: a page elsewhere cannot press a button (cross-site form, rebound Host); the portal's own form can", async () => {
    const { csId } = await checkout();
    const forged = await routes().request(`/sandbox/billing/checkout/${csId}/complete`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "sec-fetch-site": "cross-site", origin: "https://evil.example" } });
    expect(forged.status).toBe(403);
    expect(state.billingEvents.size).toBe(0);
    await routes().request(`/sandbox/billing/checkout/${csId}/complete`, { method: "POST", headers: { "sec-fetch-site": "same-origin", origin: SELF } });
    const customer = state.entitlements.get(OWNER)!.stripeCustomerId!;
    const end = `/sandbox/billing/portal/${customer}/end`;
    expect((await routes().request(end, { method: "POST", headers: { "sec-fetch-site": "cross-site", origin: "https://evil.example" } })).status).toBe(403);
    expect((await routes().request(end, { method: "POST", headers: { origin: "null" } })).status).toBe(403);
    expect((await routes().request(end, { method: "POST", headers: { host: "rebound.evil.example:3101", "sec-fetch-site": "same-origin" } })).status).toBe(403);
    expect((await routes().request(`/sandbox/billing/portal/${customer}`, { headers: { host: "rebound.evil.example:3101" } })).status).toBe(403);
    expect(state.entitlements.get(OWNER)?.status).toBe("active");
    const own = await routes().request(end, { method: "POST", headers: { "sec-fetch-site": "same-origin", origin: SELF } });
    expect(own.status).toBe(303);
    expect(state.entitlements.get(OWNER)?.status).toBe("ended");
  });

  it("M6 review L4: a sandbox-signed event posted through a rebound Host is refused before the signature check; nothing is stored", async () => {
    const { sandboxWebhookGuards } = await import("../src/sandbox-routes");
    const { isSandboxBilling, signedSandboxEvent } = await import("@north/integrations");
    const { Hono } = await import("hono");
    const env = { INTEGRATIONS_MODE: "sandbox" as const, WORKER_HOST: "127.0.0.1", WORKER_PORT: 3101, STRIPE_WEBHOOK_SECRET: undefined, SENTRY_CLIENT_SECRET: undefined };
    const server = new Hono().route("/", sandboxWebhookGuards(env)).route("/", stripeWebhookRoutes(deps(), { secret: SANDBOX_STRIPE_WEBHOOK_SECRET, emit: async () => undefined }));
    const { csId } = await checkout();
    const billing = deps().integrations.billing;
    if (!isSandboxBilling(billing)) throw new Error("expected the sandbox billing adapter");
    const [event] = await billing.completeCheckout(csId);
    const signed = signedSandboxEvent(event!, SANDBOX_STRIPE_WEBHOOK_SECRET, clock.now());
    const send = (headers: Record<string, string>) => server.request(`${SELF}/webhooks/stripe`, { method: "POST", headers: { "stripe-signature": signed.signature, ...headers }, body: signed.body });
    expect((await send({ host: "rebound.evil.example:3101" })).status).toBe(403);
    expect((await send({ "sec-fetch-site": "cross-site", origin: "https://evil.example" })).status).toBe(403);
    expect(state.billingEvents.size).toBe(0);
    expect((await send({})).status).toBe(200);
    expect(state.billingEvents.size).toBe(1);
  });

  it("an unknown customer or action is 404; a bad customer id never reaches the adapter", async () => {
    expect((await routes().request("/sandbox/billing/portal/cus_sandbox_404/advance", { method: "POST" })).status).toBe(404);
    expect((await routes().request("/sandbox/billing/portal/cus_sandbox_1/refund", { method: "POST" })).status).toBe(404);
    expect((await routes().request("/sandbox/billing/portal/not-a-customer")).status).toBe(404);
    expect((await routes().request("/sandbox/billing/portal/..%2F..%2Fx/end", { method: "POST" })).status).toBe(404);
  });
});

describe("D6-1 webhookDelivery", () => {
  it("POSTs the signed bytes to the worker's own webhook and waits for the apply before the next event", async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const waited: string[] = [];
    const deliverOne = webhookDelivery({
      url: "http://127.0.0.1:3101/webhooks/stripe",
      fetchImpl: async (url, init) => (calls.push({ url, init }), new Response(JSON.stringify({ billingEventId: "be-1", duplicate: false }), { status: 200 })),
      waitApplied: async (id) => (waited.push(id), true),
    });
    const result = await deliverOne({ eventId: "evt_sandbox_1", body: '{"id":"evt_sandbox_1"}', signature: "t=1,v1=00" }, "invoice.paid");
    expect(result).toMatchObject({ eventId: "evt_sandbox_1", type: "invoice.paid", status: 200, applied: true });
    expect(calls[0]).toMatchObject({ url: "http://127.0.0.1:3101/webhooks/stripe", init: { method: "POST", body: '{"id":"evt_sandbox_1"}', headers: { "stripe-signature": "t=1,v1=00" }, redirect: "manual" } });
    expect(waited).toEqual(["be-1"]);
    const refused = webhookDelivery({ url: "http://127.0.0.1:3101/webhooks/stripe", fetchImpl: async () => new Response("{}", { status: 401 }), waitApplied: async () => true });
    expect(await refused({ eventId: "e", body: "{}", signature: "x" }, "invoice.paid")).toMatchObject({ status: 401, applied: null });
  });
});

describe("D6-1 appliedPoller and the health line", () => {
  it("polls until applied_at is set, and gives up after the timeout", async () => {
    let reads = 0;
    const poll = appliedPoller(async () => (++reads >= 3 ? { appliedAt: "2026-11-02T04:00:01.000Z" } : { appliedAt: null }), 1000, 1);
    expect(await poll("be-1")).toBe(true);
    expect(reads).toBe(3);
    expect(await appliedPoller(async () => null, 20, 5)("be-2")).toBe(false);
  });

  it("/health names mode, runtime, the mounted webhooks and whether the clock is the wall clock, and no secret", async () => {
    const { workerHealth, selfBaseUrl } = await import("../src/health");
    const env = { INTEGRATIONS_MODE: "sandbox", AGENT_RUNTIME: "mock", WORKER_HOST: "127.0.0.1", WORKER_PORT: 3101, SENTRY_CLIENT_SECRET: undefined, STRIPE_WEBHOOK_SECRET: "fake-endpoint-secret" } as const;
    const wall = new SimClock();
    expect(workerHealth(env, () => wall.now(), wall, false)).toMatchObject({ ok: true, mode: "sandbox", runtime: "mock", webhooks: { sentry: true, stripe: true }, clockIsWall: true, tracing: false });
    expect(workerHealth(env, () => clock.now(), clock, false).clockIsWall).toBe(false);
    expect(workerHealth({ ...env, INTEGRATIONS_MODE: "live", STRIPE_WEBHOOK_SECRET: undefined }, () => new Date(), null, true)).toMatchObject({ webhooks: { sentry: false, stripe: false }, clockIsWall: true, tracing: true });
    expect(JSON.stringify(workerHealth(env, () => wall.now(), wall, false))).not.toContain("fake-endpoint-secret");
    expect(selfBaseUrl({ WORKER_HOST: "127.0.0.1", WORKER_PORT: 3101 })).toBe("http://127.0.0.1:3101");
    expect(selfBaseUrl({ WORKER_HOST: "::1", WORKER_PORT: 3101 })).toBe("http://[::1]:3101");
  });
});
