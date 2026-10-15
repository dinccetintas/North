import { Hono } from "hono";
import { AdDeliverySchema } from "@north/core";
import { isSandboxAds, isSandboxOutreach, type Integrations } from "@north/integrations";
import { z } from "zod";
import { isLoopbackHost } from "./host";
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

/**
 * Simulation routes for the sandbox adapters (M4) and the worker's clock
 * (M5): the e2e flow, the smoke script and a developer "report" a delivery
 * window or a reply, or move the clock, through the worker's loopback server.
 * Mounted in sandbox mode on a loopback host only; in live mode, or on a
 * worker bound to any other address, these paths do not exist (404), so
 * nothing can inject figures into a real ledger or move a real day.
 */
export function sandboxRoutes(integrations: Integrations, host = "127.0.0.1", simClock: SimClock | null = null): Hono {
  const app = new Hono();
  const ads = integrations.ads(null);
  const outreach = integrations.outreach(null);
  if (integrations.mode !== "sandbox" || !isLoopbackHost(host) || !isSandboxAds(ads) || !isSandboxOutreach(outreach)) return app;

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
