// CMP-1 / Review Focus 2: the public `/u/{token}` route: a verified token writes one opt-out, everything else is a plain 404 that changes nothing.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { signUnsubscribeToken } from "@north/core";
import { Hono } from "hono";
import { SANDBOX_UNSUBSCRIBE_SECRET } from "../src/env";
import type { UnsubscribeRouteEnv } from "../src/webhooks/unsubscribe";
import { emptyState, fakeDbModule, type FakeState } from "./fake-db";

const state: FakeState = emptyState();
const dbModule = fakeDbModule(state);
vi.mock("@north/db", () => dbModule);

const { clientIpOf, OPTED_OUT_TEXT, TokenBucket, UNSUBSCRIBE_BODY_MAX_BYTES, unsubscribeApp } = await import("../src/webhooks/unsubscribe");

const COMPANY = "6b3f4f0e-5d0c-4b6a-9d55-3c1f2a7e8b90";
const OTHER_COMPANY = "0f9e8d7c-6b5a-4c3d-8e2f-1a0b9c8d7e6f";
const SANDBOX_ENV: UnsubscribeRouteEnv = { UNSUBSCRIBE_SECRET: undefined, INTEGRATIONS_MODE: "sandbox", WORKER_HOST: "127.0.0.1", WORKER_PORT: 3101, NORTH_TRUST_PROXY: "0" };
const token = (email = "Ada@Example.test", companyId = COMPANY, secret = SANDBOX_UNSUBSCRIBE_SECRET) => signUnsubscribeToken({ companyId, email }, secret);
const NOW = 1_760_000_000_000;

type App = Pick<Hono, "request">;
/** A request as the node server hands it over: the socket's remote address in the bindings; the sandbox worker's own origin unless told otherwise. */
const call = (app: App, path: string, init: RequestInit = {}, ip = "203.0.113.10", origin = "http://127.0.0.1:3101") => app.request(`${origin}${path}`, init, { incoming: { socket: { remoteAddress: ip } } });
const oneClick = { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" };

/** Every response header as one string, to check nothing of the token is echoed there. */
const headerText = (response: Response): string => {
  const lines: string[] = [];
  response.headers.forEach((value, name) => lines.push(`${name}: ${value}`));
  return lines.join("\n");
};

/** The one failure answer: 404 text/plain "Not found", no redirect, no caching, nothing of the token echoed. */
async function expectNotFound(response: Response, sent: string): Promise<void> {
  expect(response.status).toBe(404);
  expect(response.headers.get("location")).toBeNull();
  expect(response.headers.get("content-type")).toMatch(/^text\/plain/);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = await response.text();
  expect(body).toBe("Not found");
  expect(body).not.toContain(sent);
  expect(headerText(response)).not.toContain(sent.slice(0, 24));
}

let app: Hono;
beforeEach(() => {
  Object.assign(state, emptyState());
  app = unsubscribeApp({ db: {} as never }, SANDBOX_ENV, { now: () => NOW });
});

describe("unsubscribe route (CMP-1)", () => {
  it("CMP-1: GET with a valid token answers 200 text/plain, writes one opt_out row for the token's company and address, and caches nothing", async () => {
    const t = token();
    const response = await call(app, `/u/${t}`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(OPTED_OUT_TEXT);
    expect(OPTED_OUT_TEXT).toBe("You will not hear from us again.");
    expect(response.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(headerText(response)).not.toContain(t.slice(0, 24));
    expect(state.suppressions).toEqual([{ companyId: COMPANY, email: "ada@example.test", reason: "opt_out", sourceActionId: null }]);
  });

  it("CMP-1: POST with the RFC 8058 body answers 200; a second hit (GET or POST) answers 200 and still leaves one row", async () => {
    const t = token();
    expect((await call(app, `/u/${t}`, oneClick)).status).toBe(200);
    expect((await call(app, `/u/${t}`, oneClick)).status).toBe(200);
    expect((await call(app, `/u/${t}`)).status).toBe(200);
    expect(state.suppressions).toHaveLength(1);
    expect((await call(app, `/u/${token("bob@example.test")}`, oneClick)).status).toBe(200);
    expect(state.suppressions.map((r) => r.email)).toEqual(["ada@example.test", "bob@example.test"]);
  });

  it("Review Focus 2: a token signed with another secret (another company's), a tampered token, or one from before a secret rotation answers 404 and writes nothing", async () => {
    const foreign = token("ada@example.test", OTHER_COMPANY, "another-company-secret-0123456789");
    await expectNotFound(await call(app, `/u/${foreign}`), foreign);
    await expectNotFound(await call(app, `/u/${foreign}`, oneClick), foreign);
    const good = token();
    const tampered = `${good.slice(0, 10)}${good[10] === "A" ? "B" : "A"}${good.slice(11)}`;
    await expectNotFound(await call(app, `/u/${tampered}`), tampered);
    // Tokens carry no expiry (an unsubscribe link must keep working); a link stops working when its secret is rotated away.
    const rotated = unsubscribeApp({ db: {} as never }, { ...SANDBOX_ENV, UNSUBSCRIBE_SECRET: "the-new-unsubscribe-secret-01" }, { now: () => NOW });
    expect((await call(rotated, `/u/${token("ada@example.test", COMPANY, "the-new-unsubscribe-secret-01")}`)).status).toBe(200);
    state.suppressions.length = 0;
    await expectNotFound(await call(rotated, `/u/${good}`), good);
    expect(state.suppressions).toEqual([]);
  });

  it("Review Focus 2: no secret configured (live mode without UNSUBSCRIBE_SECRET, or sandbox off loopback) answers 404 for every token", async () => {
    const t = token();
    for (const env of [{ ...SANDBOX_ENV, INTEGRATIONS_MODE: "live" as const }, { ...SANDBOX_ENV, WORKER_HOST: "0.0.0.0" }]) {
      const off = unsubscribeApp({ db: {} as never }, env, { now: () => NOW });
      await expectNotFound(await call(off, `/u/${t}`), t);
      await expectNotFound(await call(off, `/u/${t}`, oneClick), t);
    }
    expect(state.suppressions).toEqual([]);
  });

  it("Review Focus 2: a malformed path or another method answers the same 404, never a 500 or a redirect", async () => {
    const t = token();
    for (const path of ["/u", "/u/", `/u/${t}/extra`, `/u/${"A".repeat(5000)}`, "/u/%E0%A4%A", "/u/not.base64!", "/u/%2e%2e%2fadmin"]) await expectNotFound(await call(app, path), t);
    for (const method of ["PUT", "DELETE", "PATCH"]) await expectNotFound(await call(app, `/u/${t}`, { method }), t);
    expect(state.suppressions).toEqual([]);
  });

  it("CMP-1: a HEAD (a link checker) verifies nothing and writes nothing", async () => {
    expect((await call(app, `/u/${token()}`, { method: "HEAD" })).status).toBe(404);
    expect(state.suppressions).toEqual([]);
  });

  it("Review Focus 2: a body over 1 KB answers 413, by content-length or streamed, and writes nothing", async () => {
    const t = token();
    const big = "x".repeat(2048);
    const streamed = await call(app, `/u/${t}`, { method: "POST", body: big });
    expect(streamed.status).toBe(413);
    expect(streamed.headers.get("cache-control")).toBe("no-store");
    expect(await streamed.text()).not.toContain(t);
    expect((await call(app, `/u/${t}`, { method: "POST", headers: { "content-length": "2048" }, body: big })).status).toBe(413);
    expect((await call(app, `/u/${t}`, { headers: { "content-length": "4096" } })).status).toBe(413);
    expect(state.suppressions).toEqual([]);
    expect((await call(app, `/u/${t}`, { method: "POST", body: "x".repeat(UNSUBSCRIBE_BODY_MAX_BYTES) })).status).toBe(200);
  });

  it("Review Focus 2: the 61st request in a minute from one IP answers 429; another IP is unaffected", async () => {
    const t = token();
    for (let i = 0; i < 60; i += 1) expect((await call(app, `/u/${t}`, {}, "198.51.100.1")).status).toBe(200);
    const limited = await call(app, `/u/${t}`, {}, "198.51.100.1");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("cache-control")).toBe("no-store");
    expect(await limited.text()).not.toContain(t);
    expect((await call(app, "/u/garbage", {}, "198.51.100.1")).status).toBe(429);
    expect((await call(app, `/u/${t}`, {}, "198.51.100.2")).status).toBe(200);
  });

  it("Review Focus 2: forwarded client-IP headers are ignored unless NORTH_TRUST_PROXY=1", async () => {
    const spoof = (i: number) => ({ headers: { "fly-client-ip": `192.0.2.${i}`, "x-forwarded-for": `192.0.2.${i}` } });
    for (let i = 0; i < 60; i += 1) await call(app, "/u/garbage", spoof(i), "198.51.100.3");
    expect((await call(app, "/u/garbage", spoof(99), "198.51.100.3")).status).toBe(429);
    const trusting = unsubscribeApp({ db: {} as never }, { ...SANDBOX_ENV, NORTH_TRUST_PROXY: "1" }, { now: () => NOW });
    for (let i = 0; i < 61; i += 1) expect((await call(trusting, "/u/garbage", spoof(i), "10.0.0.1")).status).toBe(404);
    for (let i = 0; i < 60; i += 1) await call(trusting, "/u/garbage", spoof(200), "10.0.0.1");
    expect((await call(trusting, "/u/garbage", spoof(200), "10.0.0.1")).status).toBe(429);
  });

  it("M6 review L4: with the public sandbox secret only this machine is answered (loopback Host, no cross-site POST); a configured secret answers any host", async () => {
    const t = token();
    await expectNotFound(await call(app, `/u/${t}`, {}, undefined, "http://evil.example:3101"), t);
    await expectNotFound(await call(app, `/u/${t}`, { headers: { host: "evil.example:3101" } }), t);
    await expectNotFound(await call(app, `/u/${t}`, { ...oneClick, headers: { ...oneClick.headers, "sec-fetch-site": "cross-site", origin: "https://evil.example" } }), t);
    expect(state.suppressions).toEqual([]);
    const live = unsubscribeApp({ db: {} as never }, { ...SANDBOX_ENV, INTEGRATIONS_MODE: "live", WORKER_HOST: "0.0.0.0", UNSUBSCRIBE_SECRET: "a-real-unsubscribe-secret-0123" }, { now: () => NOW });
    expect((await call(live, `/u/${token("ada@example.test", COMPANY, "a-real-unsubscribe-secret-0123")}`, oneClick, undefined, "https://worker.north.example")).status).toBe(200);
    expect(state.suppressions).toHaveLength(1);
  });

  it("CMP-1: the route's limit, size check and headers stay under /u: other paths of the same server are untouched", async () => {
    const server = new Hono();
    server.get("/health", (c) => c.json({ ok: true }));
    server.route("/", app);
    for (let i = 0; i < 70; i += 1) await call(server, "/u/garbage");
    expect((await call(server, "/u/garbage")).status).toBe(429);
    const health = await call(server, "/health", { headers: { "content-length": "4096" } });
    expect(health.status).toBe(200);
    expect(health.headers.get("x-robots-tag")).toBeNull();
    expect((await call(server, "/unrelated")).status).toBe(404);
    expect(await (await call(server, "/unrelated")).text()).not.toBe("Too many requests");
  });

  it("Review Focus 2: a valid token for a company that no longer exists (purged: the insert's foreign key fails) is the plain 404, not a retry", async () => {
    dbModule.addSuppression.mockRejectedValueOnce(Object.assign(new Error("Could not add suppression: violates foreign key constraint"), { cause: { code: "23503" } }));
    const t = token();
    await expectNotFound(await call(app, `/u/${t}`), t);
  });

  it("CMP-1: a storage failure answers 503 text/plain without the token, never a 500, and never claims the opt-out", async () => {
    dbModule.addSuppression.mockRejectedValueOnce(new Error("connection refused for ada@example.test"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const t = token();
    const response = await call(app, `/u/${t}`);
    expect(response.status).toBe(503);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).not.toMatch(/ada@example\.test|connection refused/);
    expect(String(warn.mock.calls[0]?.[0])).not.toContain(t);
    warn.mockRestore();
    const body = await response.text();
    expect(body).not.toContain(OPTED_OUT_TEXT);
    expect(body).not.toContain(t);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("unsubscribe route pieces (CMP-1)", () => {
  it("clientIpOf: the socket address unless the proxy is trusted; then Fly-Client-IP, then the first X-Forwarded-For entry; never a value that is not an IP", () => {
    const headers = new Headers({ "fly-client-ip": "198.51.100.7", "x-forwarded-for": "203.0.113.9, 10.0.0.1" });
    expect(clientIpOf(headers, "10.0.0.2", false)).toBe("10.0.0.2");
    expect(clientIpOf(headers, "10.0.0.2", true)).toBe("198.51.100.7");
    expect(clientIpOf(new Headers({ "x-forwarded-for": " 203.0.113.9 , 10.0.0.1" }), "10.0.0.2", true)).toBe("203.0.113.9");
    expect(clientIpOf(new Headers({ "fly-client-ip": "evil", "x-forwarded-for": "also-evil" }), "10.0.0.2", true)).toBe("10.0.0.2");
    expect(clientIpOf(new Headers(), "::ffff:10.0.0.2", false)).toBe("10.0.0.2");
    expect(clientIpOf(new Headers(), "2001:DB8::1", false)).toBe("2001:db8::1");
    expect(clientIpOf(new Headers(), undefined, false)).toBe("unknown");
  });

  it("TokenBucket: capacity per window per key, refilled evenly, with a bounded number of keys", () => {
    const bucket = new TokenBucket(60, 60_000);
    for (let i = 0; i < 60; i += 1) expect(bucket.take("a", 0)).toBe(true);
    expect(bucket.take("a", 0)).toBe(false);
    expect(bucket.take("b", 0)).toBe(true);
    expect(bucket.take("a", 999)).toBe(false);
    expect(bucket.take("a", 1000)).toBe(true);
    expect(bucket.take("a", 1000)).toBe(false);
    for (let i = 0; i < 60; i += 1) expect(bucket.take("a", 61_000)).toBe(true);
    const small = new TokenBucket(1, 60_000, 2);
    for (const key of ["a", "b", "c", "d"]) small.take(key, 0);
    expect(small.size).toBe(2);
  });
});
