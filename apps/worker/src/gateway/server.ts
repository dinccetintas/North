// SEC-1 / TST-1 / TST-2: the model gateway. A loopback `node:http` server in the
// worker process that the agent subprocess calls instead of the model API. The
// subprocess carries a placeholder key; only this module holds the real one,
// injects it, enforces the day's spend cap, and records or replays exchanges
// as cassettes. Replies stream through byte for byte (SSE included); no fetch,
// no buffering of the wire, only a bounded copy for pricing and recording.
import { createServer, request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type RequestOptions, type Server, type ServerResponse } from "node:http";
import { request as httpsRequest } from "node:https";
import type { AddressInfo } from "node:net";
import { costOfUsage } from "@north/core";
import { z } from "zod";
import { createCapture } from "./capture";
import { cassetteKey, readCassette, writeCassette, type CassetteResponse } from "./cassette";
import { hasLoopbackHost, hasPlaceholderKey, isEncoded, replyHeaders, upstreamHeaders, type Headers } from "./headers";
import { resolveOptions, type GatewayOptions, type ResolvedOptions } from "./options";
import { usageFromResponse } from "./usage";

export { DEFAULT_MAX_CAPTURE_BYTES, DEFAULT_MAX_REQUEST_BYTES } from "./options";
export type { GatewayMode, GatewayOptions } from "./options";

/** What the gateway has done since it started (spend and `unpriced` are the budget's, for today). */
export interface GatewayStats {
  /** `/v1/messages` requests that passed authentication and the cap: forwarded, replayed or missed. */
  readonly requests: number;
  readonly spentUsd: number;
  /** Replays that found no cassette. */
  readonly misses: number;
  /** Replies whose cost could not be computed: spend the cap does not see. */
  readonly unpriced: number;
  readonly capUsd: number;
}

/** A running gateway. */
export interface Gateway {
  readonly baseUrl: string;
  /** Stops listening and cuts every exchange in flight (the kill switch relies on this). */
  close(): Promise<void>;
  stats(): GatewayStats;
}

type Route = "messages" | "count_tokens";

/** The only paths proxied, by route. The upstream path comes from here, never from the request. */
const ROUTE_PATHS: Readonly<Record<string, Route>> = Object.freeze({ "/v1/messages": "messages", "/v1/messages/count_tokens": "count_tokens" });
const UPSTREAM_PATHS: Readonly<Record<Route, string>> = Object.freeze({ messages: "/v1/messages", count_tokens: "/v1/messages/count_tokens" });

/** A request body that is a JSON object; anything else is not a Messages request. */
const BodySchema = z.record(z.string(), z.unknown());

/** Past this many times the body limit the gateway stops reading and hangs up. */
const DRAIN_FACTOR = 4;

interface Context {
  readonly opts: ResolvedOptions;
  readonly counters: { requests: number; misses: number };
}

/** One request on its way upstream. `key` is null for `count_tokens`, which is never priced or recorded. */
interface Exchange {
  readonly route: Route;
  readonly search: string;
  readonly body: Buffer;
  readonly key: string | null;
}

type Screened = { readonly ok: true; readonly route: Route; readonly search: string } | { readonly ok: false; readonly status: number; readonly type: string };

const refuse = (status: number, type: string): Screened => ({ ok: false, status, type });

/** Answers with `{ error }` as JSON. A reply already under way is cut instead. */
function sendError(res: ServerResponse, status: number, error: Record<string, unknown>): void {
  if (res.destroyed) return;
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const body = Buffer.from(JSON.stringify({ error }));
  res.writeHead(status, { "content-type": "application/json", "content-length": body.length });
  res.end(body);
}

/** The route and query of an origin-form request target, or null for any other target (absolute, protocol-relative, unknown path). */
function parseTarget(rawUrl: string | undefined): { route: Route; search: string } | null {
  if (rawUrl === undefined || !/^\/(?!\/)/.test(rawUrl) || !URL.canParse(rawUrl, "http://gateway.invalid")) return null;
  const url = new URL(rawUrl, "http://gateway.invalid");
  const route = Object.hasOwn(ROUTE_PATHS, url.pathname) ? ROUTE_PATHS[url.pathname] : undefined;
  return route === undefined ? null : { route, search: url.search };
}

/** Host first (rebinding), then the placeholder key, then the route: a caller learns nothing about the routes without the key. */
function screen(req: IncomingMessage): Screened {
  if (!hasLoopbackHost(req.headers)) return refuse(403, "north_gateway_forbidden");
  if (!hasPlaceholderKey(req.headers)) return refuse(401, "north_gateway_unauthorized");
  const target = req.method === "POST" ? parseTarget(req.url) : null;
  return target === null ? refuse(404, "north_gateway_not_found") : { ok: true, ...target };
}

/** The whole request body, or null when it is over the limit (or the caller left). Bytes past the limit are discarded as they arrive. */
function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit * DRAIN_FACTOR) req.destroy();
      else if (size <= limit) chunks.push(chunk);
      else {
        chunks.length = 0;
        resolve(null);
      }
    });
    req.on("end", () => resolve(size <= limit ? Buffer.concat(chunks) : null));
    req.on("error", () => resolve(null));
    req.on("close", () => resolve(null));
  });
}

const parseJson = (body: Buffer): unknown => {
  try {
    return JSON.parse(body.toString("utf8")) as unknown;
  } catch {
    return undefined;
  }
};

/** Settles the budget with the cost of a reply: a 2xx without a readable usage (or with an unknown model) settles NaN, which the budget counts as unpriced. Errors cost nothing. */
function settleFromBody(ctx: Context, status: number, headers: Headers, body: Buffer | null): void {
  if (status < 200 || status >= 300) return;
  const usage = body === null || isEncoded(headers) ? null : usageFromResponse(body, headers);
  ctx.opts.budget.settle(usage === null ? Number.NaN : costOfUsage(usage));
}

/** Answers from the cassette of `key`: the stored status, headers and body, priced like a live reply. A miss or a broken file is a 502 naming the key. */
async function replayFrom(ctx: Context, res: ServerResponse, key: string): Promise<void> {
  let cassette: CassetteResponse | null;
  try {
    cassette = await readCassette(ctx.opts.cassetteDir, key);
  } catch (error) {
    ctx.opts.log(`gateway: ${error instanceof Error ? error.message : "cassette unreadable"}`);
    return sendError(res, 502, { type: "north_cassette_invalid", key });
  }
  if (cassette === null) {
    ctx.counters.misses += 1;
    return sendError(res, 502, { type: "north_cassette_miss", key });
  }
  settleFromBody(ctx, cassette.status, cassette.headers, cassette.body);
  const stored: Record<string, string> = {};
  for (const [name, value] of Object.entries(replyHeaders(cassette.headers))) stored[name] = String(value);
  res.writeHead(cassette.status, { ...stored, "content-length": cassette.body.length });
  res.end(cassette.body);
}

/** After a reply has ended: settle its cost, and in record mode store the whole exchange. Nothing here may throw. */
async function conclude(ctx: Context, ex: Exchange, req: IncomingMessage, status: number, headers: IncomingHttpHeaders, captured: Buffer | null, complete: boolean): Promise<void> {
  if (ex.key === null) return;
  const unusable = captured === null ? "reply too large to price or record" : isEncoded(headers) ? "reply is compressed, so it cannot be priced or recorded" : null;
  if (unusable !== null) ctx.opts.log(`gateway: ${unusable} (${ex.key.slice(0, 12)})`);
  settleFromBody(ctx, status, headers, unusable === null ? captured : null);
  if (ctx.opts.mode !== "record" || !complete || unusable !== null || captured === null) return;
  try {
    const stored = { status, headers: replyHeaders(headers), body: captured };
    await writeCassette(ctx.opts.cassetteDir, ex.key, stored, { method: "POST", path: req.url ?? "", headers: req.headers, body: ex.body });
  } catch (error) {
    ctx.opts.log(`gateway: could not record ${ex.key.slice(0, 12)}: ${error instanceof Error ? error.message : "write failed"}`);
  }
}

/**
 * Streams the upstream's reply to the caller as it arrives and keeps a bounded
 * copy. The caller's response ends only after the cost is settled and, in
 * record mode, the cassette is written, so a caller that has seen the end can
 * rely on both. A reply cut short (either side hangs up) is priced from what
 * arrived and never recorded.
 */
function relay(ctx: Context, ex: Exchange, req: IncomingMessage, upRes: IncomingMessage, res: ServerResponse): void {
  const capture = createCapture(ctx.opts.maxCaptureBytes);
  const status = upRes.statusCode ?? 502;
  let concluded = false;
  const finish = (complete: boolean): Promise<void> => {
    if (concluded) return Promise.resolve();
    concluded = true;
    return conclude(ctx, ex, req, status, upRes.headers, capture.result(), complete);
  };
  res.writeHead(status, replyHeaders(upRes.headers));
  upRes.on("data", (chunk: Buffer) => {
    capture.add(chunk);
    if (res.write(chunk)) return;
    upRes.pause();
    res.once("drain", () => upRes.resume());
  });
  upRes.on("end", () => void finish(true).then(() => res.end()));
  upRes.on("close", () => {
    if (!upRes.complete) void finish(false).then(() => res.destroy());
  });
  upRes.on("error", () => void finish(false).then(() => res.destroy()));
}

/** Sends the request upstream with the real key and relays the reply. A connection failure is a 502; a caller that hangs up cancels the upstream request. */
function forward(ctx: Context, req: IncomingMessage, res: ServerResponse, ex: Exchange): void {
  const { upstream, apiKey } = ctx.opts;
  const options: RequestOptions = {
    protocol: upstream.protocol,
    hostname: upstream.hostname.replace(/^\[|\]$/g, ""),
    ...(upstream.port === "" ? {} : { port: Number(upstream.port) }),
    method: "POST",
    path: `${upstream.pathname.replace(/\/$/, "")}${UPSTREAM_PATHS[ex.route]}${ex.search}`,
    headers: upstreamHeaders(req.headers, apiKey ?? "", upstream.host, ex.body.length),
  };
  const upReq = upstream.protocol === "https:" ? httpsRequest(options) : httpRequest(options);
  upReq.on("response", (upRes) => relay(ctx, ex, req, upRes, res));
  upReq.on("error", (error: NodeJS.ErrnoException) => {
    if (!res.destroyed) ctx.opts.log(`gateway: upstream unreachable (${error.code ?? error.name})`);
    sendError(res, 502, { type: "north_upstream_unreachable" });
  });
  res.on("close", () => {
    if (!res.writableFinished) upReq.destroy();
  });
  upReq.end(ex.body);
}

/** The cap check for `/v1/messages`: a 402 once the day's spend has reached the cap. True when the request may go on. */
function underCap(ctx: Context, res: ServerResponse): boolean {
  const { budget } = ctx.opts;
  if (budget.reserve(0)) return true;
  const { capUsd, spentUsd } = budget.stats();
  sendError(res, 402, { type: "north_budget_exceeded", cap_usd: capUsd, spent_usd: spentUsd });
  return false;
}

/** One request: screen it, read it, gate it on the cap, then replay or forward. */
async function handle(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const screened = screen(req);
  if (!screened.ok) return sendError(res, screened.status, { type: screened.type });
  const body = await readBody(req, ctx.opts.maxRequestBytes);
  if (body === null) return sendError(res, 413, { type: "north_gateway_too_large" });
  if (screened.route === "count_tokens") {
    if (ctx.opts.mode === "replay") return sendError(res, 501, { type: "north_replay_unsupported" });
    return forward(ctx, req, res, { route: "count_tokens", search: screened.search, body, key: null });
  }
  const parsed = BodySchema.safeParse(parseJson(body));
  if (!parsed.success) return sendError(res, 400, { type: "north_gateway_bad_request" });
  if (!underCap(ctx, res)) return;
  ctx.counters.requests += 1;
  const key = cassetteKey(parsed.data);
  if (ctx.opts.mode === "replay") return replayFrom(ctx, res, key);
  forward(ctx, req, res, { route: "messages", search: screened.search, body, key });
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

/**
 * Starts the gateway on `127.0.0.1` (an ephemeral port unless `port` is
 * given). Throws a readable error when an option is invalid, or when `live`
 * or `record` mode has no API key. The agent subprocess is pointed at
 * `baseUrl` with the placeholder key.
 */
export async function startGateway(options: GatewayOptions): Promise<Gateway> {
  const opts = resolveOptions(options);
  const ctx: Context = { opts, counters: { requests: 0, misses: 0 } };
  const server = createServer((req, res) => {
    handle(ctx, req, res).catch((error: unknown) => {
      opts.log(`gateway: request failed: ${error instanceof Error ? error.message : "unknown error"}`);
      sendError(res, 500, { type: "north_gateway_internal" });
    });
  });
  await listen(server, opts.port);
  const { port } = server.address() as AddressInfo;
  return Object.freeze({
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => closeServer(server),
    stats: (): GatewayStats => {
      const { capUsd, spentUsd, unpriced } = opts.budget.stats();
      return Object.freeze({ requests: ctx.counters.requests, spentUsd, misses: ctx.counters.misses, unpriced, capUsd });
    },
  });
}
