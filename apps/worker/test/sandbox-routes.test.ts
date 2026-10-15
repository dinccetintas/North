import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createSandboxIntegrations, type Integrations } from "@north/integrations";
import { sandboxRoutes } from "../src/sandbox-routes";

/**
 * D4-5 simulation routes: a delivery window and a reply can be reported to
 * the sandbox adapters through the worker's loopback server; bodies are
 * validated; unknown refs are 404; in live mode the routes do not exist.
 */

let integrations: ReturnType<typeof createSandboxIntegrations>;

const post = (app: ReturnType<typeof sandboxRoutes>, path: string, body?: string) => app.request(path, { method: "POST", headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body }) });

beforeEach(async () => {
  integrations = createSandboxIntegrations(undefined, { root: await mkdtemp(join(tmpdir(), "north-routes-")) });
});

describe("sandbox routes", () => {
  it("POST /sandbox/ads/:campaignId/deliver appends a delivery the insights then report; a bad body is 400, an unknown campaign 404", async () => {
    const app = sandboxRoutes(integrations);
    const { campaignId } = await integrations.ads(null).startCampaign({ companyId: "company-1", name: "Launch", dailyBudgetUsd: 10 });
    const ok = await post(app, `/sandbox/ads/${encodeURIComponent(campaignId)}/deliver`, JSON.stringify({ spendUsd: 4, impressions: 800, clicks: 12, conversions: 1 }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, delivery: { spendUsd: 4, impressions: 800, clicks: 12, conversions: 1 } });
    expect(await integrations.ads(null).insights("company-1", campaignId)).toMatchObject({ spendUsd: 4, clicks: 12, conversions: 1 });
    expect((await post(app, `/sandbox/ads/${encodeURIComponent(campaignId)}/deliver`, JSON.stringify({ spendUsd: -1 }))).status).toBe(400);
    expect((await post(app, `/sandbox/ads/${encodeURIComponent(campaignId)}/deliver`, "not json")).status).toBe(400);
    expect((await post(app, `/sandbox/ads/${encodeURIComponent(campaignId)}/deliver`)).status).toBe(400);
    expect((await post(app, "/sandbox/ads/sandbox:campaign:nope/deliver", JSON.stringify({ spendUsd: 1, impressions: 1, clicks: 1, conversions: 0 }))).status).toBe(404);
    expect((await post(app, "/sandbox/ads/..%2F..%2Fetc/deliver", JSON.stringify({ spendUsd: 1, impressions: 1, clicks: 1, conversions: 0 }))).status).toBe(400);
  });

  it("POST /sandbox/mail/:messageId/reply records a reply (optional { at }); unknown message 404, bad body 400", async () => {
    const app = sandboxRoutes(integrations);
    const { messageId } = await integrations.outreach(null).send({ companyId: "company-1", to: "a@example.test", subject: "Hi", text: "t", kind: "first_contact" });
    expect((await post(app, `/sandbox/mail/${encodeURIComponent(messageId)}/reply`)).status).toBe(200);
    const dated = await post(app, `/sandbox/mail/${encodeURIComponent(messageId)}/reply`, JSON.stringify({ at: "2026-10-15T10:00:00.000Z" }));
    expect(await dated.json()).toEqual({ ok: true, reply: { at: "2026-10-15T10:00:00.000Z" } });
    expect(await integrations.outreach(null).replies({ companyId: "company-1", messageIds: [messageId] })).toEqual([{ messageId, replies: 2, lastReplyAt: expect.any(String) }]);
    expect((await post(app, `/sandbox/mail/${encodeURIComponent(messageId)}/reply`, JSON.stringify({ at: "yesterday" }))).status).toBe(400);
    expect((await post(app, "/sandbox/mail/sandbox:msg:nope/reply")).status).toBe(404);
  });

  it("in live mode neither route exists (404): nothing can inject figures into a real ledger", async () => {
    const live = { ...integrations, mode: "live" } as unknown as Integrations;
    const app = sandboxRoutes(live);
    expect((await post(app, "/sandbox/ads/x/deliver", JSON.stringify({ spendUsd: 4, impressions: 1, clicks: 1, conversions: 0 }))).status).toBe(404);
    expect((await post(app, "/sandbox/mail/x/reply")).status).toBe(404);
  });
});
