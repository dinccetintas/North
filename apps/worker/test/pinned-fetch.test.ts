import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createSandboxIntegrations, type Integrations } from "@north/integrations";
import { createPinnedFetch, HostRefusedError, isPrivateAddress, vetHost, withPinnedCompetitorFetch, type ResolvedAddress } from "../src/services/pinned-fetch";
import { verifyUrl } from "../src/services/verifier";

/**
 * D6-11 (M5 review L1): the verifier and the competitor fetch resolve a host
 * once, refuse a private address before any connection, and connect only to
 * the address they vetted, so a DNS answer that changes between the check and
 * the connection (rebinding) cannot point them at the inside.
 */

interface Seen {
  connections: number;
  hosts: string[];
}

const seen: Seen = { connections: 0, hosts: [] };
let server: Server;
let port = 0;

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res) => {
    seen.hosts.push(req.headers.host ?? "");
    if (req.url === "/redirect") {
      res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("hello from the vetted address");
  });
  server.on("connection", () => {
    seen.connections += 1;
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const reset = (): void => {
  seen.connections = 0;
  seen.hosts = [];
};

/** A resolver whose first answer is the local server and every later answer somewhere else (a rebinding DNS). */
function rebindingResolver(first: readonly ResolvedAddress[], later: readonly ResolvedAddress[]) {
  return vi.fn(async (_host: string) => (rebindingResolverCalls.count++ === 0 ? first : later));
}
const rebindingResolverCalls = { count: 0 };

describe("pinned fetch (D6-11)", () => {
  it("a host whose second resolution differs still connects to the first address", async () => {
    reset();
    rebindingResolverCalls.count = 0;
    const resolve = rebindingResolver([{ address: "127.0.0.1", family: 4 }], [{ address: "192.0.2.10", family: 4 }]);
    // `.invalid` never resolves (RFC 6761): a connection that looked the name up itself would fail.
    const pinned = createPinnedFetch({ resolve, allowPrivate: true });
    const response = await pinned(`http://rebind.invalid:${port}/page`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("hello from the vetted address");
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(seen.connections).toBe(1);
    // The request still names the host it asked for (virtual hosting, TLS SNI).
    expect(seen.hosts).toEqual([`rebind.invalid:${port}`]);
  });

  it("a private first resolution is refused before any connection", async () => {
    reset();
    const resolve = vi.fn(async () => [{ address: "10.0.0.5", family: 4 as const }]);
    const pinned = createPinnedFetch({ resolve });
    await expect(pinned(`http://intranet.example:${port}/`)).rejects.toBeInstanceOf(HostRefusedError);
    await expect(pinned(`http://intranet.example:${port}/`)).rejects.toThrow(/private/);
    // One public and one private answer is still private (any address counts).
    const mixed = createPinnedFetch({ resolve: async () => [{ address: "93.184.216.34", family: 4 }, { address: "169.254.169.254", family: 4 }] });
    await expect(mixed(`http://mixed.example:${port}/`)).rejects.toThrow(/private/);
    expect(seen.connections).toBe(0);
  });

  it("refuses private literals and local names without resolving, even when the server is reachable", async () => {
    reset();
    const resolve = vi.fn(async () => [{ address: "93.184.216.34", family: 4 as const }]);
    const pinned = createPinnedFetch({ resolve });
    for (const url of [`http://127.0.0.1:${port}/`, `http://[::1]:${port}/`, `http://localhost:${port}/`, `http://db.internal:${port}/`, `http://printer.local:${port}/`, `http://[::ffff:127.0.0.1]:${port}/`]) {
      await expect(pinned(url), url).rejects.toBeInstanceOf(HostRefusedError);
    }
    expect(resolve).not.toHaveBeenCalled();
    expect(seen.connections).toBe(0);
  });

  it("never follows a redirect, whatever the caller asked for", async () => {
    reset();
    const pinned = createPinnedFetch({ allowPrivate: true });
    const response = await pinned(`http://127.0.0.1:${port}/redirect`, { redirect: "follow" });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("http://169.254.169.254/latest/meta-data/");
    expect(seen.connections).toBe(1);
  });

  it("refuses non-http schemes and hosts that do not resolve", async () => {
    const pinned = createPinnedFetch({ resolve: async () => [] });
    await expect(pinned("file:///etc/passwd")).rejects.toThrow(/http/);
    await expect(pinned("http://nothing.example/")).rejects.toThrow(/does not resolve/);
    const failing = createPinnedFetch({
      resolve: async () => {
        throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
      },
    });
    await expect(failing("https://gone.example/")).rejects.toBeInstanceOf(HostRefusedError);
  });

  it("judges every IPv6 form that embeds an IPv4 address by that address (the URL parser writes ::ffff:127.0.0.1 as ::ffff:7f00:1)", () => {
    for (const [address, isPrivate] of [
      ["::ffff:7f00:1", true],
      ["::ffff:a00:1", true],
      ["::ffff:808:808", false],
      ["::ffff:8.8.8.8", false],
      ["64:ff9b::a9fe:a9fe", true],
      ["64:ff9b::808:808", false],
      ["::7f00:1", true],
      ["::", true],
      ["ff02::1", true],
      ["fec0::1", true],
      ["2001:db8::1", false],
      ["2606:4700:4700::1111", false],
    ] as const) {
      expect(isPrivateAddress(address), address).toBe(isPrivate);
    }
  });

  it("vetHost returns the one address the connection will use", async () => {
    expect(await vetHost("93.184.216.34")).toEqual({ address: "93.184.216.34", family: 4 });
    expect(await vetHost("[2606:4700::1]")).toEqual({ address: "2606:4700::1", family: 6 });
    const resolve = vi.fn(async () => [{ address: "93.184.216.34", family: 4 as const }, { address: "93.184.216.35", family: 4 as const }]);
    expect(await vetHost("example.com", { resolve })).toEqual({ address: "93.184.216.34", family: 4 });
    expect(resolve).toHaveBeenCalledTimes(1);
  });
});

describe("the verifier on the pinned fetch (AGT-2, D6-11)", () => {
  it("verifies the sandbox site through a real pinned connection and still never follows a redirect", async () => {
    reset();
    const sandbox = { allowedOrigins: [`http://127.0.0.1:${port}`], allowPrivate: true, timeoutMs: 2000 };
    expect(await verifyUrl(`http://127.0.0.1:${port}/sandbox/sites/x/`, sandbox)).toMatchObject({ verified: true, detail: "HTTP 200" });
    expect(await verifyUrl(`http://127.0.0.1:${port}/redirect`, sandbox)).toMatchObject({ verified: false, detail: expect.stringContaining("not followed") });
    expect(seen.connections).toBe(2);
  });

  it("the live policy refuses a private host before connecting", async () => {
    reset();
    const live = { timeoutMs: 2000, allowPrivate: false };
    expect((await verifyUrl(`http://127.0.0.1:${port}/`, live)).detail).toMatch(/private/);
    expect((await verifyUrl(`http://localhost:${port}/`, live)).detail).toMatch(/private/);
    expect(seen.connections).toBe(0);
  });
});

describe("withPinnedCompetitorFetch (deps wiring)", () => {
  const sandbox = createSandboxIntegrations(() => undefined, { root: "/tmp/north-test-pinned", siteBaseUrl: "http://127.0.0.1:3101" });

  it("leaves the sandbox adapters alone", () => {
    expect(withPinnedCompetitorFetch(sandbox, async () => true)).toBe(sandbox);
  });

  it("in live mode replaces only the competitor source, which then fetches through the pinned fetch", async () => {
    const competitor = { id: "competitor_sites" as const, scan: async () => [] };
    const reddit = { id: "reddit" as const, scan: async () => [] };
    const live: Integrations = { ...sandbox, mode: "live", signals: [reddit, competitor] };
    const calls: string[] = [];
    const fetchImpl = async (url: string) => {
      calls.push(url);
      return new Response("<html><title>Rival</title><body>Pricing</body></html>", { status: 200, headers: { "content-type": "text/html" } });
    };
    const pinned = withPinnedCompetitorFetch(live, async () => true, fetchImpl);
    expect(pinned.signals[0]).toBe(reddit);
    expect(pinned.signals[1]).not.toBe(competitor);
    expect(pinned.signals[1]?.id).toBe("competitor_sites");
    expect(Object.isFrozen(pinned)).toBe(true);
    await pinned.signals[1]?.scan({ companyId: "00000000-0000-4000-8000-000000000001", competitorUrls: ["https://rival.example/pricing"], since: "2026-10-01T00:00:00.000Z" });
    expect(calls).toEqual(["https://rival.example/pricing"]);
  });
});
