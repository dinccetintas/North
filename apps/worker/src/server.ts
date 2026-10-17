import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { serve as inngestServe } from "inngest/hono";
import { getBillingEvent } from "@north/db";
import { buildDeps } from "./deps";
import { sentryWebhookLabel, stripeWebhookLabel, workerEnv } from "./env";
import { selfBaseUrl, workerHealth } from "./health";
import { isLoopbackHost } from "./host";
import { inngest } from "./inngest/client";
import { functions } from "./inngest/index";
import { initObservability } from "./observability";
import { appliedPoller, webhookDelivery } from "./sandbox-billing";
import { sandboxRoutes, sandboxSites, sandboxWebhookGuards } from "./sandbox-routes";
import { sentryWebhookApp } from "./webhooks/sentry";
import { stripeWebhookApp } from "./webhooks/stripe";

const env = workerEnv();
const observed = initObservability(env);
const deps = await buildDeps(env);

const app = new Hono();
app.get("/health", (c) => c.json(workerHealth(env, { clock: deps.clock, simClock: deps.simClock, tracing: deps.tracer.enabled, fence: deps.fence, gateway: deps.gateway })));

// M6 review L4: while a webhook verifies with its public sandbox secret, only this machine may post to it (loopback Host, not cross-site).
app.route("/", sandboxWebhookGuards(env));
// PRO-2: Sentry's issue webhook lands on the worker (ADR 0013); the route exists only when a verification secret resolves
// (the sandbox default on a loopback host, or SENTRY_CLIENT_SECRET; M5 review M1).
app.route("/", sentryWebhookApp(deps, env, (event) => inngest.send(event)));
// BIL-1: Stripe's webhook is the only path that changes an entitlement (ADR 0014); mounted only when a secret resolves
// (the sandbox default on a loopback host, or STRIPE_WEBHOOK_SECRET), like the Sentry one.
app.route("/", stripeWebhookApp(deps, env, (event) => inngest.send(event)));

// Sandbox "hosting" and simulation: deployments the sandbox deploy adapter
// wrote under <SANDBOX_ROOT>/sites are served here so the evidence verifier's
// GET is real, and the sandbox ads/mail adapters accept simulated deliveries
// and replies, in sandbox mode on a loopback WORKER_HOST only: a worker bound
// to 0.0.0.0 (Fly, sandbox by default) mounts none of it, the sites included
// (ADR 0007, ADR 0010, ADR 0015, M4 review L4, M6 review L5). Every request
// needs a loopback Host with this port and, to change state, a same-origin
// browser context or none (M6 review L4).
if (env.INTEGRATIONS_MODE === "sandbox" && isLoopbackHost(env.WORKER_HOST)) {
  app.route("/", sandboxSites(env));
  // The sandbox Stripe's checkout and portal pages post signed events to this worker's own webhook, one at a time.
  const deliver = webhookDelivery({ url: `${selfBaseUrl(env)}/webhooks/stripe`, waitApplied: appliedPoller((id) => getBillingEvent(deps.db, id)) });
  app.route("/", sandboxRoutes(deps.integrations, env.WORKER_HOST, deps.simClock, { clock: deps.clock, deliver, appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3100" }, env.WORKER_PORT));
}
app.on(
  ["GET", "PUT", "POST"],
  "/api/inngest",
  inngestServe({ client: inngest, functions, ...(env.INNGEST_SIGNING_KEY ? { signingKey: env.INNGEST_SIGNING_KEY } : {}) }),
);

serve({ fetch: app.fetch, port: env.WORKER_PORT, hostname: env.WORKER_HOST }, (info) => {
  console.log(`[north-worker] listening on http://${info.address}:${info.port} (inngest at /api/inngest, runtime=${env.AGENT_RUNTIME}, mode=${env.INTEGRATIONS_MODE}, env=${env.NORTH_ENV}, profile=${env.NORTH_MODEL_PROFILE}, gateway=${deps.gateway?.mode ?? "off"}${deps.fence.enabled ? ", fence on" : ""}, sentry=${sentryWebhookLabel(env)}, stripe=${stripeWebhookLabel(env)}${observed ? ", reporting on" : ""}${deps.tracer.enabled ? ", tracing on" : ""}, clock=${deps.clock().toISOString()})`);
});

// OBS-1: queued Langfuse events are sent before the process exits; SEC-1: the model gateway stops and cuts what is in flight.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    void Promise.allSettled([deps.tracer.flush(), deps.gateway?.close()]).finally(() => process.exit(0));
  });
}
