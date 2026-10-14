import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { serve as inngestServe } from "inngest/hono";
import { workerEnv } from "./env";
import { inngest } from "./inngest/client";
import { functions } from "./inngest/functions";

const env = workerEnv();

const app = new Hono();
app.get("/health", (c) => c.json({ ok: true, app: "north-worker", time: new Date().toISOString() }));
app.on(
  ["GET", "PUT", "POST"],
  "/api/inngest",
  inngestServe({ client: inngest, functions, ...(env.INNGEST_SIGNING_KEY ? { signingKey: env.INNGEST_SIGNING_KEY } : {}) }),
);

serve({ fetch: app.fetch, port: env.WORKER_PORT, hostname: env.WORKER_HOST }, (info) => {
  console.log(`[north-worker] listening on http://${info.address}:${info.port} (inngest at /api/inngest, runtime=${env.AGENT_RUNTIME})`);
});
