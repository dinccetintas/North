import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type MiddlewareHandler } from "hono";
import { relative } from "node:path";
import { AdDeliverySchema } from "@north/core";
import { isSandboxAds, isSandboxBilling, isSandboxOutreach, SANDBOX_STRIPE_WEBHOOK_SECRET, type Integrations } from "@north/integrations";
import { z } from "zod";
import { SANDBOX_SENTRY_SECRET, sentrySecretFor, stripeSecretFor, type WorkerEnv } from "./env";
import { isLoopbackHost } from "./host";
import { sandboxBillingRoutes, type SandboxBillingRoutesOptions } from "./sandbox-billing";
import type { SimClock } from "./services/clock";

export { isLoopbackHost };

/** Sandbox and live refs are short identifiers; anything else is refused before it reaches the adapters' path checks. */
const RefSchema = z.string().regex(/^[A-Za-z0-9:._-]{1,120}$/);
const ReplySchema = z.object({ at: z.iso.datetime({ offset: true }).optional() }).default({});
const ClockSchema = z.object({ now: z.iso.datetime({ offset: true }) });

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/** The worker's default port (`WORKER_PORT`); the server always passes its own. */
const DEFAULT_WORKER_PORT = 3101;

/** A loopback authority: one of the loopback names and a port, nothing else (no userinfo, no other name, no trailing dot). */
const LOOPBACK_AUTHORITY = /^(127\.0\.0\.1|localhost|\[::1\]):(\d{1,5})$/i;
const SAFE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);
/** `none`: the user typed the URL or used a bookmark; `same-origin`: a form on the worker's own page. */
const OWN_SITES: ReadonlySet<string> = new Set(["same-origin", "none"]);

export interface SandboxRequestFacts {
  readonly method: string;
  /** The Host header; the request URL's host when no header was sent (an in-process test request). */
  readonly host: string | undefined;
  readonly secFetchSite: string | undefined;
  readonly origin: string | undefined;
}

export type SandboxRefusal = "host" | "cross-site";

/**
 * M6 review L4: why a request to a sandbox route (or to a webhook that
 * verifies with a public sandbox secret) is refused, or null. The Host must
 * be 127.0.0.1, localhost or [::1] with the worker's port, so a DNS-rebound
 * name never reaches the routes. A state change must also not come from
 * another site: Sec-Fetch-Site, when sent, is `same-origin` or `none`, and
 * Origin, when sent, is the worker's own. A request with neither header is a
 * non-browser client (the smoke's and the e2e's plain fetch, the worker's own
 * webhook delivery) and passes; browsers always send one of them on a POST.
 */
export function sandboxRequestRefusal(facts: SandboxRequestFacts, port: number): SandboxRefusal | null {
  const host = (facts.host ?? "").trim().toLowerCase();
  const authority = LOOPBACK_AUTHORITY.exec(host);
  if (!authority || authority[2] !== String(port)) return "host";
  if (SAFE_METHODS.has(facts.method.toUpperCase())) return null;
  const site = facts.secFetchSite?.trim().toLowerCase();
  if (site !== undefined && !OWN_SITES.has(site)) return "cross-site";
  if (facts.origin !== undefined && facts.origin.trim().toLowerCase() !== `http://${host}`) return "cross-site";
  return null;
}

const REFUSALS: Readonly<Record<SandboxRefusal, string>> = Object.freeze({
  host: "sandbox endpoints answer this machine only: the Host must be 127.0.0.1, localhost or [::1] with the worker's port",
  "cross-site": "sandbox endpoints change state only for same-origin requests (the worker's own pages) or non-browser clients",
});

const hostOf = (url: string): string | undefined => {
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
};

/** The guard as middleware: 403 with the reason before any route runs. */
export function sandboxRequestGuard(port: number): MiddlewareHandler {
  return async (c, next) => {
    const refusal = sandboxRequestRefusal({ method: c.req.method, host: c.req.header("host") ?? hostOf(c.req.url), secFetchSite: c.req.header("sec-fetch-site"), origin: c.req.header("origin") }, port);
    if (refusal) return c.json({ error: REFUSALS[refusal] }, 403);
    await next();
  };
}

export type SandboxSitesEnv = Pick<WorkerEnv, "INTEGRATIONS_MODE" | "WORKER_HOST" | "WORKER_PORT" | "SANDBOX_ROOT">;

/**
 * Sandbox "hosting": deployments the sandbox deploy adapter wrote under
 * `<SANDBOX_ROOT>/sites`, served so the evidence verifier's GET is real. On a
 * loopback bind in sandbox mode only (M6 review L5, ADR 0015): a public
 * worker, sandbox by default, never serves agent-written HTML on its origin.
 */
export function sandboxSites(env: SandboxSitesEnv, cwd: string = process.cwd()): Hono {
  const app = new Hono();
  if (env.INTEGRATIONS_MODE !== "sandbox" || !isLoopbackHost(env.WORKER_HOST)) return app;
  const root = relative(cwd, `${env.SANDBOX_ROOT}/sites`) || ".";
  app.use("/sandbox/sites/*", sandboxRequestGuard(env.WORKER_PORT));
  app.use("/sandbox/sites/*", serveStatic({ root, rewriteRequestPath: (path) => path.replace(/^\/sandbox\/sites/, "").replace(/\/$/, "/index.html") }));
  return app;
}

export type WebhookGuardEnv = Pick<WorkerEnv, "INTEGRATIONS_MODE" | "WORKER_HOST" | "WORKER_PORT" | "STRIPE_WEBHOOK_SECRET" | "SENTRY_CLIENT_SECRET">;

/**
 * M6 review L4: a webhook that verifies with a public sandbox secret
 * (`whsec_sandbox`, `sandbox-sentry-secret`) is reachable from this machine
 * only, like the sandbox routes; anyone can sign with that secret, so a
 * rebound browser page must not be able to post to it. Mounted before the
 * webhooks; a real secret means no guard (Stripe and Sentry post from their
 * own hosts).
 */
export function sandboxWebhookGuards(env: WebhookGuardEnv): Hono {
  const app = new Hono();
  const guard = sandboxRequestGuard(env.WORKER_PORT);
  if (stripeSecretFor(env) === SANDBOX_STRIPE_WEBHOOK_SECRET) app.use("/webhooks/stripe", guard);
  if (sentrySecretFor(env) === SANDBOX_SENTRY_SECRET) app.use("/webhooks/sentry", guard);
  return app;
}

/**
 * Simulation routes for the sandbox adapters (M4), the worker's clock (M5)
 * and the sandbox Stripe's checkout and portal pages (M6, BIL-1): the e2e
 * flow, the smoke script and a developer "report" a delivery window or a
 * reply, move the clock, or click through a checkout, through the worker's
 * loopback server. Mounted in sandbox mode on a loopback host only; in live
 * mode, or on a worker bound to any other address, these paths do not exist
 * (404), so nothing can inject figures into a real ledger, move a real day or
 * sign a billing event with the public sandbox secret. Every request also
 * passes `sandboxRequestGuard` for the worker's `port` (M6 review L4).
 */
export function sandboxRoutes(integrations: Integrations, host = "127.0.0.1", simClock: SimClock | null = null, billing: Omit<SandboxBillingRoutesOptions, "billing"> | null = null, port: number = DEFAULT_WORKER_PORT): Hono {
  const app = new Hono();
  const ads = integrations.ads(null);
  const outreach = integrations.outreach(null);
  if (integrations.mode !== "sandbox" || !isLoopbackHost(host) || !isSandboxAds(ads) || !isSandboxOutreach(outreach)) return app;
  app.use("/sandbox/*", sandboxRequestGuard(port));

  app.post("/sandbox/ads/:campaignId/deliver", async (c) => {
    const campaignId = RefSchema.safeParse(c.req.param("campaignId"));
    const body = AdDeliverySchema.safeParse(await c.req.json().catch(() => null));
    if (!campaignId.success || !body.success) return c.json({ error: "expected { spendUsd, impressions, clicks, conversions } for a sandbox campaign id" }, 400);
    try {
      return c.json({ ok: true, delivery: await ads.deliver(campaignId.data, body.data) });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 404);
    }
  });

  app.post("/sandbox/mail/:messageId/reply", async (c) => {
    const messageId = RefSchema.safeParse(c.req.param("messageId"));
    const raw = await c.req.text();
    const body = ReplySchema.safeParse(raw.trim().length === 0 ? {} : parseJson(raw));
    if (!messageId.success || !body.success) return c.json({ error: "expected an optional { at } for a sandbox message id" }, 400);
    try {
      return c.json({ ok: true, reply: await outreach.simulateReply(messageId.data, body.data.at) });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 404);
    }
  });

  if (billing && isSandboxBilling(integrations.billing)) app.route("/", sandboxBillingRoutes({ ...billing, billing: integrations.billing }));

  if (simClock) {
    app.post("/sandbox/clock", async (c) => {
      const body = ClockSchema.safeParse(parseJson(await c.req.text()));
      if (!body.success) return c.json({ error: "expected { now: <ISO datetime> }" }, 400);
      const now = simClock.set(body.data.now);
      return c.json({ ok: true, now: now.toISOString(), offsetMs: simClock.offsetMs });
    });
    app.get("/sandbox/clock", (c) => c.json({ ok: true, now: simClock.now().toISOString(), offsetMs: simClock.offsetMs }));
  }
  return app;
}
