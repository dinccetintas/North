// TST-5 / CMP-1: what the gate is told before it decides: fence targets from the spec and the connection, and the outreach facts.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActionSpecSchema, FencePolicySchema, gate, type ActionSpec, type FencePolicy } from "@north/core";
import { emptyState, fakeDbModule, fakeDeps, FAKE_SENDER_IDENTITY, seedCompany, type FakeState } from "./fake-db";

/**
 * TST-5 / CMP-1: what the gate is told before it decides. The pure part
 * (`fenceTargetsOf`) reads the outside targets from the spec and the
 * connection the adapter would run under; `fence.ts` looks the connection up
 * (live mode only, never the token) and reads the company's suppressions and
 * sender identity for the two email kinds.
 */

const state: FakeState = emptyState();
const dbModule = fakeDbModule(state);
vi.mock("@north/db", () => dbModule);

const { fenceTargetsOf } = await import("../src/services/fence-targets");
const { fenceCheckFor, fenceTargetsFor, outreachBlockReason, outreachContextFor } = await import("../src/services/fence");

const spec = (over: Partial<ActionSpec>): ActionSpec => ActionSpecSchema.parse({ kind: "research", companyId: "company-1", agentRole: "growth", description: "Act", ...over });
const ads = (kind: ActionSpec["kind"] = "ads.start"): ActionSpec => spec({ kind, amountUsd: 50, category: "ads", payload: { name: "Launch", dailyBudgetUsd: 10 } });
const mail = (payload: Record<string, unknown>, kind: ActionSpec["kind"] = "email.send.first_contact"): ActionSpec => spec({ kind, agentRole: "sales", payload });
const SANDBOX = { mode: "sandbox", connection: null } as const;
const LIVE_NONE = { mode: "live", connection: null } as const;
const live = (scopes: readonly string[], accountLabel = "") => ({ mode: "live", connection: { scopes, accountLabel } }) as const;
const fence = (over: Partial<FencePolicy> = {}): FencePolicy => FencePolicySchema.parse({ enabled: true, ...over });

beforeEach(() => {
  Object.assign(state, emptyState());
  dbModule.getConnection.mockReset();
  dbModule.readConnectionSecret.mockClear();
  dbModule.listSuppressed.mockClear();
  dbModule.getSenderIdentity.mockClear();
});

describe("TST-5 fenceTargetsOf: the outside targets of an action (pure)", () => {
  it("TST-5 deploy.* names its Vercel project from the payload, in both modes", () => {
    const deploy = spec({ kind: "deploy.preview", payload: { name: "site" } });
    expect(fenceTargetsOf(deploy, SANDBOX)).toEqual([{ kind: "vercel_project", name: "site" }]);
    expect(fenceTargetsOf(spec({ kind: "deploy.production", payload: { name: "e2e-site" } }), LIVE_NONE)).toEqual([{ kind: "vercel_project", name: "e2e-site" }]);
  });

  it("TST-5 an email names one recipient per normalised address: to, recipients, cc and bcc", () => {
    const send = mail({ batchId: "b1", to: "Ada <ADA@ok.io>", recipients: ["ada@ok.io", "bo@ok.io"], cc: "Cy <cy@ok.io>", bcc: ["dee@ok.io", "x@gmail.com; bo@ok.io"] });
    const expected = ["ada@ok.io", "bo@ok.io", "cy@ok.io", "dee@ok.io", "x@gmail.com"].map((email) => ({ kind: "recipient", email }));
    expect(fenceTargetsOf(send, SANDBOX)).toEqual(expected);
    expect(fenceTargetsOf(send, LIVE_NONE)).toEqual(expected);
    expect(fenceTargetsOf(mail({ to: "a@ok.io" }, "email.send.reply"), SANDBOX)).toEqual([{ kind: "recipient", email: "a@ok.io" }]);
  });

  it("TST-5 Meta: the connection's act:<id> scope becomes act_<id>, whichever form it was stored in; every act: scope counts", () => {
    expect(fenceTargetsOf(ads(), live(["act:123", "page:456"]))).toEqual([{ kind: "meta_ad_account", id: "act_123" }]);
    expect(fenceTargetsOf(ads("ads.resume"), live(["act:act_77"]))).toEqual([{ kind: "meta_ad_account", id: "act_77" }]);
    expect(fenceTargetsOf(ads("ads.resume"), live(["act:1", "act:2"]))).toEqual([
      { kind: "meta_ad_account", id: "act_1" },
      { kind: "meta_ad_account", id: "act_2" },
    ]);
  });

  it("TST-5 a kind whose only effect is to stop spend has no fence target, so a cap pause is never fenced", () => {
    expect(fenceTargetsOf(ads("ads.pause"), live(["act:999"]))).toEqual([]);
    expect(fenceTargetsOf(ads("ads.pause"), LIVE_NONE)).toEqual([]);
    expect(fenceTargetsOf(ads("ads.pause"), SANDBOX)).toEqual([]);
  });

  it("TST-5 GitHub: the connection's accountLabel is the owner; a push or pull request also names the owner of its fullName", () => {
    expect(fenceTargetsOf(spec({ kind: "repo.create", payload: { name: "site" } }), live(["repo"], "north-e2e"))).toEqual([{ kind: "github_owner", login: "north-e2e" }]);
    expect(fenceTargetsOf(spec({ kind: "repo.push", payload: { fullName: "someone-else/site" } }), live(["repo"], "north-e2e"))).toEqual([
      { kind: "github_owner", login: "north-e2e" },
      { kind: "github_owner", login: "someone-else" },
    ]);
    expect(fenceTargetsOf(spec({ kind: "repo.pull_request", payload: {} }), live(["repo"], "north-e2e"))).toEqual([{ kind: "unknown", action: "repo.pull_request" }]);
    expect(fenceTargetsOf(spec({ kind: "repo.push", payload: { fullName: "Owner/repo.name-1" } }), live(["repo"], "north-e2e"))).toEqual([
      { kind: "github_owner", login: "north-e2e" },
      { kind: "github_owner", login: "Owner" },
    ]);
  });

  it("TST-5 a fullName that could move the API path names no owner: the target is unknown", () => {
    for (const fullName of ["allowed/../victim/repo", "allowed/%2e%2e/victim/repo", "allowed/..", "allowed/repo/extra", " allowed/repo", 42]) {
      for (const kind of ["repo.push", "repo.pull_request"] as const) {
        expect(fenceTargetsOf(spec({ kind, payload: { fullName } }), live(["repo"], "allowed")), `${kind} ${String(fullName)}`).toEqual([{ kind: "unknown", action: kind }]);
      }
    }
  });

  it("TST-5 live mode without a usable connection: the target is unknown, never an empty list", () => {
    expect(fenceTargetsOf(ads(), LIVE_NONE)).toEqual([{ kind: "unknown", action: "ads.start" }]);
    expect(fenceTargetsOf(ads(), live(["page:456"]))).toEqual([{ kind: "unknown", action: "ads.start" }]);
    expect(fenceTargetsOf(spec({ kind: "repo.create" }), live(["repo"], "  "))).toEqual([{ kind: "unknown", action: "repo.create" }]);
    // A kind with no target reading yet (no adapter either) is unknown in live mode.
    expect(fenceTargetsOf(spec({ kind: "support.reply.template", payload: { to: "a@ok.io" } }), LIVE_NONE)).toEqual([{ kind: "unknown", action: "support.reply.template" }]);
  });

  it("TST-5 sandbox mode: a provider-derived target that does not exist is no target (no adapter reaches outside)", () => {
    expect(fenceTargetsOf(ads(), SANDBOX)).toEqual([]);
    expect(fenceTargetsOf(spec({ kind: "repo.push", payload: { fullName: "someone-else/site" } }), SANDBOX)).toEqual([]);
    expect(fenceTargetsOf(spec({ kind: "support.reply.template" }), SANDBOX)).toEqual([]);
  });

  it("TST-5 a payload-derived target that is missing is unknown in both modes", () => {
    for (const source of [SANDBOX, LIVE_NONE]) {
      expect(fenceTargetsOf(spec({ kind: "deploy.preview", payload: { name: "  " } }), source)).toEqual([{ kind: "unknown", action: "deploy.preview" }]);
      expect(fenceTargetsOf(spec({ kind: "deploy.preview" }), source)).toEqual([{ kind: "unknown", action: "deploy.preview" }]);
      expect(fenceTargetsOf(mail({ subject: "hi" }), source)).toEqual([{ kind: "unknown", action: "email.send.first_contact" }]);
    }
  });

  it("TST-5 internal kinds and North's own rows never get fence targets, in either mode", () => {
    for (const source of [SANDBOX, LIVE_NONE]) {
      for (const kind of ["research", "draft", "artifact.write", "memory.write", "signal.pursue", "budget.cap.raise"] as const) {
        expect(fenceTargetsOf(spec({ kind, category: "ads", amountUsd: 5, payload: { to: "x@gmail.com", name: "site" } }), source), kind).toEqual([]);
      }
    }
  });

  it("TST-5 returns frozen targets and leaves the spec and the connection as they were", () => {
    const send = mail({ to: "a@ok.io", cc: ["b@ok.io"] });
    const source = live(["act:1"]);
    const before = JSON.stringify({ send, source });
    const targets = fenceTargetsOf(send, source);
    expect(Object.isFrozen(targets)).toBe(true);
    expect(targets.every((t) => Object.isFrozen(t))).toBe(true);
    expect(JSON.stringify({ send, source })).toBe(before);
  });

  it("TST-5 core gate() blocks with test_fence on the same targets the worker reads, and passes the ones inside", () => {
    const ctx = (targets: ReturnType<typeof fenceTargetsOf>) => ({ killSwitchActive: false, budgets: [], autoRules: [], cardDueAt: "2026-10-18T00:00:00.000Z", fence: { policy: fence({ recipientDomains: ["resend.app"] }), targets } });
    const outside = mail({ to: "x@gmail.com" });
    expect(gate(outside, ctx(fenceTargetsOf(outside, SANDBOX)))).toMatchObject({ kind: "block" });
    expect(gate(outside, ctx(fenceTargetsOf(outside, SANDBOX))).reasons.at(-1)).toBe("test_fence");
    const inside = mail({ to: "x@mail.resend.app" });
    expect(gate(inside, ctx(fenceTargetsOf(inside, SANDBOX))).kind).toBe("card");
    expect(gate(ads(), ctx(fenceTargetsOf(ads(), LIVE_NONE))).reasons.at(-1)).toBe("test_fence");
  });
});

describe("TST-5 fenceTargetsFor / fenceCheckFor: the connection is read in live mode, never the token", () => {
  const connection = { id: "c-meta", provider: "meta_ads", status: "connected", scopes: ["act:123", "page:9"], accountLabel: "Test Ads" };

  it("TST-5 live mode reads the owner's connection scopes; the secret is never decrypted", async () => {
    seedCompany(state);
    dbModule.getConnection.mockImplementation(async (_db: unknown, userId: string, provider: string) => (userId === "user-1" && provider === "meta_ads" ? connection : null));
    const deps = fakeDeps(state, [], 200, "live");
    expect(await fenceTargetsFor(deps, "company-1", ads())).toEqual([{ kind: "meta_ad_account", id: "act_123" }]);
    expect(dbModule.readConnectionSecret).not.toHaveBeenCalled();
  });

  it("TST-5 a connection that is not usable (error, sandbox-scoped, absent) is an unknown target in live mode", async () => {
    seedCompany(state);
    const deps = fakeDeps(state, [], 200, "live");
    for (const row of [{ ...connection, status: "error" }, { ...connection, scopes: ["sandbox", "act:123"] }, null]) {
      dbModule.getConnection.mockImplementation(async () => row);
      expect(await fenceTargetsFor(deps, "company-1", ads())).toEqual([{ kind: "unknown", action: "ads.start" }]);
    }
  });

  it("TST-5 sandbox mode never looks a connection up", async () => {
    expect(await fenceTargetsFor(fakeDeps(state, []), "company-1", ads())).toEqual([]);
    expect(dbModule.getConnection).not.toHaveBeenCalled();
  });

  it("TST-5 fenceCheckFor is null with the fence off (nothing read), and otherwise carries the policy, the targets and the refusal", async () => {
    const off = fakeDeps(state, [], 200, "live");
    expect(await fenceCheckFor(off, "company-1", ads())).toBeNull();
    expect(dbModule.getConnection).not.toHaveBeenCalled();
    const on = { ...fakeDeps(state, []), fence: fence({ recipientDomains: ["resend.app"] }) };
    expect(await fenceCheckFor(on, "company-1", mail({ to: "x@mail.resend.app" }))).toEqual({ context: { policy: on.fence, targets: [{ kind: "recipient", email: "x@mail.resend.app" }] }, refusal: null });
    expect(await fenceCheckFor(on, "company-1", mail({ to: "x@gmail.com" }))).toMatchObject({ refusal: "recipient x@gmail.com is outside the test fence" });
  });
});

describe("CMP-1 outreachContextFor: suppressions and the sender identity, for the two email kinds only", () => {
  it("CMP-1 looks every address of the send up (to, list, cc, bcc) and reads the identity", async () => {
    state.suppressions.push({ companyId: "company-1", email: "blocked.io" });
    const deps = fakeDeps(state, []);
    const send = mail({ to: "a@ok.io", cc: "Bo <bo@blocked.io>", bcc: ["c@ok.io"] });
    expect(await outreachContextFor(deps, "company-1", send)).toEqual({ suppressed: ["bo@blocked.io"], senderIdentity: FAKE_SENDER_IDENTITY });
    expect(dbModule.listSuppressed).toHaveBeenCalledWith(deps.db, "company-1", ["a@ok.io", "bo@blocked.io", "c@ok.io"]);
    state.senderIdentities.set("company-1", null);
    expect(await outreachContextFor(deps, "company-1", mail({ to: "a@ok.io" }, "email.send.reply"))).toEqual({ suppressed: [], senderIdentity: null });
  });

  it("CMP-1 is undefined for every other kind, and reads nothing", async () => {
    const deps = fakeDeps(state, []);
    for (const kind of ["ads.start", "deploy.preview", "support.reply.template", "research"] as const) {
      expect(await outreachContextFor(deps, "company-1", spec({ kind, category: "ads", amountUsd: 5, payload: { to: "a@ok.io" } }))).toBeUndefined();
    }
    expect(dbModule.listSuppressed).not.toHaveBeenCalled();
    expect(dbModule.getSenderIdentity).not.toHaveBeenCalled();
  });

  it("CMP-1 outreachBlockReason names the address or the missing identity", () => {
    const send = mail({ to: "a@ok.io", cc: "bo@blocked.io" });
    expect(outreachBlockReason(send, { suppressed: ["bo@blocked.io"], senderIdentity: null }, "suppressed")).toBe("suppressed: bo@blocked.io");
    expect(outreachBlockReason(send, { suppressed: [], senderIdentity: null }, "no_sender_identity")).toBe("no_sender_identity: no sender identity");
  });
});
