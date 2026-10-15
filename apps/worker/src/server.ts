import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { serve as inngestServe } from "inngest/hono";
import { relative } from "node:path";
import { buildDeps } from "./deps";
import { sentrySecretFor, workerEnv } from "./env";
import { inngest } from "./inngest/client";
import { functions } from "./inngest/index";
import { initObservability } from "./observability";
import { sandboxRoutes } from "./sandbox-routes";
import { sentryWebhookRoutes } from "./webhooks/sentry";

const env = workerEnv();
const observed = initObservability(env);
const deps = await buildDeps(env);

const app = new Hono();
app.get("/health", (c) => c.json({ ok: true, app: "north-worker", time: new Date().toISOString(), clock: deps.clock().toISOString() }));

// PRO-2: Sentry's issue webhook lands on the worker (ADR 0013); the route exists only when a verification secret resolves (sandbox default, live key).
const sentrySecret = sentrySecretFor(env);
if (sentrySecret) app.route("/", sentryWebhookRoutes(deps, { secret: sentrySecret, emit: (event) => inngest.send(event) }));

// Sandbox "hosting" and simulation: deployments the sandbox deploy adapter
// wrote under <SANDBOX_ROOT>/sites are served here so the evidence verifier's
// GET is real, and the sandbox ads/mail adapters accept simulated deliveries
// and replies, on a loopback WORKER_HOST only. Live mode serves none of it
// (ADR 0007, ADR 0010, M4 review L4).
if (env.INTEGRATIONS_MODE === "sandbox") {
  const sitesRoot = relative(process.cwd(), `${env.SANDBOX_ROOT}/sites`) || ".";
  app.use("/sandbox/sites/*", serveStatic({ root: sitesRoot, rewriteRequestPath: (path) => path.replace(/^\/sandbox\/sites/, "").replace(/\/$/, "/index.html") }));
  app.route("/", sandboxRoutes(deps.integrations, env.WORKER_HOST, deps.simClock));
}
app.on(
  ["GET", "PUT", "POST"],
  "/api/inngest",
  inngestServe({ client: inngest, functions, ...(env.INNGEST_SIGNING_KEY ? { signingKey: env.INNGEST_SIGNING_KEY } : {}) }),
);

serve({ fetch: app.fetch, port: env.WORKER_PORT, hostname: env.WORKER_HOST }, (info) => {
  console.log(`[north-worker] listening on http://${info.address}:${info.port} (inngest at /api/inngest, runtime=${env.AGENT_RUNTIME}, mode=${env.INTEGRATIONS_MODE}, sentry=${sentrySecret ? "webhook on" : "webhook off"}${observed ? ", reporting on" : ""}, clock=${deps.clock().toISOString()})`);
});
