import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SandboxEvent } from "@north/integrations";
import { emptyState, fakeDbModule, fakeDeps, seedTask, type FakeState } from "./fake-db";

/**
 * M3 security review H2: the live token path end to end. `performAction` must
 * hand the adapters exactly the auth they expect (GitHub: token only; Vercel:
 * token plus the team id from the `team:` scope, never the account label) and
 * the pipeline must learn the repository's full name from the provider, not
 * from a URL. Sandbox-scoped or secret-less rows count as not connected.
 */

const state: FakeState = emptyState();
const dbModule = fakeDbModule(state);
vi.mock("@north/db", () => dbModule);

const { performAction } = await import("../src/services/actions");
const { providerAuthFor, ConnectionRequiredError } = await import("../src/services/provider-auth");

const files = [{ path: "index.html", content: "<h1>Lumen</h1>" }];
let events: SandboxEvent[];

type Auth = { token: string; scope?: string } | null;

/** Live-mode deps whose adapters record the auth they were constructed with. */
function liveDeps(seen: { code: Auth[]; deploy: Auth[] }) {
  const deps = fakeDeps(state, events, 200, "live");
  const integrations = {
    ...deps.integrations,
    code: (auth: Auth) => {
      seen.code.push(auth);
      return deps.integrations.code(null);
    },
    deploy: (auth: Auth) => {
      seen.deploy.push(auth);
      return deps.integrations.deploy(null);
    },
  };
  return { ...deps, integrations } as typeof deps;
}

beforeEach(() => {
  Object.assign(state, emptyState());
  state.companies.set("company-1", { id: "company-1", slug: "lumen-ledger", name: "Lumen Ledger", ownerId: "user-1" });
  events = [];
  dbModule.getConnection.mockReset();
  dbModule.readConnectionSecret.mockReset();
  dbModule.setConnectionStatus.mockReset();
});

describe("providerAuthFor (ADR 0008, live mode)", () => {
  it("GitHub gets the token alone; Vercel gets the team id from the team: scope and never the label", async () => {
    dbModule.getConnection.mockImplementation(async (_db: unknown, _user: string, provider: string) => ({ id: `c-${provider}`, status: "connected", scopes: provider === "vercel" ? ["deployments", "team:team_abc"] : ["repo"], accountLabel: "octocat (team_abc)" }));
    dbModule.readConnectionSecret.mockImplementation(async (_db: unknown, id: string) => `token-for-${id}`);
    const deps = fakeDeps(state, events, 200, "live");
    expect(await providerAuthFor(deps, "company-1", "repo.create")).toEqual({ token: "token-for-c-github" });
    expect(await providerAuthFor(deps, "company-1", "repo.push")).toEqual({ token: "token-for-c-github" });
    expect(await providerAuthFor(deps, "company-1", "deploy.preview")).toEqual({ token: "token-for-c-vercel", scope: "team_abc" });
    expect(await providerAuthFor(deps, "company-1", "ads.start")).toBeNull();
    expect(await providerAuthFor(fakeDeps(state, events), "company-1", "repo.create")).toBeNull();
  });

  it("a sandbox-scoped row, a revoked row, a missing row or an unreadable secret all mean 'connect first'", async () => {
    const deps = fakeDeps(state, events, 200, "live");
    dbModule.getConnection.mockResolvedValueOnce(null);
    await expect(providerAuthFor(deps, "company-1", "repo.create")).rejects.toBeInstanceOf(ConnectionRequiredError);
    dbModule.getConnection.mockResolvedValueOnce({ id: "c1", status: "revoked", scopes: ["repo"], accountLabel: "" });
    await expect(providerAuthFor(deps, "company-1", "repo.create")).rejects.toBeInstanceOf(ConnectionRequiredError);
    dbModule.getConnection.mockResolvedValueOnce({ id: "c1", status: "connected", scopes: ["sandbox"], accountLabel: "sandbox" });
    await expect(providerAuthFor(deps, "company-1", "deploy.production")).rejects.toBeInstanceOf(ConnectionRequiredError);
    dbModule.getConnection.mockResolvedValueOnce({ id: "c1", status: "connected", scopes: ["repo"], accountLabel: "octocat" });
    dbModule.readConnectionSecret.mockRejectedValueOnce(new Error("No secret stored"));
    await expect(providerAuthFor(deps, "company-1", "repo.create")).rejects.toBeInstanceOf(ConnectionRequiredError);
    expect(dbModule.setConnectionStatus).toHaveBeenCalledWith(expect.anything(), "c1", "error");
  });
});

describe("performAction in live mode", () => {
  it("passes the resolved auth to the code and deploy adapters and reports the repository's full name", async () => {
    dbModule.getConnection.mockImplementation(async (_db: unknown, _user: string, provider: string) => ({ id: `c-${provider}`, status: "connected", scopes: provider === "vercel" ? ["team:team_abc"] : ["repo"], accountLabel: "octocat" }));
    dbModule.readConnectionSecret.mockImplementation(async (_db: unknown, id: string) => `token-for-${id}`);
    const seen = { code: [] as Auth[], deploy: [] as Auth[] };
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
});
