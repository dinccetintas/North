import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SandboxEvent } from "@north/integrations";
import { emptyState, fakeDbModule, fakeDeps, seedTask, type FakeState } from "./fake-db";

/**
 * M3 security review H2 and ADR 0010: the live token path end to end.
 * `performAction` must hand the adapters exactly the auth they expect
 * (GitHub: token only; Vercel: token plus the team id from the `team:` scope;
 * Meta: token plus the connection's `act:`/`page:` scopes; Gmail: token plus
 * the mailbox label) and never the account label as a scope. Sandbox-scoped
 * or secret-less rows count as not connected; a Google token near expiry is
 * refreshed once and re-stored.
 */

const state: FakeState = emptyState();
const dbModule = fakeDbModule(state);
vi.mock("@north/db", () => dbModule);

const { performAction } = await import("../src/services/perform");
const { providerAuthFor, readProviderToken, ConnectionRequiredError } = await import("../src/services/provider-auth");

const files = [{ path: "index.html", content: "<h1>Lumen</h1>" }];
let events: SandboxEvent[];

type Auth = { token: string; scope?: string; scopes?: readonly string[]; account?: string } | null;
type Seen = { code: Auth[]; deploy: Auth[]; ads: Auth[]; outreach: Auth[] };

/** Live-mode deps whose adapters record the auth they were constructed with. */
function liveDeps(seen: Seen) {
  const deps = fakeDeps(state, events, 200, "live");
  const record = <T>(bucket: Auth[], make: () => T) => (auth: Auth) => {
    bucket.push(auth);
    return make();
  };
  const integrations = {
    ...deps.integrations,
    code: record(seen.code, () => deps.integrations.code(null)),
    deploy: record(seen.deploy, () => deps.integrations.deploy(null)),
    ads: record(seen.ads, () => deps.integrations.ads(null)),
    outreach: record(seen.outreach, () => deps.integrations.outreach(null)),
  };
  return { ...deps, integrations } as typeof deps;
}

const connectionFor = (provider: string) => ({
  id: `c-${provider}`,
  provider,
  status: "connected",
  scopes: provider === "vercel" ? ["deployments", "team:team_abc"] : provider === "meta_ads" ? ["act:123", "page:456"] : provider === "gmail" ? [] : ["repo"],
  accountLabel: provider === "gmail" ? "ceo@example.test" : "octocat (team_abc)",
});

beforeEach(() => {
  Object.assign(state, emptyState());
  state.companies.set("company-1", { id: "company-1", slug: "lumen-ledger", name: "Lumen Ledger", ownerId: "user-1" });
  state.budgets.set("company-1", [{ category: "ads", totalLimitUsd: 300, dailyLimitUsd: 20, spentTotalUsd: 0, spentTodayUsd: 0 }]);
  events = [];
  dbModule.getConnection.mockReset();
  dbModule.readConnectionSecret.mockReset();
  dbModule.setConnectionStatus.mockReset();
  dbModule.storeConnectionSecret.mockClear();
});

describe("providerAuthFor (ADR 0008 / ADR 0010, live mode)", () => {
  it("GitHub gets the token alone; Vercel the team: scope; Meta its act:/page: scopes; Gmail the mailbox label; sandbox mode needs nothing", async () => {
    dbModule.getConnection.mockImplementation(async (_db: unknown, _user: string, provider: string) => connectionFor(provider));
    dbModule.readConnectionSecret.mockImplementation(async (_db: unknown, id: string) => `token-for-${id}`);
    const deps = fakeDeps(state, events, 200, "live");
    expect(await providerAuthFor(deps, "company-1", "repo.create")).toEqual({ token: "token-for-c-github" });
    expect(await providerAuthFor(deps, "company-1", "deploy.preview")).toEqual({ token: "token-for-c-vercel", scope: "team_abc" });
    expect(await providerAuthFor(deps, "company-1", "ads.start")).toEqual({ token: "token-for-c-meta_ads", scopes: ["act:123", "page:456"] });
    expect(await providerAuthFor(deps, "company-1", "ads.resume")).toEqual({ token: "token-for-c-meta_ads", scopes: ["act:123", "page:456"] });
    expect(await providerAuthFor(deps, "company-1", "email.send.first_contact")).toEqual({ token: "token-for-c-gmail", account: "ceo@example.test" });
    expect(await providerAuthFor(deps, "company-1", "budget.cap.raise")).toBeNull();
    expect(await providerAuthFor(fakeDeps(state, events), "company-1", "ads.start")).toBeNull();
  });

  it("a sandbox-scoped row, a revoked row, a missing row or an unreadable secret all mean 'connect first'", async () => {
    const deps = fakeDeps(state, events, 200, "live");
    dbModule.getConnection.mockResolvedValueOnce(null);
    await expect(providerAuthFor(deps, "company-1", "ads.start")).rejects.toBeInstanceOf(ConnectionRequiredError);
    dbModule.getConnection.mockResolvedValueOnce({ id: "c1", status: "revoked", scopes: ["repo"], accountLabel: "" });
    await expect(providerAuthFor(deps, "company-1", "repo.create")).rejects.toBeInstanceOf(ConnectionRequiredError);
    dbModule.getConnection.mockResolvedValueOnce({ id: "c1", status: "connected", scopes: ["sandbox"], accountLabel: "sandbox" });
    await expect(providerAuthFor(deps, "company-1", "email.send.first_contact")).rejects.toBeInstanceOf(ConnectionRequiredError);
    dbModule.getConnection.mockResolvedValueOnce({ id: "c1", status: "connected", scopes: ["repo"], accountLabel: "octocat" });
    dbModule.readConnectionSecret.mockRejectedValueOnce(new Error("No secret stored"));
    await expect(providerAuthFor(deps, "company-1", "repo.create")).rejects.toBeInstanceOf(ConnectionRequiredError);
    expect(dbModule.setConnectionStatus).toHaveBeenCalledWith(expect.anything(), "c1", "error");
  });

  it("ONB-3 / ADR 0010: a Google token within 60 s of expiry is refreshed once, re-stored under the same key, then read without a refresh; an unrefreshable one marks the row error", async () => {
    process.env.GOOGLE_CLIENT_ID = "gid";
    process.env.GOOGLE_CLIENT_SECRET = "gsecret";
    const now = () => new Date("2026-10-15T10:00:00.000Z");
    const expiring = JSON.stringify({ accessToken: "old-access", refreshToken: "refresh-1", expiresAt: "2026-10-15T10:00:30.000Z" });
    const calls: { url: string; body: string }[] = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push({ url, body: String(init?.body) });
      return new Response(JSON.stringify({ access_token: "new-access", expires_in: 3600 }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const deps = fakeDeps(state, events, 200, "live");
    const connection = { ...connectionFor("gmail"), createdAt: "", updatedAt: "" } as never;
    dbModule.readConnectionSecret.mockResolvedValueOnce(expiring);
    expect(await readProviderToken(deps, "gmail", connection, { fetchImpl, now })).toBe("new-access");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://oauth2.googleapis.com/token");
    expect(calls[0]?.body).toBe("client_id=gid&client_secret=gsecret&refresh_token=refresh-1&grant_type=refresh_token");
    expect(dbModule.storeConnectionSecret).toHaveBeenCalledTimes(1);
    const stored = JSON.parse(String(dbModule.storeConnectionSecret.mock.calls[0]?.[2]));
    expect(stored).toEqual({ accessToken: "new-access", refreshToken: "refresh-1", expiresAt: "2026-10-15T11:00:00.000Z" });
    // The re-stored token is fresh: the next read does not call Google again.
    dbModule.readConnectionSecret.mockResolvedValueOnce(JSON.stringify(stored));
    expect(await readProviderToken(deps, "gmail", connection, { fetchImpl, now })).toBe("new-access");
    expect(calls).toHaveLength(1);
    // Meta tokens cannot be refreshed; a malformed secret is unusable: both become "connect first" with the row marked error.
    dbModule.getConnection.mockResolvedValueOnce(connectionFor("meta_ads"));
    dbModule.readConnectionSecret.mockResolvedValueOnce(JSON.stringify({ accessToken: "meta", expiresAt: "2026-10-15T09:00:00.000Z" }));
    await expect(providerAuthFor(deps, "company-1", "ads.start", { fetchImpl, now })).rejects.toBeInstanceOf(ConnectionRequiredError);
    dbModule.getConnection.mockResolvedValueOnce(connectionFor("gmail"));
    dbModule.readConnectionSecret.mockResolvedValueOnce("{not json");
    await expect(providerAuthFor(deps, "company-1", "email.send.first_contact", { fetchImpl, now })).rejects.toBeInstanceOf(ConnectionRequiredError);
    expect(dbModule.setConnectionStatus).toHaveBeenCalledWith(expect.anything(), "c-meta_ads", "error");
    expect(dbModule.setConnectionStatus).toHaveBeenCalledWith(expect.anything(), "c-gmail", "error");
    expect(JSON.stringify(calls)).not.toContain("gsecret-leak");
  });
});

describe("performAction in live mode", () => {
  it("passes the resolved auth to the code and deploy adapters and reports the repository's full name", async () => {
    dbModule.getConnection.mockImplementation(async (_db: unknown, _user: string, provider: string) => connectionFor(provider));
    dbModule.readConnectionSecret.mockImplementation(async (_db: unknown, id: string) => `token-for-${id}`);
    const seen: Seen = { code: [], deploy: [], ads: [], outreach: [] };
    const deps = liveDeps(seen);
    seedTask(state, { role: "engineering", taskType: "build_site" });
    const base = { companyId: "company-1", agentRole: "engineering", description: "x" } as const;
    const repo = await performAction(deps, { ...base, kind: "repo.create", payload: { name: "lumen-site" } });
    expect(repo.meta).toEqual({ fullName: "sandbox/lumen-site" });
    await performAction(deps, { ...base, kind: "repo.push", payload: { fullName: repo.meta!.fullName!, message: "v1", files } });
    await performAction(deps, { ...base, kind: "deploy.preview", payload: { name: "lumen-site", files } });
    expect(seen.code).toEqual([{ token: "token-for-c-github" }, { token: "token-for-c-github" }]);
    expect(seen.deploy).toEqual([{ token: "token-for-c-vercel", scope: "team_abc" }]);
  });

  it("BUD-2 / GRW-K2 / SLS-K2: ads.start gets the Meta connection with its scopes and email.send.first_contact the Gmail connection with its mailbox", async () => {
    dbModule.getConnection.mockImplementation(async (_db: unknown, _user: string, provider: string) => connectionFor(provider));
    dbModule.readConnectionSecret.mockImplementation(async (_db: unknown, id: string) => `token-for-${id}`);
    const seen: Seen = { code: [], deploy: [], ads: [], outreach: [] };
    const deps = liveDeps(seen);
    const started = await performAction(deps, { kind: "ads.start", companyId: "company-1", agentRole: "growth", description: "Start", amountUsd: 50, category: "ads", payload: { name: "Launch", dailyBudgetUsd: 10, audience: "a", creativeMarkdown: "# Hi" } });
    expect(started.externalRef).toMatch(/^sandbox:campaign:/);
    await dbModule.importLeads(null, "company-1", [{ name: "Mara", email: "mara@example.test" }], "upload");
    const leadId = [...state.leads.values()].find((l) => l.email === "mara@example.test")!.id;
    const sent = await performAction(deps, { kind: "email.send.first_contact", companyId: "company-1", agentRole: "sales", description: "Hi", payload: { to: "mara@example.test", subject: "Hi", text: "Body", leadId } });
    expect(sent.externalRef).toMatch(/^sandbox:msg:/);
    expect(seen.ads).toEqual([{ token: "token-for-c-meta_ads", scopes: ["act:123", "page:456"] }]);
    expect(seen.outreach).toEqual([{ token: "token-for-c-gmail", account: "ceo@example.test" }]);
    // Without the Meta connection the start never reaches the adapter: the connect card mechanism takes over.
    dbModule.getConnection.mockResolvedValueOnce(null);
    await expect(performAction(deps, { kind: "ads.start", companyId: "company-1", agentRole: "growth", description: "Start", amountUsd: 50, category: "ads", payload: { dailyBudgetUsd: 10 } })).rejects.toBeInstanceOf(ConnectionRequiredError);
    expect(seen.ads).toHaveLength(1);
  });
});
