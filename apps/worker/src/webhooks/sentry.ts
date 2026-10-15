import { createHmac, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { EVENT, SentryIssueWebhookSchema } from "@north/core";
import { companyBySentryProject } from "@north/db";
import type { WorkerDeps } from "../deps";
import { recordIncident } from "../services/incidents";

/** Sentry's issue webhook headers (internal integration, "issue" resource). */
export const SENTRY_SIGNATURE_HEADER = "sentry-hook-signature";
export const SENTRY_RESOURCE_HEADER = "sentry-hook-resource";
const ISSUE_RESOURCE = "issue";
const CREATED = "created";
/** A webhook body larger than this is not a Sentry issue; it is refused before parsing. */
const MAX_BODY_BYTES = 256 * 1024;
const HEX_SHA256 = /^[0-9a-f]{64}$/i;

/**
 * ADR 0013: the signature is HMAC-SHA256 of the raw body with the client
 * secret, hex encoded, compared in constant time. A missing, malformed or
 * mismatched header is false; nothing is parsed before this passes.
 */
export function verifySentrySignature(rawBody: string, header: string | undefined, secret: string): boolean {
  if (!header || !HEX_SHA256.test(header)) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(header.toLowerCase(), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Signs a body the way Sentry does (the smoke and the e2e use it; tests sign fixtures with it). */
export function signSentryBody(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

export interface SentryRouteOptions {
  readonly secret: string;
  /** Sends `signal/detected` for a stored issue; the server passes the Inngest client, tests a spy. */
  readonly emit: (event: { readonly name: string; readonly data: Record<string, unknown> }) => Promise<unknown>;
}

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/**
 * PRO-2: `POST /webhooks/sentry`. 401 on a bad signature (nothing written),
 * 400 on a body that is not an issue webhook, 202 for a resource, action or
 * project North does not handle (logged, nothing stored), 200 with
 * `{ signalId, duplicate }`: idempotent by `(company, sentry, issue.id)`, a
 * replay answers 200 `duplicate: true` and changes nothing. The payload is
 * reduced to the strict schema (bounded, sanitised) before anything reads it.
 */
export function sentryWebhookRoutes(deps: WorkerDeps, options: SentryRouteOptions): Hono {
  const app = new Hono();
  app.post("/webhooks/sentry", async (c) => {
    const raw = await c.req.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return c.json({ error: "body too large" }, 413);
    if (!verifySentrySignature(raw, c.req.header(SENTRY_SIGNATURE_HEADER), options.secret)) return c.json({ error: "bad signature" }, 401);
    const resource = c.req.header(SENTRY_RESOURCE_HEADER);
    if (resource !== undefined && resource !== ISSUE_RESOURCE) return c.json({ ignored: `resource ${resource.slice(0, 40)}` }, 202);
    const parsed = SentryIssueWebhookSchema.safeParse(parseJson(raw));
    if (!parsed.success) return c.json({ error: "expected a Sentry issue webhook { action, data: { issue } }" }, 400);
    if (parsed.data.action !== CREATED) return c.json({ ignored: `action ${parsed.data.action.slice(0, 40)}` }, 202);
    const issue = parsed.data.data.issue;
    const company = await companyBySentryProject(deps.db, issue.project.slug);
    if (!company) {
      console.warn(`[sentry] issue ${issue.shortId} for unknown project ${issue.project.slug}: ignored`);
      return c.json({ ignored: "unknown project" }, 202);
    }
    const incident = await recordIncident(deps, company.id, issue);
    if (incident.inserted) await options.emit({ name: EVENT.signalDetected, data: { companyId: company.id, signalId: incident.signalId, kind: "error" } });
    return c.json({ signalId: incident.signalId, duplicate: !incident.inserted }, 200);
  });
  return app;
}
