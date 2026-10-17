// CMP-1: the public `/u/{token}` route behind every List-Unsubscribe link: a verified token becomes one opt-out, anything else a plain 404.
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { verifyUnsubscribeToken } from "@north/core";
import { z } from "zod";
import type { WorkerDeps } from "../deps";
import { SANDBOX_UNSUBSCRIBE_SECRET, unsubscribeSecretFor, type WorkerEnv } from "../env";
import { sandboxRequestRefusal } from "../sandbox-routes";
import { suppressOnce } from "../services/suppress";
import { clientIpOf, rateKeyOf, TokenBucket } from "./rate-limit";

export { clientIpOf, rateKeyOf, TokenBucket, UNKNOWN_CLIENT } from "./rate-limit";

/** The answer to a verified opt-out (GET from the footer link or the RFC 8058 one-click POST). */
export const OPTED_OUT_TEXT = "You will not hear from us again.";
const NOT_FOUND_TEXT = "Not found";
const TOO_LARGE_TEXT = "Payload too large";
const TOO_MANY_TEXT = "Too many requests";
const UNAVAILABLE_TEXT = "Please try again later.";
/** Seconds a client should wait after a 503. */
const RETRY_AFTER_SECONDS = "30";

/** A one-click POST carries `List-Unsubscribe=One-Click`; anything over this is not one. */
export const UNSUBSCRIBE_BODY_MAX_BYTES = 1024;
/** Failed requests (404, 413) per client per minute; a verified opt-out is never counted or refused. */
export const UNSUBSCRIBE_RATE_PER_MINUTE = 60;

/** On every `/u` answer: never cached, never indexed, never a referrer carrying the token onwards. */
const PLAIN_HEADERS: Readonly<Record<string, string>> = Object.freeze({ "cache-control": "no-store", "x-robots-tag": "noindex", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" });

/** The path segment: canonical base64url, bounded. Anything else is a 404 before verification. */
const TokenSchema = z.string().min(1).max(1024).regex(/^[A-Za-z0-9_-]+$/);
/** What a verified token may name before anything is written: a company id and one address (the signer normalised it), within the suppression list's bounds. */
const ClaimsSchema = z.object({ companyId: z.uuid(), email: z.string().min(3).max(254).regex(/^[^\s@]+@[^\s@]+$/) });

/** The remote address `@hono/node-server` hands over in the bindings (`incoming.socket`); undefined in-process or elsewhere. */
function socketAddressOf(bindings: unknown): string | undefined {
  const address = (bindings as { incoming?: { socket?: { remoteAddress?: unknown } } } | undefined)?.incoming?.socket?.remoteAddress;
  return typeof address === "string" ? address : undefined;
}

const plain = (c: Context, status: 200 | 404 | 413 | 429, text: string): Response => c.text(text, status, PLAIN_HEADERS);
const unavailable = (c: Context): Response => c.text(UNAVAILABLE_TEXT, 503, { ...PLAIN_HEADERS, "retry-after": RETRY_AFTER_SECONDS });

/** Answers a failure (404 or 413) and charges the client's bucket for it; once the bucket is empty the answer is 429. */
type Fail = (c: Context, status: 404 | 413, text: string) => Response;

export type UnsubscribeRouteEnv = Pick<WorkerEnv, "UNSUBSCRIBE_SECRET" | "INTEGRATIONS_MODE" | "WORKER_HOST" | "WORKER_PORT" | "NORTH_TRUST_PROXY">;

export interface UnsubscribeOptions {
  /** Milliseconds for the rate limit (wall time, never the sandbox clock); tests pin it. */
  readonly now?: () => number;
  readonly bucket?: TokenBucket;
}

/** The failure responder of one app: the client is keyed by `rateKeyOf(clientIpOf(...))` and charged per failure. */
function failureResponder(bucket: TokenBucket, now: () => number, trustProxy: boolean): Fail {
  return (c, status, text) => {
    const key = rateKeyOf(clientIpOf(c.req.raw.headers, socketAddressOf(c.env), trustProxy));
    return bucket.take(key, now()) ? plain(c, status, text) : plain(c, 429, TOO_MANY_TEXT);
  };
}

/** 413 over {@link UNSUBSCRIBE_BODY_MAX_BYTES}: by `content-length` (any method; a malformed one counts as too large), then a streamed body as it is read. */
function sizeLimit(fail: Fail): MiddlewareHandler {
  const streamed = bodyLimit({ maxSize: UNSUBSCRIBE_BODY_MAX_BYTES, onError: (c) => fail(c, 413, TOO_LARGE_TEXT) });
  return async (c, next) => {
    const declared = c.req.header("content-length");
    if (declared !== undefined && (!/^\d{1,10}$/.test(declared.trim()) || Number(declared) > UNSUBSCRIBE_BODY_MAX_BYTES)) return fail(c, 413, TOO_LARGE_TEXT);
    return streamed(c, next);
  };
}

/**
 * While tokens verify with the public sandbox secret (anyone can sign one), the
 * route answers this machine only, like the sandbox webhooks (M6 review L4): a
 * loopback Host with the worker's port, and no cross-site state change. Any
 * other request gets the same 404 as a bad token.
 */
function loopbackOnly(port: number, fail: Fail): MiddlewareHandler {
  return async (c, next) => {
    const refusal = sandboxRequestRefusal({ method: c.req.method, host: c.req.header("host") ?? new URL(c.req.url).host, secFetchSite: c.req.header("sec-fetch-site"), origin: c.req.header("origin") }, port);
    if (refusal) return fail(c, 404, NOT_FOUND_TEXT);
    await next();
  };
}

/** Postgres `foreign_key_violation`: the token's company is gone (purged after retention), so there is nothing left to opt out of. */
const FOREIGN_KEY_VIOLATION = "23503";
const isUnknownCompany = (error: unknown): boolean => (error as { cause?: { code?: unknown } } | null)?.cause?.code === FOREIGN_KEY_VIOLATION;

/** Verifies the path's token and records the opt-out; a HEAD (a link checker) writes nothing. The body is never read or interpreted. */
function optOutHandler(deps: Pick<WorkerDeps, "db">, secret: string | null, fail: Fail) {
  return async (c: Context): Promise<Response> => {
    const token = TokenSchema.safeParse(c.req.param("token"));
    const claims = secret && token.success ? ClaimsSchema.safeParse(verifyUnsubscribeToken(token.data, secret)) : null;
    if (!claims?.success || c.req.method === "HEAD") return fail(c, 404, NOT_FOUND_TEXT);
    try {
      await suppressOnce(deps.db, { companyId: claims.data.companyId, email: claims.data.email, reason: "opt_out" });
    } catch (error) {
      if (isUnknownCompany(error)) return fail(c, 404, NOT_FOUND_TEXT);
      // Never the token or the address: only that the write failed.
      console.warn(`[unsubscribe] could not record an opt-out: ${error instanceof Error ? error.name : "error"}`);
      return unavailable(c);
    }
    return plain(c, 200, OPTED_OUT_TEXT);
  };
}

/**
 * CMP-1: `GET` and `POST /u/:token` (RFC 8058 one-click). A token that
 * verifies with `unsubscribeSecretFor(env)` writes one `opt_out` suppression
 * for its company and address (a repeat writes nothing) and answers 200
 * text/plain, never rate-limited. Every failure (no secret configured, a
 * bad, tampered or foreign token, a malformed path, another method, a token
 * whose company was purged) is the same 404 text/plain "Not found": never a
 * 500, never a redirect, never the token echoed; bodies over 1 KB are 413.
 * Failures are charged to the client (an IPv6 client by its /64):
 * {@link UNSUBSCRIBE_RATE_PER_MINUTE} a minute, 429 beyond. A storage
 * failure, or any error that escapes, is 503 with `retry-after`. With the
 * public sandbox secret it answers this machine only. Mounted on every
 * worker, before the sandbox routes; it reads and writes nothing but the
 * suppression it was asked for.
 */
export function unsubscribeApp(deps: Pick<WorkerDeps, "db">, env: UnsubscribeRouteEnv, options: UnsubscribeOptions = {}): Hono {
  const routes = new Hono();
  const fail = failureResponder(options.bucket ?? new TokenBucket(UNSUBSCRIBE_RATE_PER_MINUTE, 60_000), options.now ?? Date.now, env.NORTH_TRUST_PROXY === "1");
  const secret = unsubscribeSecretFor(env);
  routes.use("*", sizeLimit(fail));
  if (secret === SANDBOX_UNSUBSCRIBE_SECRET) routes.use("*", loopbackOnly(env.WORKER_PORT, fail));
  const handler = optOutHandler(deps, secret, fail);
  routes.get("/:token", handler);
  routes.post("/:token", handler);
  routes.all("*", (c) => fail(c, 404, NOT_FOUND_TEXT));
  routes.onError((error, c) => {
    console.warn(`[unsubscribe] request failed: ${error instanceof Error ? error.name : "error"}`);
    return unavailable(c);
  });
  const app = new Hono();
  app.route("/u", routes);
  return app;
}
