// SEC-1: the options of the model gateway, validated once at start-up. The
// upstream is fixed here and never taken from a request; the real key is
// required exactly when the gateway will contact the upstream.
import { z } from "zod";
import { isLoopbackHost } from "../host";
import { GatewayBudget } from "./budget";

/** `live` forwards, `record` forwards and stores each exchange, `replay` answers from stored exchanges and never contacts the upstream. */
export type GatewayMode = "live" | "record" | "replay";

/** Options for `startGateway`. */
export interface GatewayOptions {
  /** The real model key. May be null in `replay`, which never contacts the upstream. */
  readonly apiKey: string | null;
  /** Base URL of the model API, e.g. `https://api.anthropic.com` (https unless loopback, for tests). */
  readonly upstream: string;
  readonly mode: GatewayMode;
  /** Where cassettes live (read in `replay`, written in `record`). */
  readonly cassetteDir: string;
  readonly budget: GatewayBudget;
  /** Bind address: loopback only. */
  readonly host?: "127.0.0.1";
  /** Port to bind; an ephemeral one when omitted. */
  readonly port?: number;
  /** Request body limit in bytes (default 32 MB). */
  readonly maxRequestBytes?: number;
  /** How much of a reply is kept for recording (default 8 MB); a larger reply is served and priced but not recorded. */
  readonly maxCaptureBytes?: number;
  /** How long the upstream may stay silent, before its headers or between chunks, before the exchange is cut (default 10 minutes; at most 2^31 - 1 ms). */
  readonly upstreamTimeoutMs?: number;
  /** Where one-line warnings go (default `console.warn`). */
  readonly log?: (message: string) => void;
}

/** Request body limit: a Messages request with a long transcript fits well below this. */
export const DEFAULT_MAX_REQUEST_BYTES = 32 * 1024 * 1024;
/** Reply bytes kept for recording (and for reading a non-streaming reply's usage); a larger reply streams through unrecorded. */
export const DEFAULT_MAX_CAPTURE_BYTES = 8 * 1024 * 1024;
/** Idle time after which a silent upstream is cut: a long generation still sends chunks, so this only catches a hung connection. */
export const DEFAULT_UPSTREAM_TIMEOUT_MS = 10 * 60 * 1000;

/** The options after validation, with defaults filled in. */
export interface ResolvedOptions {
  readonly apiKey: string | null;
  readonly upstream: URL;
  readonly mode: GatewayMode;
  readonly cassetteDir: string;
  readonly budget: GatewayBudget;
  readonly port: number;
  readonly maxRequestBytes: number;
  readonly maxCaptureBytes: number;
  readonly upstreamTimeoutMs: number;
  /** Never throws: a logger must not be able to break the proxy. */
  readonly log: (message: string) => void;
}

const UpstreamSchema = z.url().superRefine((value, ctx) => {
  const url = URL.canParse(value) ? new URL(value) : null;
  if (url === null) return;
  const secure = url.protocol === "https:" || (url.protocol === "http:" && isLoopbackHost(url.hostname));
  if (!secure) ctx.addIssue({ code: "custom", message: "must be https (http only for a loopback host)" });
  if (url.username || url.password) ctx.addIssue({ code: "custom", message: "must not carry credentials" });
  if (url.search || url.hash) ctx.addIssue({ code: "custom", message: "must not carry a query or fragment" });
});

const Bytes = z.number().int().positive();
/** The longest delay a Node timer holds (2^31 - 1 ms, about 24.8 days); a longer one fires at once. */
const MAX_TIMER_MS = 2_147_483_647;
const TimeoutMs = z.number().int().positive().max(MAX_TIMER_MS);

const OptionsSchema = z.object({
  apiKey: z.string().nullable(),
  upstream: UpstreamSchema,
  mode: z.enum(["live", "record", "replay"]),
  cassetteDir: z.string().min(1, "cassetteDir must name a directory"),
  budget: z.instanceof(GatewayBudget),
  host: z.literal("127.0.0.1").optional(),
  port: z.number().int().min(0).max(65535).optional(),
  maxRequestBytes: Bytes.optional(),
  maxCaptureBytes: Bytes.optional(),
  upstreamTimeoutMs: TimeoutMs.optional(),
  log: z.custom<(message: string) => void>((value) => typeof value === "function").optional(),
});

/** A header value the real key can be sent as: printable ASCII, no space. */
const HEADER_SAFE_KEY = /^[\x21-\x7e]+$/;

/** A logger that cannot throw: whatever the injected one does, the proxy carries on. */
const safeLog =
  (log: (message: string) => void) =>
  (message: string): void => {
    try {
      log(message);
    } catch {
      // Nothing to do: logging is best effort.
    }
  };

const describeIssue = (issue: z.core.$ZodIssue): string => `${issue.path.join(".") || "options"}: ${issue.message}`;

/** The key rule: live and record contact the upstream, so they need a usable key. The key itself is never named in an error. */
function keyProblem(apiKey: string | null, mode: GatewayMode): string | null {
  if (mode === "replay") return null;
  if (apiKey === null || apiKey === "") return `an API key is required in ${mode} mode (set ANTHROPIC_API_KEY on the worker)`;
  return HEADER_SAFE_KEY.test(apiKey) ? null : "the API key has characters that cannot go in a header";
}

/**
 * Validates `startGateway`'s options and fills in the defaults. Throws one
 * readable error naming every problem; never echoes the key.
 */
export function resolveOptions(options: GatewayOptions): ResolvedOptions {
  const parsed = OptionsSchema.safeParse(options);
  if (!parsed.success) throw new Error(`startGateway: ${parsed.error.issues.map(describeIssue).join("; ")}`);
  const { data } = parsed;
  const keyIssue = keyProblem(data.apiKey, data.mode);
  if (keyIssue !== null) throw new Error(`startGateway: ${keyIssue}`);
  return Object.freeze({
    apiKey: data.apiKey,
    upstream: new URL(data.upstream),
    mode: data.mode,
    cassetteDir: data.cassetteDir,
    budget: data.budget,
    port: data.port ?? 0,
    maxRequestBytes: data.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES,
    maxCaptureBytes: data.maxCaptureBytes ?? DEFAULT_MAX_CAPTURE_BYTES,
    upstreamTimeoutMs: data.upstreamTimeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS,
    log: safeLog(data.log ?? ((message: string) => console.warn(message))),
  });
}
