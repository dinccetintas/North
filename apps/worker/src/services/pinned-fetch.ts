import { lookup as dnsLookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from "undici";
import { CompetitorSites, type AllowUrl, type Integrations } from "@north/integrations";

/**
 * D6-11 (M5 review L1): DNS pinning for every fetch whose URL an agent or a
 * page chose (the evidence verifier, the competitor source). The host is
 * resolved once, every address it resolves to is vetted, and the request is
 * dispatched on an undici `Agent` whose `connect.lookup` answers with the
 * vetted address only, so a DNS answer that changes between the check and the
 * connection (rebinding) cannot point the worker at a private network.
 * Redirects are never followed: a 3xx is returned to the caller as is.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ResolvedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

export type Resolver = (hostname: string) => Promise<readonly ResolvedAddress[]>;

export type HostRefusal = "private" | "unresolvable";

/** The host was refused before any connection was opened. */
export class HostRefusedError extends Error {
  constructor(
    readonly host: string,
    readonly refusal: HostRefusal,
  ) {
    super(refusal === "private" ? `host ${host} is private` : `host ${host} does not resolve`);
    this.name = "HostRefusedError";
  }
}

const privateV4 = (a: number, b: number): boolean => a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);

/** An IPv6 literal as eight 16-bit groups (`::` expanded, a trailing dotted quad folded in); null when it is not one. */
function hextets(address: string): readonly number[] | null {
  const lower = address.toLowerCase().replace(/%.*$/, "");
  const quad = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(lower);
  const v4tail = quad ? `${((Number(quad[1]) << 8) | Number(quad[2])).toString(16)}:${((Number(quad[3]) << 8) | Number(quad[4])).toString(16)}` : null;
  const text = quad && v4tail ? lower.slice(0, quad.index) + v4tail : lower;
  const [head = "", tail, extra] = text.split("::");
  if (extra !== undefined) return null;
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const fill = tail === undefined ? 0 : 8 - left.length - right.length;
  const groups = [...left, ...Array<string>(Math.max(fill, 0)).fill("0"), ...right].map((g) => Number.parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

/** IPv6 private ranges, and every form that embeds an IPv4 address (mapped `::ffff:0:0/96`, compatible `::/96`, NAT64 `64:ff9b::/96`) judged by that address. */
function privateV6(address: string): boolean {
  const g = hextets(address);
  if (!g) return true;
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0] = g;
  const zeroTo4 = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;
  const embedsV4 = (zeroTo4 && (g5 === 0xffff || g5 === 0)) || (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0);
  // `::` and `::1` embed 0.0.0.0 and 0.0.0.1, which privateV4 already refuses.
  if (embedsV4) return privateV4(g6 >> 8, g6 & 0xff);
  return (g0 & 0xfe00) === 0xfc00 || (g0 & 0xffc0) === 0xfe80 || (g0 & 0xffc0) === 0xfec0 || (g0 & 0xff00) === 0xff00;
}

/** True for addresses the worker must never be pointed at from agent-written content. */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a = 0, b = 0] = address.split(".").map(Number);
    return privateV4(a, b);
  }
  return family === 6 ? privateV6(address) : false;
}

/** Names that mean "this machine or its network" whatever DNS says. */
export const isPrivateName = (host: string): boolean => host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local");

/** `[::1]` → `::1`, lower-cased. */
export const bareHost = (hostname: string): string => hostname.replace(/^\[|\]$/g, "").toLowerCase();

const familyOf = (address: string): 4 | 6 => (isIP(address) === 6 ? 6 : 4);

export const systemResolver: Resolver = async (host) => (await dnsLookup(host, { all: true, verbatim: true })).map((a) => Object.freeze({ address: a.address, family: familyOf(a.address) }));

export interface VetOptions {
  readonly resolve?: Resolver;
  /** Loopback, link-local and RFC 1918 hosts: only the sandbox stack needs them. */
  readonly allowPrivate?: boolean;
}

/**
 * Resolves the host once and returns the address the connection will use (the
 * first answer); refuses a local name, a private literal, any private answer
 * and a host that does not resolve. `hostIsPrivate` in the verifier follows
 * the same rules.
 */
export async function vetHost(hostname: string, opts: VetOptions = {}): Promise<ResolvedAddress> {
  const host = bareHost(hostname);
  const allowPrivate = opts.allowPrivate ?? false;
  if (!allowPrivate && isPrivateName(host)) throw new HostRefusedError(host, "private");
  if (isIP(host)) {
    if (!allowPrivate && isPrivateAddress(host)) throw new HostRefusedError(host, "private");
    return Object.freeze({ address: host, family: familyOf(host) });
  }
  let addresses: readonly ResolvedAddress[];
  try {
    addresses = await (opts.resolve ?? systemResolver)(host);
  } catch {
    throw new HostRefusedError(host, "unresolvable");
  }
  const first = addresses[0];
  if (!first) throw new HostRefusedError(host, "unresolvable");
  if (!allowPrivate && addresses.some((a) => isPrivateAddress(a.address))) throw new HostRefusedError(host, "private");
  return Object.freeze({ address: first.address, family: first.family });
}

/** The connection's own lookup: whatever it is asked, the vetted address. */
const pinnedLookup =
  (pin: ResolvedAddress): LookupFunction =>
  (_hostname, options, callback) => {
    if (options.all) callback(null, [{ address: pin.address, family: pin.family }]);
    else callback(null, pin.address, pin.family);
  };

export interface PinnedFetchOptions extends VetOptions {
  readonly connectTimeoutMs?: number;
}

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;

/**
 * A fetch that vets and pins. One `Agent` per request: the socket is closed
 * once the body is read or cancelled (a caller that only needs the status
 * should cancel it), so no pooled connection outlives its vetted address.
 */
export function createPinnedFetch(opts: PinnedFetchOptions = {}): FetchLike {
  return async (input, init) => {
    const url = new URL(input);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new TypeError(`pinned fetch: ${url.protocol} is not http(s)`);
    const pin = await vetHost(url.hostname, opts);
    const agent = new Agent({ connect: { lookup: pinnedLookup(pin), timeout: opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS } });
    try {
      // The global and the undici fetch types differ only nominally; the runtime objects are the same WHATWG shapes.
      const response = await undiciFetch(url, { ...(init as UndiciRequestInit | undefined), redirect: "manual", dispatcher: agent });
      void agent.close().catch(() => undefined);
      return response as unknown as Response;
    } catch (error) {
      void agent.destroy().catch(() => undefined);
      throw error;
    }
  };
}

/** The live policy: public hosts only. */
export const pinnedFetch: FetchLike = createPinnedFetch();

/**
 * deps wiring: in live mode the competitor source fetches through the pinned
 * fetch (the other live adapters call fixed provider hosts and keep their
 * own fetch); sandbox integrations are returned untouched.
 */
export function withPinnedCompetitorFetch(integrations: Integrations, allowUrl: AllowUrl, fetchImpl: FetchLike = pinnedFetch): Integrations {
  if (integrations.mode !== "live") return integrations;
  const signals = integrations.signals.map((source) => (source.id === "competitor_sites" ? new CompetitorSites({ fetchImpl, allowUrl }) : source));
  return Object.freeze({ ...integrations, signals: Object.freeze(signals) });
}
