import { Hono } from "hono";
import { AdDeliverySchema } from "@north/core";
import { isSandboxAds, isSandboxOutreach, type Integrations } from "@north/integrations";
import { z } from "zod";

/** Sandbox and live refs are short identifiers; anything else is refused before it reaches the adapters' path checks. */
const RefSchema = z.string().regex(/^[A-Za-z0-9:._-]{1,120}$/);
const ReplySchema = z.object({ at: z.iso.datetime({ offset: true }).optional() }).default({});

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/** Whether a bind host keeps the worker on this machine (the only place the simulation routes may exist, M4 review L4). */
export const isLoopbackHost = (host: string): boolean => LOOPBACK_HOSTS.has(host.trim().toLowerCase());

/**
 * Simulation routes for the sandbox adapters (M4): the e2e flow, the smoke
 * script and a developer "report" a delivery window or a reply through the
 * worker's loopback server. Mounted in sandbox mode on a loopback host only;
 * in live mode, or on a worker bound to any other address, these paths do
 * not exist (404), so nothing can inject figures into a real ledger.
 */
export function sandboxRoutes(integrations: Integrations, host = "127.0.0.1"): Hono {
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
  return app;
}
