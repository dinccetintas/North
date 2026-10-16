import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { createSandboxIntegrations, type Integrations } from "@north/integrations";
import { isLoopbackHost, sandboxRequestRefusal, sandboxRoutes, sandboxSites, sandboxWebhookGuards } from "../src/sandbox-routes";

/**
 * D4-5 simulation routes: a delivery window and a reply can be reported to
 * the sandbox adapters through the worker's loopback server; bodies are
 * validated; unknown refs are 404; in live mode the routes do not exist.
 * M6 review L4/L5: every `/sandbox/*` request needs a loopback Host with the
 * worker's port, a state change also a same-origin browser context (or no
 * browser at all), and the sites exist on a loopback bind only.
 */

const PORT = 3101;
const SELF = `http://127.0.0.1:${PORT}`;

let integrations: ReturnType<typeof createSandboxIntegrations>;

type App = { request: Hono["request"] };
/** Plain `fetch` from the smoke or the e2e: the worker's own origin, no Sec-Fetch-Site, no Origin. */
const post = (app: App, path: string, body?: string, headers: Record<string, string> = {}) =>
  app.request(`${SELF}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, ...(body === undefined ? {} : { body }) });

beforeEach(async () => {
  integrations = createSandboxIntegrations(undefined, { root: await mkdtemp(join(tmpdir(), "north-routes-")) });
});

describe("sandbox routes", () => {
  it("POST /sandbox/ads/:campaignId/deliver appends a delivery the insights then report; a bad body is 400, an unknown campaign 404", async () => {
    const app = sandboxRoutes(integrations);
    const { campaignId } = await integrations.ads(null).startCampaign({ companyId: "company-1", name: "Launch", dailyBudgetUsd: 10 });
    const ok = await post(app, `/sandbox/ads/${encodeURIComponent(campaignId)}/deliver`, JSON.stringify({ spendUsd: 4, impressions: 800, clicks: 12, conversions: 1 }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, delivery: { spendUsd: 4, impressions: 800, clicks: 12, conversions: 1 } });
    expect(await integrations.ads(null).insights("company-1", campaignId)).toMatchObject({ spendUsd: 4, clicks: 12, conversions: 1 });
    expect((await post(app, `/sandbox/ads/${encodeURIComponent(campaignId)}/deliver`, JSON.stringify({ spendUsd: -1 }))).status).toBe(400);
    expect((await post(app, `/sandbox/ads/${encodeURIComponent(campaignId)}/deliver`, "not json")).status).toBe(400);
    expect((await post(app, `/sandbox/ads/${encodeURIComponent(campaignId)}/deliver`)).status).toBe(400);
    expect((await post(app, "/sandbox/ads/sandbox:campaign:nope/deliver", JSON.stringify({ spendUsd: 1, impressions: 1, clicks: 1, conversions: 0 }))).status).toBe(404);
    expect((await post(app, "/sandbox/ads/..%2F..%2Fetc/deliver", JSON.stringify({ spendUsd: 1, impressions: 1, clicks: 1, conversions: 0 }))).status).toBe(400);
  });

  it("POST /sandbox/mail/:messageId/reply records a reply (optional { at }); unknown message 404, bad body 400", async () => {
    const app = sandboxRoutes(integrations);
    const { messageId } = await integrations.outreach(null).send({ companyId: "company-1", to: "a@example.test", subject: "Hi", text: "t", kind: "first_contact" });
    expect((await post(app, `/sandbox/mail/${encodeURIComponent(messageId)}/reply`)).status).toBe(200);
    const dated = await post(app, `/sandbox/mail/${encodeURIComponent(messageId)}/reply`, JSON.stringify({ at: "2026-10-15T10:00:00.000Z" }));
    expect(await dated.json()).toEqual({ ok: true, reply: { at: "2026-10-15T10:00:00.000Z" } });
    expect(await integrations.outreach(null).replies({ companyId: "company-1", messageIds: [messageId] })).toEqual([{ messageId, replies: 2, lastReplyAt: expect.any(String) }]);
    expect((await post(app, `/sandbox/mail/${encodeURIComponent(messageId)}/reply`, JSON.stringify({ at: "yesterday" }))).status).toBe(400);
    expect((await post(app, "/sandbox/mail/sandbox:msg:nope/reply")).status).toBe(404);
  });

  it("M4 review L4: the routes exist only on a loopback host; a worker bound to 0.0.0.0 serves none of them", async () => {
    for (const host of ["0.0.0.0", "10.0.0.5", "worker.internal", ""]) {
      const app = sandboxRoutes(integrations, host);
      expect((await post(app, "/sandbox/ads/x/deliver", JSON.stringify({ spendUsd: 4, impressions: 1, clicks: 1, conversions: 0 }))).status).toBe(404);
      expect((await post(app, "/sandbox/mail/x/reply")).status).toBe(404);
    }
    for (const host of ["127.0.0.1", "localhost", "::1", "[::1]"]) {
      expect((await post(sandboxRoutes(integrations, host), "/sandbox/mail/sandbox:msg:nope/reply")).status).toBe(404);
      expect((await post(sandboxRoutes(integrations, host), "/sandbox/ads/x/deliver", "nope")).status).toBe(400);
    }
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
  });

  it("in live mode neither route exists (404): nothing can inject figures into a real ledger", async () => {
    const live = { ...integrations, mode: "live" } as unknown as Integrations;
    const app = sandboxRoutes(live);
    expect((await post(app, "/sandbox/ads/x/deliver", JSON.stringify({ spendUsd: 4, impressions: 1, clicks: 1, conversions: 0 }))).status).toBe(404);
    expect((await post(app, "/sandbox/mail/x/reply")).status).toBe(404);
  });
});

describe("M6 review L4: loopback Host and same-origin on every /sandbox/* request", () => {
  it("refuses a rebound or foreign Host and a cross-site browser; lets plain clients and the worker's own pages through", () => {
    const refusal = (facts: Partial<Parameters<typeof sandboxRequestRefusal>[0]>) => sandboxRequestRefusal({ method: "POST", host: "127.0.0.1:3101", secFetchSite: undefined, origin: undefined, ...facts }, PORT);
    // Plain fetch (smoke, e2e helpers, the worker's own webhook delivery): no Sec-Fetch-Site, no Origin.
    expect(refusal({})).toBeNull();
    expect(refusal({ host: "localhost:3101" })).toBeNull();
    expect(refusal({ host: "[::1]:3101" })).toBeNull();
    expect(refusal({ host: "LOCALHOST:3101" })).toBeNull();
    // A form on the worker's own page (the sandbox checkout and portal), or the user typing the URL.
    expect(refusal({ secFetchSite: "same-origin", origin: SELF })).toBeNull();
    expect(refusal({ host: "localhost:3101", secFetchSite: "same-origin", origin: "http://localhost:3101" })).toBeNull();
    expect(refusal({ secFetchSite: "none" })).toBeNull();
    expect(refusal({ origin: SELF })).toBeNull();
    // DNS rebinding and other hosts or ports.
    for (const host of ["evil.example:3101", "127.0.0.1", "127.0.0.1:3102", "localhost.evil.example:3101", "127.0.0.1:3101@evil.example", "0.0.0.0:3101", "10.0.0.5:3101", "", undefined]) {
      expect(refusal({ host })).toBe("host");
      expect(refusal({ host, method: "GET" })).toBe("host");
    }
    // A cross-site page auto-posting a form or a text/plain JSON.
    expect(refusal({ secFetchSite: "cross-site", origin: "https://evil.example" })).toBe("cross-site");
    expect(refusal({ secFetchSite: "same-site", origin: "http://localhost:3100" })).toBe("cross-site");
    expect(refusal({ origin: "https://evil.example" })).toBe("cross-site");
    expect(refusal({ origin: "null" })).toBe("cross-site");
    expect(refusal({ origin: "http://127.0.0.1:3102" })).toBe("cross-site");
    expect(refusal({ secFetchSite: "same-origin", origin: "https://evil.example" })).toBe("cross-site");
    // A GET changes nothing: the web's go page navigates here cross-site (localhost:3100 → 127.0.0.1:3101).
    expect(refusal({ method: "GET", secFetchSite: "cross-site", origin: "http://localhost:3100" })).toBeNull();
    expect(refusal({ method: "HEAD", secFetchSite: "cross-site" })).toBeNull();
  });

  it("a cross-site POST or a rebound Host is 403 before the route runs: no reply is recorded", async () => {
    const app = sandboxRoutes(integrations);
    const { messageId } = await integrations.outreach(null).send({ companyId: "company-1", to: "a@example.test", subject: "Hi", text: "t", kind: "first_contact" });
    const path = `/sandbox/mail/${encodeURIComponent(messageId)}/reply`;
    const crossSite = await post(app, path, undefined, { "content-type": "text/plain", "sec-fetch-site": "cross-site", origin: "https://evil.example" });
    expect(crossSite.status).toBe(403);
    expect(await crossSite.json()).toEqual({ error: expect.stringContaining("same-origin") });
    expect((await post(app, path, undefined, { origin: "https://evil.example" })).status).toBe(403);
    expect((await post(app, path, undefined, { host: "evil.example:3101" })).status).toBe(403);
    expect((await app.request(`http://localhost${path}`, { method: "POST" })).status).toBe(403);
    expect(await integrations.outreach(null).replies({ companyId: "company-1", messageIds: [messageId] })).toEqual([{ messageId, replies: 0, lastReplyAt: null }]);
    expect((await post(app, path, undefined, { "sec-fetch-site": "same-origin", origin: SELF })).status).toBe(200);
    expect((await post(sandboxRoutes(integrations, "127.0.0.1", null, null, 4000), path)).status).toBe(403);
  });
});

describe("M6 review L5: the sandbox sites", () => {
  async function siteRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "north-sites-"));
    await mkdir(join(root, "sites", "site-1"), { recursive: true });
    await writeFile(join(root, "sites", "site-1", "index.html"), "<h1>sandbox site</h1>");
    return root;
  }
  const env = (root: string, overrides: Partial<Parameters<typeof sandboxSites>[0]> = {}) => ({ INTEGRATIONS_MODE: "sandbox" as const, WORKER_HOST: "127.0.0.1", WORKER_PORT: PORT, SANDBOX_ROOT: root, ...overrides });
  /** Mounted the way server.ts mounts it: a sub-app routed into the server's app. */
  const server = (sites: Hono) => new Hono().route("/", sites);

  it("are served on a loopback bind to a loopback Host, with the index for a directory", async () => {
    const app = server(sandboxSites(env(await siteRoot())));
    const page = await app.request(`${SELF}/sandbox/sites/site-1/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("sandbox site");
    expect((await app.request(`${SELF}/sandbox/sites/site-1/index.html`)).status).toBe(200);
    expect((await app.request(`${SELF}/sandbox/sites/site-1/index.html`, { headers: { host: "evil.example:3101" } })).status).toBe(403);
    expect((await app.request(`${SELF}/sandbox/sites/nope/index.html`)).status).toBe(404);
  });

  it("do not exist on 0.0.0.0 or any other bind, nor in live mode (404), even when the file is there", async () => {
    const root = await siteRoot();
    for (const overrides of [{ WORKER_HOST: "0.0.0.0" }, { WORKER_HOST: "10.0.0.5" }, { WORKER_HOST: "worker.internal" }, { INTEGRATIONS_MODE: "live" as const }]) {
      const app = server(sandboxSites(env(root, overrides)));
      expect((await app.request(`${SELF}/sandbox/sites/site-1/index.html`)).status).toBe(404);
      expect((await app.request("https://north-worker.fly.dev/sandbox/sites/site-1/index.html")).status).toBe(404);
    }
  });
});

describe("M6 review L4: the webhooks that verify with a public sandbox secret", () => {
  const sandboxEnv = { INTEGRATIONS_MODE: "sandbox" as const, WORKER_HOST: "127.0.0.1", WORKER_PORT: PORT, STRIPE_WEBHOOK_SECRET: undefined, SENTRY_CLIENT_SECRET: undefined };
  /** The guards in front of stand-in webhook routes, in the order server.ts mounts them. */
  const server = (env: Parameters<typeof sandboxWebhookGuards>[0]) =>
    new Hono()
      .route("/", sandboxWebhookGuards(env))
      .post("/webhooks/stripe", (c) => c.json({ reached: "stripe" }))
      .post("/webhooks/sentry", (c) => c.json({ reached: "sentry" }));

  it("answer loopback, non-cross-site requests only while the sandbox secret is the one that verifies", async () => {
    const app = server(sandboxEnv);
    for (const hook of ["stripe", "sentry"]) {
      expect((await post(app, `/webhooks/${hook}`, "{}")).status).toBe(200);
      expect((await post(app, `/webhooks/${hook}`, "{}", { host: "rebound.evil.example:3101" })).status).toBe(403);
      expect((await post(app, `/webhooks/${hook}`, "{}", { "sec-fetch-site": "cross-site", origin: "https://evil.example" })).status).toBe(403);
    }
  });

  it("are not guarded once a real secret is set: Stripe and Sentry deliver from their own hosts", async () => {
    const app = server({ ...sandboxEnv, STRIPE_WEBHOOK_SECRET: "whsec_real_endpoint_secret", SENTRY_CLIENT_SECRET: "real-sentry-secret" });
    expect((await app.request("https://north-worker.fly.dev/webhooks/stripe", { method: "POST", body: "{}" })).status).toBe(200);
    expect((await app.request("https://north-worker.fly.dev/webhooks/sentry", { method: "POST", body: "{}" })).status).toBe(200);
    const onlySentry = server({ ...sandboxEnv, STRIPE_WEBHOOK_SECRET: "whsec_real_endpoint_secret" });
    expect((await onlySentry.request("https://north-worker.fly.dev/webhooks/stripe", { method: "POST", body: "{}" })).status).toBe(200);
    expect((await onlySentry.request("https://north-worker.fly.dev/webhooks/sentry", { method: "POST", body: "{}" })).status).toBe(403);
  });
});
