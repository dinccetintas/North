import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { serve as inngestServe } from "inngest/hono";
import { inngest } from "./inngest/client";
import { functions } from "./inngest/functions";

const PORT = Number(process.env.WORKER_PORT ?? 3001);

const app = new Hono();
app.get("/health", (c) => c.json({ ok: true, app: "north-worker", time: new Date().toISOString() }));
app.on(["GET", "PUT", "POST"], "/api/inngest", inngestServe({ client: inngest, functions }));

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`[north-worker] listening on http://localhost:${info.port} (inngest at /api/inngest)`);
});
