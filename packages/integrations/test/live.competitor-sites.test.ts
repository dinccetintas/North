import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SignalCandidateSchema } from "@north/core";
import { competitorRefParts, competitorSourceRef, knownHashesFor } from "../src/competitor-ref";
import { COMPETITOR_MAX_BYTES, CompetitorSites, contentHash, pageTitle, readCapped, visibleText } from "../src/live/competitor-sites";
import type { FetchLike } from "../src/live/github";

interface Call {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

function scripted(respond: (url: string) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return respond(url);
  };
  return { calls, fetchImpl };
}

const html = (title: string, body: string) => new Response(`<html><head><title>${title}</title><script>alert(1)</script><style>p{}</style></head><body>${body}</body></html>`, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });

const warnings = () => {
  const lines: string[] = [];
  return { lines, warn: (line: string) => void lines.push(line) };
};

const allowAll = async () => true;
const CLOCK = new Date("2026-10-19T07:00:00.000Z");
const input = { companyId: "c1", queries: ["bookkeeping"], competitorUrls: ["https://incumbent-a.example/pricing"], since: "2026-10-12T07:00:00.000Z" };

describe("B5-3 live competitor sites (PRO-1): fetched under the verifier's host policy", () => {
  it("a URL the policy refuses is skipped with a warning and never fetched", async () => {
    const { calls, fetchImpl } = scripted(() => html("Pricing", "<p>hi</p>"));
    const { lines, warn } = warnings();
    const sites = new CompetitorSites({ fetchImpl, allowUrl: async (url) => !url.includes("10.0.0.1"), warn });
    const candidates = await sites.scan({ ...input, competitorUrls: ["http://10.0.0.1/admin", "https://incumbent-a.example/pricing"] });
    expect(calls.map((c) => c.url)).toEqual(["https://incumbent-a.example/pricing"]);
    expect(candidates).toHaveLength(1);
    expect(lines[0]).toMatch(/10\.0\.0\.1/);
    expect(lines[0]).toMatch(/skipped/);
  });

  it("GETs with redirect: manual, text/html accept and a timeout; a redirect is not followed and yields nothing", async () => {
    const { calls, fetchImpl } = scripted(() => new Response(null, { status: 302, headers: { location: "http://127.0.0.1:3101/" } }));
    const { lines, warn } = warnings();
    const sites = new CompetitorSites({ fetchImpl, allowUrl: allowAll, warn });
    expect(await sites.scan(input)).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init?.redirect).toBe("manual");
    expect((calls[0]?.init?.headers as Record<string, string>).accept).toMatch(/text\/html/);
    expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
    expect(lines[0]).toMatch(/redirect/);
  });

  it("only text/html bodies count; other content types and non-200 answers yield nothing", async () => {
    const { lines, warn } = warnings();
    const json = scripted(() => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
    expect(await new CompetitorSites({ fetchImpl: json.fetchImpl, allowUrl: allowAll, warn }).scan(input)).toEqual([]);
    const missing = scripted(() => new Response("gone", { status: 404, headers: { "content-type": "text/html" } }));
    expect(await new CompetitorSites({ fetchImpl: missing.fetchImpl, allowUrl: allowAll, warn }).scan(input)).toEqual([]);
    const failing: FetchLike = async () => {
      throw new Error("ETIMEDOUT");
    };
    expect(await new CompetitorSites({ fetchImpl: failing, allowUrl: allowAll, warn }).scan(input)).toEqual([]);
    expect(lines).toHaveLength(3);
  });

  it("an unknown page is a baseline candidate: title, first 400 characters of visible text, ref = url#hash, never scored", async () => {
    const body = `<nav>Home</nav><h1>Plans</h1><p>${"Review before anything goes live. ".repeat(30)}</p>`;
    const { fetchImpl } = scripted(() => html("Pricing &amp; plans", body));
    const sites = new CompetitorSites({ fetchImpl, allowUrl: allowAll, clock: () => CLOCK });
    const [candidate] = await sites.scan(input);
    expect(candidate?.baseline).toBe(true);
    expect(candidate?.source).toBe("competitor_sites");
    expect(candidate?.title).toBe("Baseline: Pricing & plans");
    expect(candidate?.url).toBe("https://incumbent-a.example/pricing");
    expect(candidate?.excerpt.length).toBe(400);
    expect(candidate?.excerpt).not.toMatch(/alert|<p>|<h1>/);
    expect(candidate?.observedAt).toBe(CLOCK.toISOString());
    const parts = competitorRefParts(candidate?.sourceRef ?? "");
    expect(parts?.url).toBe("https://incumbent-a.example/pricing");
    expect(parts?.hash).toHaveLength(40);
    expect(SignalCandidateSchema.safeParse(candidate).success).toBe(true);
  });

  it("a known hash for the URL means unchanged (nothing); a different one is a `changed` candidate", async () => {
    const first = scripted(() => html("Pricing", "<p>Starter $49</p>"));
    const sites = new CompetitorSites({ fetchImpl: first.fetchImpl, allowUrl: allowAll });
    const [baseline] = await sites.scan(input);
    expect(await sites.scan({ ...input, knownRefs: [baseline!.sourceRef] })).toEqual([]);

    const second = scripted(() => html("Pricing", "<p>Starter $49, Team $149</p>"));
    const changedSites = new CompetitorSites({ fetchImpl: second.fetchImpl, allowUrl: allowAll });
    const [changed] = await changedSites.scan({ ...input, knownRefs: [baseline!.sourceRef, "r-bookkeeping-1"] });
    expect(changed?.baseline).toBe(false);
    expect(changed?.title).toBe("Changed: Pricing");
    expect(changed?.sourceRef).not.toBe(baseline?.sourceRef);
    expect(competitorRefParts(changed?.sourceRef ?? "")?.url).toBe("https://incumbent-a.example/pricing");
  });

  it("reads at most 256 KB of a large body and hashes only that", async () => {
    const chunk = new TextEncoder().encode("a".repeat(64 * 1024));
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled > 40) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const text = await readCapped(new Response(stream, { status: 200 }), COMPETITOR_MAX_BYTES);
    expect(text.length).toBe(COMPETITOR_MAX_BYTES);
    expect(pulled).toBeLessThan(12);
    expect(await readCapped(new Response(null, { status: 200 }), 10)).toBe("");

    const big = scripted(() => new Response(`<title>Big</title>${"b".repeat(400 * 1024)}`, { status: 200, headers: { "content-type": "text/html" } }));
    const [candidate] = await new CompetitorSites({ fetchImpl: big.fetchImpl, allowUrl: allowAll }).scan(input);
    const capped = `<title>Big</title>${"b".repeat(400 * 1024)}`.slice(0, COMPETITOR_MAX_BYTES);
    expect(competitorRefParts(candidate!.sourceRef)?.hash).toBe(contentHash("Big", visibleText(capped)).slice(0, 40));
  });

  it("visibleText strips scripts, styles, comments and tags and decodes the common entities; pageTitle reads the title", () => {
    expect(visibleText("<p>Hello&nbsp;<b>there</b></p><script>x()</script><!-- c --><style>p{}</style> &amp; &lt;3")).toBe("Hello there & <3");
    expect(pageTitle("<html><head><title> Pricing \n plans </title></head></html>")).toBe("Pricing plans");
    expect(pageTitle("<html></html>")).toBeNull();
    expect(contentHash("t", "x")).toBe(createHash("sha256").update("t\nx").digest("hex"));
  });

  it("competitor refs: url#hash fits 200 characters even for long URLs, and known hashes are read per URL", () => {
    const long = `https://incumbent-a.example/${"p".repeat(300)}`;
    const ref = competitorSourceRef(long, "f".repeat(64));
    expect(ref.length).toBeLessThanOrEqual(200);
    expect(knownHashesFor(long, [ref, "r-x-1", "https://other.example/#abc"])).toEqual(["f".repeat(40)]);
    expect(competitorRefParts("no-hash")).toBeNull();
    expect(competitorRefParts("#abc")).toBeNull();
    expect(competitorRefParts("https://a.example/#")).toBeNull();
  });

  it("no competitor URLs means no request; the limit caps the candidates", async () => {
    const { calls, fetchImpl } = scripted(() => html("T", "<p>x</p>"));
    const sites = new CompetitorSites({ fetchImpl, allowUrl: allowAll });
    expect(await sites.scan({ ...input, competitorUrls: [] })).toEqual([]);
    expect(calls).toEqual([]);
    expect(await sites.scan({ ...input, competitorUrls: ["https://a.example/", "https://b.example/"], limit: 1 })).toHaveLength(1);
  });
});
