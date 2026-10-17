// CMP-1: the pure pieces of the `/u/{token}` rate limit: who the client is, which key it is counted under, and the bucket itself.
import { isIP } from "node:net";

/** The key for a request whose client address cannot be read: one shared bucket, so such requests are limited together. */
export const UNKNOWN_CLIENT = "unknown";

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
 * worker runs behind Fly's edge (`NORTH_TRUST_PROXY=1`), where Fly sets
 * `Fly-Client-IP` from the connection it accepted. `X-Forwarded-For` is never
 * read: behind an appending proxy its first entry is whatever the client sent.
 * A value that is not an IP is ignored; without any, {@link UNKNOWN_CLIENT}.
 */
export function clientIpOf(headers: Pick<Headers, "get">, socketAddress: string | undefined, trustProxy: boolean): string {
  const fly = trustProxy ? ipOf(headers.get("fly-client-ip")) : null;
  return fly ?? ipOf(socketAddress) ?? UNKNOWN_CLIENT;
}

/** The eight 16-bit groups of an IPv6 address (`::` expanded, a trailing dotted IPv4 folded into two groups), or null. */
function ipv6Groups(ip: string): readonly number[] | null {
  const dotted = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  const octets = dotted ? dotted.slice(1).map(Number) : [];
  const text = dotted ? `${ip.slice(0, dotted.index)}${(((octets[0] ?? 0) << 8) | (octets[1] ?? 0)).toString(16)}:${(((octets[2] ?? 0) << 8) | (octets[3] ?? 0)).toString(16)}` : ip;
  const [head = "", tail, ...more] = text.split("::");
  if (more.length > 0) return null;
  const front = head === "" ? [] : head.split(":");
  const back = tail === undefined || tail === "" ? [] : tail.split(":");
  const groups = tail === undefined ? front : [...front, ...Array.from({ length: 8 - front.length - back.length }, () => "0"), ...back];
  const values = groups.map((group) => Number.parseInt(group, 16));
  return values.length === 8 && values.every((value) => Number.isInteger(value) && value >= 0 && value <= 0xffff) ? Object.freeze(values) : null;
}

/** The bucket key of a client: an IPv4 address itself, an IPv6 address its /64 (one subscriber's prefix), anything else as given. */
export function rateKeyOf(clientIp: string): string {
  if (isIP(clientIp) !== 6) return clientIp;
  const groups = ipv6Groups(clientIp.split("%")[0] ?? clientIp);
  return groups ? `${groups.slice(0, 4).map((group) => group.toString(16)).join(":")}::/64` : clientIp;
}
