import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { serve as inngestServe } from "inngest/hono";
import { relative } from "node:path";
import { workerEnv } from "./env";
import { inngest } from "./inngest/client";
import { functions } from "./inngest/functions";

const env = workerEnv();

const app = new Hono();
app.get("/health", (c) => c.json({ ok: true, app: "north-worker", time: new Date().toISOString() }));

// Sandbox "hosting": deployments the sandbox deploy adapter wrote under
// <SANDBOX_ROOT>/sites are served here so the evidence verifier's GET is real.
// Live mode never serves files (ADR 0007).
if (env.INTEGRATIONS_MODE === "sandbox") {
  const sitesRoot = relative(process.cwd(), `${env.SANDBOX_ROOT}/sites`) || ".";
  app.use("/sandbox/sites/*", serveStatic({ root: sitesRoot, rewriteRequestPath: (path) => path.replace(/^\/sandbox\/sites/, "").replace(/\/$/, "/index.html") }));
}
app.on(
  ["GET", "PUT", "POST"],
  "/api/inngest",
  inngestServe({ client: inngest, functions, ...(env.INNGEST_SIGNING_KEY ? { signingKey: env.INNGEST_SIGNING_KEY } : {}) }),
);

serve({ fetch: app.fetch, port: env.WORKER_PORT, hostname: env.WORKER_HOST }, (info) => {
  console.log(`[north-worker] listening on http://${info.address}:${info.port} (inngest at /api/inngest, runtime=${env.AGENT_RUNTIME})`);
});
