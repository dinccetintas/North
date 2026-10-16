import { createHmac, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { EVENT, parseBillingEvent, type BillingEvent } from "@north/core";
import { getBillingEvent, insertBillingEvent } from "@north/db";
import type { WorkerDeps } from "../deps";
import { stripeSecretFor, type StripeEnv } from "../env";
import { resolveBillingUser } from "../services/billing-lookup";

/** Stripe's webhook signature header: `t=<unix>,v1=<hex>[,v1=<hex>…]`. */
export const STRIPE_SIGNATURE_HEADER = "stripe-signature";
/** A body larger than this is not a Stripe event: refused by content-length or cut off while streaming, before verification. */
export const MAX_STRIPE_BODY_BYTES = 256 * 1024;
/** Stripe's default tolerance between the signed timestamp and the receiver's clock. */
export const STRIPE_TOLERANCE_SEC = 300;
const HEADER_MAX = 2048;
const HEX_SHA256 = /^[0-9a-f]{64}$/i;
const UNIX = /^\d{1,12}$/;

interface SignatureParts {
  readonly t: number;
  readonly v1: readonly string[];
}

function parseHeader(header: string): SignatureParts | null {
  let t: number | null = null;
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t" && UNIX.test(value)) t = Number(value);
    else if (key === "v1" && HEX_SHA256.test(value)) v1.push(value.toLowerCase());
  }
  return t === null || v1.length === 0 ? null : { t, v1 };
}

/**
 * ADR 0014 (the ADR 0013 pattern): v1 is HMAC-SHA256 of `"<t>.<raw body>"`
 * keyed with the endpoint secret, compared in constant time against every v1
 * the header carries (Stripe sends two while a secret rotates). The signed
 * timestamp must be within `toleranceSec` of the worker's clock, so a
 * captured body cannot be replayed later. Nothing is parsed before this.
 */
export function verifyStripeSignature(rawBody: string | Uint8Array, header: string | undefined, secret: string, now: Date, toleranceSec = STRIPE_TOLERANCE_SEC): boolean {
  if (!header || header.length > HEADER_MAX) return false;
  const parts = parseHeader(header);
  if (!parts) return false;
  if (Math.abs(now.getTime() / 1000 - parts.t) > toleranceSec) return false;
  const h = createHmac("sha256", secret).update(`${parts.t}.`, "utf8");
  const expected = (typeof rawBody === "string" ? h.update(rawBody, "utf8") : h.update(rawBody)).digest();
  return parts.v1.some((signature) => {
    const given = Buffer.from(signature, "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

export interface StripeRouteOptions {
  readonly secret: string;
  /** Sends `billing/event`; the server passes the Inngest client, tests a spy. */
  readonly emit: (event: { readonly name: string; readonly data: Record<string, unknown> }) => Promise<unknown>;
}

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

type Parsed = { readonly kind: "event"; readonly event: BillingEvent } | { readonly kind: "ignored"; readonly type: string } | { readonly kind: "invalid" };

/** The strict union from core: a known type with a bad shape is invalid (400), anything else ignored (200). */
function parse(json: unknown): Parsed {
  try {
    const parsed = parseBillingEvent(json);
    return "ignored" in parsed ? { kind: "ignored", type: parsed.ignored } : { kind: "event", event: parsed };
  } catch {
    return { kind: "invalid" };
  }
}

/** A replay of an event that is stored but not applied yet (the first emit was lost) asks for the apply again; the apply is idempotent. */
async function reemitIfUnapplied(deps: WorkerDeps, billingEventId: string, emit: StripeRouteOptions["emit"]): Promise<void> {
  const stored = await getBillingEvent(deps.db, billingEventId);
  if (stored && stored.appliedAt === null && stored.userId) await emit({ name: EVENT.billingEvent, data: { billingEventId, userId: stored.userId } });
}

/**
 * BIL-1: `POST /webhooks/stripe`, the only path that changes an entitlement.
 * 413 over `MAX_STRIPE_BODY_BYTES` before the body is read in full; 401 on a
 * bad or stale signature (nothing written); 400 on a known type with a bad
 * shape; 200 `{ ignored }` for any other type (no row); 202 for an event no
 * user owns (stored with `user_id null`, never applied); 200 `{
 * billingEventId, duplicate }` otherwise: idempotent by the Stripe event id,
 * a replay is `duplicate: true` and changes nothing. A new event is stored
 * before `billing/event` asks `apply-billing-event` to project it.
 */
export function stripeWebhookRoutes(deps: WorkerDeps, options: StripeRouteOptions): Hono {
  const app = new Hono();
  app.post("/webhooks/stripe", bodyLimit({ maxSize: MAX_STRIPE_BODY_BYTES, onError: (c) => c.json({ error: "body too large" }, 413) }), async (c) => {
    const raw = Buffer.from(await c.req.arrayBuffer());
    if (!verifyStripeSignature(raw, c.req.header(STRIPE_SIGNATURE_HEADER), options.secret, deps.clock())) return c.json({ error: "bad signature" }, 401);
    const json = parseJson(raw.toString("utf8"));
    const parsed = parse(json);
    if (parsed.kind === "invalid") return c.json({ error: "expected a Stripe event of a handled type with its documented shape" }, 400);
    if (parsed.kind === "ignored") return c.json({ ignored: parsed.type }, 200);
    const { event } = parsed;
    const userId = await resolveBillingUser(deps, event);
    const stored = await insertBillingEvent(deps.db, { eventId: event.id, type: event.type, userId, payload: json as Record<string, unknown> });
    if (stored.duplicate) {
      await reemitIfUnapplied(deps, stored.id, options.emit);
      return c.json({ billingEventId: stored.id, duplicate: true }, 200);
    }
    if (!userId) {
      console.warn(`[stripe] ${event.type} ${event.id} for an unknown customer: stored, not applied`);
      return c.json({ billingEventId: stored.id, duplicate: false, ignored: "unknown customer" }, 202);
    }
    await options.emit({ name: EVENT.billingEvent, data: { billingEventId: stored.id, userId } });
    return c.json({ billingEventId: stored.id, duplicate: false }, 200);
  });
  return app;
}

/**
 * The webhook as the server mounts it: the routes when a secret resolves for
 * this mode and bind host (`stripeSecretFor`), otherwise an empty app, so the
 * path does not exist (404) and the sandbox secret is never reachable off
 * loopback.
 */
export function stripeWebhookApp(deps: WorkerDeps, env: StripeEnv, emit: StripeRouteOptions["emit"]): Hono {
  const secret = stripeSecretFor(env);
  return secret ? stripeWebhookRoutes(deps, { secret, emit }) : new Hono();
}
