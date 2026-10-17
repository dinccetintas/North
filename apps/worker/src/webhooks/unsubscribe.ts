// CMP-1: the public `/u/{token}` route behind every List-Unsubscribe link: a verified token becomes one opt-out, anything else a plain 404.
import { isIP } from "node:net";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { verifyUnsubscribeToken } from "@north/core";
import { z } from "zod";
import type { WorkerDeps } from "../deps";
import { SANDBOX_UNSUBSCRIBE_SECRET, unsubscribeSecretFor, type WorkerEnv } from "../env";
import { sandboxRequestRefusal } from "../sandbox-routes";
import { suppressOnce } from "../services/suppress";

/** The answer to a verified opt-out (GET from the footer link or the RFC 8058 one-click POST). */
export const OPTED_OUT_TEXT = "You will not hear from us again.";
const NOT_FOUND_TEXT = "Not found";
const TOO_LARGE_TEXT = "Payload too large";
const TOO_MANY_TEXT = "Too many requests";
const UNAVAILABLE_TEXT = "Please try again later.";

/** A one-click POST carries `List-Unsubscribe=One-Click`; anything over this is not one. */
export const UNSUBSCRIBE_BODY_MAX_BYTES = 1024;
/** Requests per client IP per minute, whatever their outcome (a token cannot be guessed faster than this). */
export const UNSUBSCRIBE_RATE_PER_MINUTE = 60;
/** The bucket for a request whose client address cannot be read: one shared bucket, so such requests are limited together. */
export const UNKNOWN_CLIENT = "unknown";

/** On every `/u` answer: never cached, never indexed, never a referrer carrying the token onwards. */
const PLAIN_HEADERS: Readonly<Record<string, string>> = Object.freeze({ "cache-control": "no-store", "x-robots-tag": "noindex", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" });

/** The path segment: canonical base64url, bounded. Anything else is a 404 before verification. */
const TokenSchema = z.string().min(1).max(1024).regex(/^[A-Za-z0-9_-]+$/);
/** What a verified token may name before anything is written: a company id and one address (the signer normalised it), within the suppression list's bounds. */
const ClaimsSchema = z.object({ companyId: z.uuid(), email: z.string().min(3).max(254).regex(/^[^\s@]+@[^\s@]+$/) });

/**
 * An in-memory token bucket per key: `capacity` takes per `windowMs`, refilled
 * evenly. At most `maxKeys` keys are kept (the least recently used go first),
 * so a flood of addresses cannot grow memory without bound. Per process: each
 * worker machine limits on its own.
 */
export class TokenBucket {
  private readonly buckets = new Map<string, { readonly tokens: number; readonly at: number }>();

  constructor(
    private readonly capacity: number,
    private readonly windowMs: number,
    private readonly maxKeys = 10_000,
  ) {}

  /** How many keys are held. */
  get size(): number {
    return this.buckets.size;
  }

  /** Takes one token for `key` at `nowMs`; false when the key has none left. */
  take(key: string, nowMs: number): boolean {
    const previous = this.buckets.get(key);
    const refilled = previous ? Math.min(this.capacity, previous.tokens + (Math.max(0, nowMs - previous.at) * this.capacity) / this.windowMs) : this.capacity;
    const allowed = refilled >= 1;
    this.buckets.delete(key);
    this.buckets.set(key, { tokens: allowed ? refilled - 1 : refilled, at: nowMs });
    for (const oldest of this.buckets.keys()) {
      if (this.buckets.size <= this.maxKeys) break;
      this.buckets.delete(oldest);
    }
    return allowed;
  }
}

/** A plain IP (an IPv4-mapped IPv6 address unwrapped, IPv6 lower-cased), or null for anything that is not one. */
function ipOf(value: string | null | undefined): string | null {
  const trimmed = value?.trim().replace(/^::ffff:(?=\d{1,3}(?:\.\d{1,3}){3}$)/i, "") ?? "";
  return trimmed !== "" && isIP(trimmed) !== 0 ? trimmed.toLowerCase() : null;
}

/**
 * The client the rate limit counts: the socket's remote address, unless the
 * worker runs behind a trusted proxy (`NORTH_TRUST_PROXY=1`), where Fly's
 * `Fly-Client-IP` and then the first `X-Forwarded-For` entry name it. Forwarded
 * headers are never read otherwise (anyone can send them). A value that is not
 * an IP is ignored; without any, {@link UNKNOWN_CLIENT}.
 */
export function clientIpOf(headers: Pick<Headers, "get">, socketAddress: string | undefined, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = ipOf(headers.get("fly-client-ip")) ?? ipOf(headers.get("x-forwarded-for")?.split(",")[0]);
    if (forwarded) return forwarded;
  }
  return ipOf(socketAddress) ?? UNKNOWN_CLIENT;
}

/** The remote address `@hono/node-server` hands over in the bindings (`incoming.socket`); undefined in-process or elsewhere. */
function socketAddressOf(bindings: unknown): string | undefined {
  const address = (bindings as { incoming?: { socket?: { remoteAddress?: unknown } } } | undefined)?.incoming?.socket?.remoteAddress;
  return typeof address === "string" ? address : undefined;
}

const plain = (c: Context, status: 200 | 404 | 413 | 429 | 503, text: string): Response => c.text(text, status, PLAIN_HEADERS);
const notFound = (c: Context): Response => plain(c, 404, NOT_FOUND_TEXT);

export type UnsubscribeRouteEnv = Pick<WorkerEnv, "UNSUBSCRIBE_SECRET" | "INTEGRATIONS_MODE" | "WORKER_HOST" | "WORKER_PORT" | "NORTH_TRUST_PROXY">;

export interface UnsubscribeOptions {
  /** Milliseconds for the rate limit (wall time, never the sandbox clock); tests pin it. */
  readonly now?: () => number;
  readonly bucket?: TokenBucket;
}

/** 429 once the client's bucket is empty: counted before anything else, so failures count too. */
function rateLimit(bucket: TokenBucket, now: () => number, trustProxy: boolean): MiddlewareHandler {
  return async (c, next) => {
    const client = clientIpOf(c.req.raw.headers, socketAddressOf(c.env), trustProxy);
    if (!bucket.take(client, now())) return plain(c, 429, TOO_MANY_TEXT);
    await next();
  };
}

/** 413 over {@link UNSUBSCRIBE_BODY_MAX_BYTES}: by `content-length` (any method; a malformed one counts as too large), then a streamed body as it is read. */
function sizeLimit(): MiddlewareHandler {
  const streamed = bodyLimit({ maxSize: UNSUBSCRIBE_BODY_MAX_BYTES, onError: (c) => plain(c, 413, TOO_LARGE_TEXT) });
  return async (c, next) => {
    const declared = c.req.header("content-length");
    if (declared !== undefined && (!/^\d{1,10}$/.test(declared.trim()) || Number(declared) > UNSUBSCRIBE_BODY_MAX_BYTES)) return plain(c, 413, TOO_LARGE_TEXT);
    return streamed(c, next);
  };
}

/**
 * While tokens verify with the public sandbox secret (anyone can sign one), the
 * route answers this machine only, like the sandbox webhooks (M6 review L4): a
 * loopback Host with the worker's port, and no cross-site state change. Any
 * other request gets the same 404 as a bad token.
 */
function loopbackOnly(port: number): MiddlewareHandler {
  return async (c, next) => {
    const refusal = sandboxRequestRefusal({ method: c.req.method, host: c.req.header("host") ?? new URL(c.req.url).host, secFetchSite: c.req.header("sec-fetch-site"), origin: c.req.header("origin") }, port);
    if (refusal) return notFound(c);
    await next();
  };
}

/** Postgres `foreign_key_violation`: the token's company is gone (purged after retention), so there is nothing left to opt out of. */
const FOREIGN_KEY_VIOLATION = "23503";
const isUnknownCompany = (error: unknown): boolean => (error as { cause?: { code?: unknown } } | null)?.cause?.code === FOREIGN_KEY_VIOLATION;

/** Verifies the path's token and records the opt-out; a HEAD (a link checker) writes nothing. The body is never read or interpreted. */
function optOutHandler(deps: Pick<WorkerDeps, "db">, secret: string | null) {
  return async (c: Context): Promise<Response> => {
    const token = TokenSchema.safeParse(c.req.param("token"));
    const claims = secret && token.success ? ClaimsSchema.safeParse(verifyUnsubscribeToken(token.data, secret)) : null;
    if (!claims?.success || c.req.method === "HEAD") return notFound(c);
    try {
      await suppressOnce(deps.db, { companyId: claims.data.companyId, email: claims.data.email, reason: "opt_out" });
    } catch (error) {
      if (isUnknownCompany(error)) return notFound(c);
      // Never the token or the address: only that the write failed.
      console.warn(`[unsubscribe] could not record an opt-out: ${error instanceof Error ? error.name : "error"}`);
      return plain(c, 503, UNAVAILABLE_TEXT);
    }
    return plain(c, 200, OPTED_OUT_TEXT);
  };
}

/**
 * CMP-1: `GET` and `POST /u/:token` (RFC 8058 one-click). A token that
 * verifies with `unsubscribeSecretFor(env)` writes one `opt_out` suppression
 * for its company and address (a repeat writes nothing) and answers 200
 * text/plain. Every failure (no secret configured, a bad, tampered or foreign
 * token, a malformed path, another method) is the same 404 text/plain "Not
 * found": never a 500, never a redirect, never the token echoed; so is a
 * token whose company was purged. Any other storage failure is 503. With
 * the public sandbox secret it answers this machine only. Bodies over 1 KB
 * are 413, and each client IP gets
 * {@link UNSUBSCRIBE_RATE_PER_MINUTE} requests a minute (429 beyond). Mounted
 * on every worker, before the sandbox routes; it reads and writes nothing but
 * the suppression it was asked for.
 */
export function unsubscribeApp(deps: Pick<WorkerDeps, "db">, env: UnsubscribeRouteEnv, options: UnsubscribeOptions = {}): Hono {
  const routes = new Hono();
  const bucket = options.bucket ?? new TokenBucket(UNSUBSCRIBE_RATE_PER_MINUTE, 60_000);
  const secret = unsubscribeSecretFor(env);
  routes.use("*", rateLimit(bucket, options.now ?? Date.now, env.NORTH_TRUST_PROXY === "1"), sizeLimit());
  if (secret === SANDBOX_UNSUBSCRIBE_SECRET) routes.use("*", loopbackOnly(env.WORKER_PORT));
  const handler = optOutHandler(deps, secret);
  routes.get("/:token", handler);
  routes.post("/:token", handler);
  routes.all("*", notFound);
  routes.onError((_error, c) => plain(c, 503, UNAVAILABLE_TEXT));
  const app = new Hono();
  app.route("/u", routes);
  return app;
}
