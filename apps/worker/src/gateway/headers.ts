// SEC-1: what the model gateway trusts and forwards. The caller's credentials
// never cross it (the gateway injects its own), hop-by-hop headers are dropped
// on both legs, and a request must name a loopback Host (DNS rebinding).
import type { IncomingHttpHeaders } from "node:http";
import { GATEWAY_PLACEHOLDER_KEY } from "@north/agents";
import { z } from "zod";
import { isLoopbackHost } from "../host";

/** A header value as Node hands it over (a repeated header may be an array). */
export type HeaderValue = string | string[];
/** Headers to put on a message, by lower-case name. */
export type HeaderBag = Record<string, HeaderValue>;
/** Any set of headers, read-only: Node's `IncomingHttpHeaders` and a cassette's stored headers both fit. */
export type Headers = Readonly<Record<string, HeaderValue | undefined>>;

const first = (value: HeaderValue | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

const HOP_BY_HOP: readonly string[] = ["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade"];

/** Caller headers that go upstream, by name. Anything else (cookies, forwarding headers, other anthropic-* headers) stays behind. */
const FORWARDED_REQUEST_HEADERS: ReadonlySet<string> = new Set(["content-type", "accept", "accept-language", "user-agent", "anthropic-version", "anthropic-beta", "x-app"]);
const STAINLESS_PREFIX = "x-stainless-";

/** The hop-by-hop names of one message: the fixed list, `proxy-*`, and whatever its Connection header names. */
function hopByHopNames(headers: Headers): Set<string> {
  const names = new Set(HOP_BY_HOP);
  for (const token of (first(headers.connection) ?? "").split(",")) {
    const name = token.trim().toLowerCase();
    if (name) names.add(name);
  }
  for (const name of Object.keys(headers)) if (name.startsWith("proxy-")) names.add(name);
  return names;
}

/**
 * The caller's headers that may go upstream: an allowlist (`content-type`,
 * `accept`, `accept-language`, `user-agent`, `anthropic-version`,
 * `anthropic-beta`, `x-app` and any `x-stainless-*`). Credentials, cookies,
 * forwarding headers, hop-by-hop headers and every other header are dropped.
 * Cassettes store these and nothing else.
 */
export function forwardedRequestHeaders(incoming: IncomingHttpHeaders): HeaderBag {
  const kept: HeaderBag = {};
  for (const [name, value] of Object.entries(incoming)) {
    if (value === undefined) continue;
    if (FORWARDED_REQUEST_HEADERS.has(name) || name.startsWith(STAINLESS_PREFIX)) kept[name] = value;
  }
  return kept;
}

/**
 * The headers of the upstream request: the allowlisted ones, plus the real
 * key, the upstream's own Host, an exact Content-Length (the body is buffered)
 * and `accept-encoding: identity` (the gateway reads the reply, so it must not
 * be compressed).
 */
export function upstreamHeaders(incoming: IncomingHttpHeaders, apiKey: string, upstreamHost: string, bodyLength: number): HeaderBag {
  return { ...forwardedRequestHeaders(incoming), host: upstreamHost, "x-api-key": apiKey, "accept-encoding": "identity", "content-length": String(bodyLength) };
}

/** The headers of the reply to the caller: the upstream's, unchanged, minus hop-by-hop headers. */
export function replyHeaders(upstream: Headers): HeaderBag {
  const dropped = hopByHopNames(upstream);
  const kept: HeaderBag = {};
  for (const [name, value] of Object.entries(upstream)) {
    if (value !== undefined && !dropped.has(name)) kept[name] = value;
  }
  return kept;
}

const HostHeaderSchema = z
  .string()
  .regex(/^[A-Za-z0-9.:[\]-]+$/)
  .refine((value) => {
    try {
      return isLoopbackHost(new URL(`http://${value}`).hostname);
    } catch {
      return false;
    }
  });

/** The `anthropic-beta` header as one string ("" when absent); several header lines are joined with a comma. */
export const betaHeaderOf = (headers: IncomingHttpHeaders): string => {
  const value = headers["anthropic-beta"];
  return Array.isArray(value) ? value.join(",") : (value ?? "");
};

/** True when the request names a loopback host (any port): a page on another origin that resolves to 127.0.0.1 sends its own Host and is refused. */
export const hasLoopbackHost = (headers: IncomingHttpHeaders): boolean => HostHeaderSchema.safeParse(headers.host).success;

/** True only for the placeholder key, exactly: the real key, a lookalike or none is refused. */
export const hasPlaceholderKey = (headers: IncomingHttpHeaders): boolean => headers["x-api-key"] === GATEWAY_PLACEHOLDER_KEY;

/** The media type line of a message (lower-cased), or "" when it has none. */
export const contentTypeOf = (headers: Headers): string => (first(headers["content-type"]) ?? "").toLowerCase();

/** True when the reply is a Server-Sent Events stream. */
export const isEventStream = (headers: Headers): boolean => contentTypeOf(headers).startsWith("text/event-stream");

/** True when the body is encoded (gzip, br, ...): its usage cannot be read and it is not recorded. */
export function isEncoded(headers: Headers): boolean {
  const encoding = first(headers["content-encoding"])?.trim().toLowerCase();
  return encoding !== undefined && encoding !== "" && encoding !== "identity";
}
