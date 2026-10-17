import { describe, expect, it } from "vitest";
import { NotConfiguredError, ProviderError } from "../src/errors";
import type { FetchLike } from "../src/live/github";
import { META_GRAPH_API, MetaAds, creativeFromMarkdown, mapMetaStatus, metaScopes } from "../src/live/meta-ads";

interface Call {
  readonly method: string;
  readonly url: string;
  readonly path: string;
  readonly body: Record<string, unknown> | undefined;
  readonly auth: string | null;
}

/** Scripted fetch: answers by `METHOD path` and records every call. */
function scripted(routes: Record<string, (body: Record<string, unknown> | undefined, url: URL) => { status: number; json?: unknown }>) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const method = init?.method ?? "GET";
    const parsed = new URL(url);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    const headers = init?.headers as Record<string, string> | undefined;
    calls.push({ method, url, path: parsed.pathname, body, auth: headers?.authorization ?? null });
    const handler = routes[`${method} ${parsed.pathname}`];
    if (!handler) return new Response(JSON.stringify({ error: { message: `no route ${method} ${parsed.pathname}`, code: 100 } }), { status: 404 });
    const { status, json } = handler(body, parsed);
    return new Response(json === undefined ? null : JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
  };
  return { calls, fetchImpl };
}

const auth = { token: "EAAB-secret-token", scopes: ["act:123", "page:456"] };
const spec = {
  companyId: "c1",
  name: "Acme launch test",
  dailyBudgetUsd: 10.5,
  audience: "solo consultants",
  creativeMarkdown: "# The weekly work, done.\nYou keep the final say. CTA: Start free",
  targeting: { countries: ["US", "GB"], ageMin: 25, ageMax: 55 },
  landingUrl: "https://acme.example/launch",
};
const clock = () => new Date("2026-10-15T10:00:00.000Z");

describe("MetaAds live adapter (B4-4, BUD-2, GRW-K2)", () => {
  it("refuses without a connection or an ad account scope, and never echoes the token in errors", async () => {
    await expect(new MetaAds(null).status("c1", "1")).rejects.toBeInstanceOf(NotConfiguredError);
    await expect(new MetaAds({ token: "t" }).startCampaign(spec)).rejects.toThrow(/ad account/);
    const { fetchImpl } = scripted({ "POST /v26.0/act_123/campaigns": () => ({ status: 400, json: { error: { message: "Invalid parameter EAAB-secret-token", type: "OAuthException", code: 100 } } }) });
    const failure = new MetaAds(auth, fetchImpl).startCampaign(spec);
    await expect(failure).rejects.toBeInstanceOf(ProviderError);
    await expect(failure).rejects.toThrow(/400/);
    await expect(failure).rejects.not.toThrow(/EAAB-secret-token/);
  });

  it("metaScopes reads act:<id> and page:<id>; creativeFromMarkdown splits headline and body", () => {
    expect(metaScopes(auth)).toEqual({ adAccountId: "123", pageId: "456" });
    expect(metaScopes({ token: "t", scope: "act:9" })).toEqual({ adAccountId: "9", pageId: undefined });
    expect(() => metaScopes({ token: "t" })).toThrow(NotConfiguredError);
    expect(creativeFromMarkdown("# The weekly work, done.\nYou keep the final say.\n\n- CTA: Start free")).toEqual({ headline: "The weekly work, done.", body: "You keep the final say. CTA: Start free" });
    expect(creativeFromMarkdown("Plain first line\nSecond")).toEqual({ headline: "Plain first line", body: "Second" });
    expect(creativeFromMarkdown("")).toEqual({ headline: "Learn more", body: "" });
    expect(creativeFromMarkdown(`# ${"x".repeat(100)}`).headline).toHaveLength(80);
  });

  it("startCampaign: PAUSED campaign → ad set (daily_budget in cents, targeting) → creative from the markdown and landing URL → ad → campaign ACTIVE", async () => {
    const { calls, fetchImpl } = scripted({
      "POST /v26.0/act_123/campaigns": () => ({ status: 200, json: { id: "cmp_1" } }),
      "POST /v26.0/act_123/adsets": () => ({ status: 200, json: { id: "set_1" } }),
      "POST /v26.0/act_123/adcreatives": () => ({ status: 200, json: { id: "cre_1" } }),
      "POST /v26.0/act_123/ads": () => ({ status: 200, json: { id: "ad_1" } }),
      "POST /v26.0/cmp_1": () => ({ status: 200, json: { success: true } }),
    });
    const ads = new MetaAds(auth, fetchImpl, clock);
    await expect(ads.startCampaign(spec)).resolves.toEqual({ campaignId: "cmp_1", sandbox: false });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["POST /v26.0/act_123/campaigns", "POST /v26.0/act_123/adsets", "POST /v26.0/act_123/adcreatives", "POST /v26.0/act_123/ads", "POST /v26.0/cmp_1"]);
    expect(calls.every((c) => c.auth === "Bearer EAAB-secret-token")).toBe(true);
    expect(calls.every((c) => !c.url.includes("secret"))).toBe(true);
    expect(calls[0]?.body).toMatchObject({ name: "Acme launch test", objective: "OUTCOME_TRAFFIC", status: "PAUSED", special_ad_categories: [] });
    expect(calls[1]?.body).toMatchObject({
      campaign_id: "cmp_1",
      daily_budget: 1050,
      billing_event: "IMPRESSIONS",
      optimization_goal: "LINK_CLICKS",
      status: "ACTIVE",
      targeting: { geo_locations: { countries: ["US", "GB"] }, age_min: 25, age_max: 55 },
    });
    expect(calls[2]?.body).toMatchObject({
      object_story_spec: { page_id: "456", link_data: { link: "https://acme.example/launch", name: "The weekly work, done.", message: "You keep the final say. CTA: Start free", call_to_action: { type: "LEARN_MORE", value: { link: "https://acme.example/launch" } } } },
    });
    expect(calls[3]?.body).toMatchObject({ adset_id: "set_1", creative: { creative_id: "cre_1" }, status: "ACTIVE" });
    expect(calls[4]?.body).toEqual({ status: "ACTIVE" });
  });

  it("startCampaign refuses without a landing URL or a page, before any request", async () => {
    const { calls, fetchImpl } = scripted({});
    const ads = new MetaAds(auth, fetchImpl);
    await expect(ads.startCampaign({ ...spec, landingUrl: undefined })).rejects.toThrow(/landing/i);
    await expect(new MetaAds({ token: "t", scopes: ["act:123"] }, fetchImpl).startCampaign(spec)).rejects.toThrow(/page/i);
    await expect(new MetaAds({ token: "t", scopes: ["act:123"] }, fetchImpl).startCampaign({ ...spec, pageId: "789" })).rejects.toThrow(/no route/);
    expect(calls.filter((c) => c.path.endsWith("/adcreatives")).length).toBe(0);
    expect(calls.length).toBe(1);
  });

  it("insights parses lifetime spend, impressions, clicks and conversion actions; no rows → zeros", async () => {
    let rows: unknown[] = [{ spend: "4.20", impressions: "800", clicks: "12", actions: [{ action_type: "link_click", value: "12" }, { action_type: "lead", value: "1" }, { action_type: "complete_registration", value: "2" }] }];
    const { calls, fetchImpl } = scripted({ "GET /v26.0/cmp_1/insights": () => ({ status: 200, json: { data: rows } }) });
    const ads = new MetaAds(auth, fetchImpl, clock);
    expect(await ads.insights("c1", "cmp_1")).toEqual({ spendUsd: 4.2, impressions: 800, clicks: 12, conversions: 3, asOf: "2026-10-15T10:00:00.000Z", sandbox: false });
    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get("fields")).toBe("spend,impressions,clicks,actions");
    expect(url.searchParams.get("date_preset")).toBe("maximum");
    expect(url.searchParams.has("access_token")).toBe(false);
    rows = [];
    expect(await ads.insights("c1", "cmp_1")).toMatchObject({ spendUsd: 0, impressions: 0, clicks: 0, conversions: 0 });
  });

  it("pause and resume flip the status; pauseMany touches only the given ids and reports failures", async () => {
    const { calls, fetchImpl } = scripted({
      "POST /v26.0/cmp_1": () => ({ status: 200, json: { success: true } }),
      "POST /v26.0/cmp_2": () => ({ status: 200, json: { success: true } }),
      "POST /v26.0/cmp_bad": () => ({ status: 400, json: { error: { message: "Unsupported post request", code: 100 } } }),
    });
    const ads = new MetaAds(auth, fetchImpl);
    await ads.pauseCampaign("c1", "cmp_1");
    await ads.resumeCampaign("c1", "cmp_1");
    expect(calls.map((c) => c.body)).toEqual([{ status: "PAUSED" }, { status: "ACTIVE" }]);
    const result = await ads.pauseMany("c1", ["cmp_1", "cmp_2", "cmp_bad"]);
    expect(result.paused).toEqual(["cmp_1", "cmp_2"]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]).toMatchObject({ campaignId: "cmp_bad" });
    expect(result.failed[0]?.error).toMatch(/400/);
    expect(calls.slice(2).map((c) => c.path)).toEqual(["/v26.0/cmp_1", "/v26.0/cmp_2", "/v26.0/cmp_bad"]);
    expect(calls.slice(2).every((c) => c.body?.status === "PAUSED")).toBe(true);
    await expect(ads.pauseMany("c1", [])).resolves.toEqual({ paused: [], failed: [] });
  });

  it("status maps Meta's effective status onto active | paused | ended | unknown", async () => {
    const { fetchImpl } = scripted({
      "GET /v26.0/cmp_1": () => ({ status: 200, json: { id: "cmp_1", status: "ACTIVE", effective_status: "ACTIVE" } }),
      "GET /v26.0/cmp_2": () => ({ status: 200, json: { id: "cmp_2", status: "PAUSED", effective_status: "PAUSED" } }),
      "GET /v26.0/cmp_3": () => ({ status: 200, json: { id: "cmp_3", status: "ACTIVE", effective_status: "ARCHIVED" } }),
    });
    const ads = new MetaAds(auth, fetchImpl);
    expect(await ads.status("c1", "cmp_1")).toBe("active");
    expect(await ads.status("c1", "cmp_2")).toBe("paused");
    expect(await ads.status("c1", "cmp_3")).toBe("ended");
    await expect(ads.status("c1", "cmp_missing")).rejects.toBeInstanceOf(ProviderError);
    expect(mapMetaStatus("IN_PROCESS")).toBe("unknown");
    expect(mapMetaStatus("DELETED")).toBe("ended");
    expect(mapMetaStatus("CAMPAIGN_PAUSED")).toBe("paused");
    expect(mapMetaStatus(undefined)).toBe("unknown");
    expect(META_GRAPH_API).toBe("https://graph.facebook.com/v26.0");
  });
});
