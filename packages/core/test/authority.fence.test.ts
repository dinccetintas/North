// TST-5: staging runs real adapters, but only against test accounts; anything else is fenced off.
import { describe, expect, it } from "vitest";
import type { ActionKind } from "../src/authority/action";
import { FencePolicySchema, FenceTargetSchema, fencePolicyFromEnv, fenceVerdict, isRepoFullName, isStripeTestKey, metaAdAccountId, type FencePolicy, type FenceTarget } from "../src/authority/fence";

const policy = (over: Partial<FencePolicy> = {}): FencePolicy => FencePolicySchema.parse({ enabled: true, ...over });

const meta = (id: string): FenceTarget => ({ kind: "meta_ad_account", id });
const owner = (login: string): FenceTarget => ({ kind: "github_owner", login });
const project = (name: string): FenceTarget => ({ kind: "vercel_project", name });
const recipient = (email: string): FenceTarget => ({ kind: "recipient", email });
const stripe = (prefix: string): FenceTarget => ({ kind: "stripe_key", prefix });
const unknown = (action: ActionKind): FenceTarget => ({ kind: "unknown", action });

describe("TST-5 test-account fence", () => {
  it("TST-5 a disabled fence allows anything", () => {
    const off = FencePolicySchema.parse({ enabled: false });
    expect(fenceVerdict([meta("act_999"), owner("anyone"), project("prod"), recipient("x@gmail.com"), stripe("sk_live_")], off)).toEqual({ allowed: true });
    expect(fenceVerdict([meta("act_999")], FencePolicySchema.parse({ enabled: false, metaAdAccounts: ["act_1"] }))).toEqual({ allowed: true });
  });

  it("TST-5 an enabled fence with empty lists blocks every target kind (default deny)", () => {
    const empty = policy();
    expect(empty).toMatchObject({ metaAdAccounts: [], githubOwners: [], recipientDomains: [] });
    for (const target of [meta("act_123"), owner("acme"), project("site"), recipient("x@mail.resend.app"), stripe("sk_live_")]) {
      expect(fenceVerdict([target], empty)).toMatchObject({ allowed: false });
    }
  });

  it("TST-5 a Meta ad account passes only when listed, and the reason names it", () => {
    const p = policy({ metaAdAccounts: ["act_123"] });
    expect(fenceVerdict([meta("act_123")], p)).toEqual({ allowed: true });
    expect(fenceVerdict([meta("act_999")], p)).toEqual({ allowed: false, reason: "meta_ad_account act_999 is outside the test fence" });
    expect(fenceVerdict([meta("123")], p)).toMatchObject({ allowed: false });
  });

  it("TST-5 a GitHub owner passes only when listed, ignoring case", () => {
    const p = policy({ githubOwners: ["north-e2e"] });
    expect(fenceVerdict([owner("north-e2e")], p)).toEqual({ allowed: true });
    expect(fenceVerdict([owner("North-E2E")], p)).toEqual({ allowed: true });
    expect(fenceVerdict([owner("acme")], p)).toEqual({ allowed: false, reason: "github_owner acme is outside the test fence" });
  });

  it("TST-5 a recipient passes by domain suffix: the domain itself or a subdomain, nothing that merely ends alike", () => {
    const p = policy({ recipientDomains: ["resend.app"] });
    expect(fenceVerdict([recipient("x@mail.resend.app")], p)).toEqual({ allowed: true });
    expect(fenceVerdict([recipient("x@resend.app")], p)).toEqual({ allowed: true });
    expect(fenceVerdict([recipient("Ada Lovelace <X@Mail.Resend.APP>")], p)).toEqual({ allowed: true });
    expect(fenceVerdict([recipient("x@gmail.com")], p)).toEqual({ allowed: false, reason: "recipient x@gmail.com is outside the test fence" });
    expect(fenceVerdict([recipient("x@notresend.app")], p)).toMatchObject({ allowed: false });
    expect(fenceVerdict([recipient("x@resend.app.evil.com")], p)).toMatchObject({ allowed: false });
    expect(fenceVerdict([recipient("resend.app")], p)).toMatchObject({ allowed: false });
    expect(fenceVerdict([recipient("x@")], p)).toMatchObject({ allowed: false });
  });

  // A fence must fail closed: a recipient that is not exactly one readable address could be anyone, so it is blocked.
  it("TST-5 a recipient that is not exactly one address is blocked, even when one part is a test address", () => {
    const p = policy({ recipientDomains: ["resend.app"] });
    for (const raw of [
      "real@gmail.com, test@resend.app",
      "test@resend.app, real@gmail.com",
      "test@resend.app; real@gmail.com",
      "test@resend.app, other@resend.app",
      "real@gmail.com test@resend.app",
      "Real <real@gmail.com>, Test <test@resend.app>",
      "<real@gmail.com><test@resend.app>",
      "real@gmail.com <test@resend.app>",
      "test@resend.app <real@gmail.com",
      "<real@gmail.com <test@resend.app>",
      'real" <test@resend.app>',
      '"real@gmail.com, test@resend.app',
      "",
      "   ",
      ",",
    ]) {
      expect(fenceVerdict([recipient(raw)], p)).toMatchObject({ allowed: false });
    }
  });

  it("TST-5 a single address still passes whatever surrounds it", () => {
    const p = policy({ recipientDomains: ["resend.app"] });
    for (const raw of ["Ada <test@resend.app>", '"Lovelace, Ada" <test@resend.app>', '"real@gmail.com" <test@resend.app>', " test@resend.app, ", "<TEST@Resend.App>"]) {
      expect(fenceVerdict([recipient(raw)], p)).toEqual({ allowed: true });
    }
  });

  it("TST-5 the reason for a recipient names the raw value, on one line and cut to 80 characters", () => {
    const p = policy({ recipientDomains: ["resend.app"] });
    expect(fenceVerdict([recipient("real@gmail.com, test@resend.app")], p)).toEqual({
      allowed: false,
      reason: "recipient real@gmail.com, test@resend.app is outside the test fence",
    });
    const long = fenceVerdict([recipient(`${"a".repeat(200)}@gmail.com`)], p);
    expect(long).toEqual({ allowed: false, reason: `recipient ${"a".repeat(80)} is outside the test fence` });
    const multiline = fenceVerdict([recipient("real@gmail.com,\n\ttest@resend.app")], p);
    expect(multiline).toEqual({ allowed: false, reason: "recipient real@gmail.com, test@resend.app is outside the test fence" });
  });

  it("TST-5 an empty domain entry never lets a malformed address through", () => {
    const p = policy({ recipientDomains: [""] });
    expect(fenceVerdict([recipient("x@")], p)).toMatchObject({ allowed: false });
    expect(fenceVerdict([recipient("x@gmail.com")], p)).toMatchObject({ allowed: false });
    // An empty entry would turn the subdomain test into "ends with a dot".
    expect(fenceVerdict([recipient("x@gmail.com.")], p)).toMatchObject({ allowed: false });
  });

  it("TST-5 a Vercel project passes by prefix, e2e- by default", () => {
    const p = policy();
    expect(fenceVerdict([project("e2e-site")], p)).toEqual({ allowed: true });
    expect(fenceVerdict([project("site")], p)).toEqual({ allowed: false, reason: "vercel_project site is outside the test fence" });
    expect(fenceVerdict([project("my-e2e-site")], p)).toMatchObject({ allowed: false });
    expect(fenceVerdict([project("ci-site")], policy({ vercelProjectPrefix: "ci-" }))).toEqual({ allowed: true });
  });

  it("TST-5 an empty Vercel prefix matches nothing instead of everything", () => {
    expect(fenceVerdict([project("e2e-site")], policy({ vercelProjectPrefix: "" }))).toMatchObject({ allowed: false });
  });

  it("TST-5 a Stripe key passes only as a test key, and a live key never reaches the reason", () => {
    const p = policy();
    expect(fenceVerdict([stripe("sk_test_")], p)).toEqual({ allowed: true });
    expect(fenceVerdict([stripe("sk_live_")], p)).toEqual({ allowed: false, reason: "stripe_key sk_live_ is outside the test fence" });
    expect(fenceVerdict([stripe("")], p)).toMatchObject({ allowed: false });
    const leaked = fenceVerdict([stripe("sk_live_51HxSECRETSECRETSECRET")], p);
    expect(leaked).toEqual({ allowed: false, reason: "stripe_key sk_live_ is outside the test fence" });
  });

  it("TST-5 every target must pass, and the first one that does not is named", () => {
    const p = policy({ metaAdAccounts: ["act_1"], recipientDomains: ["resend.app"] });
    expect(fenceVerdict([meta("act_1"), recipient("x@mail.resend.app"), project("e2e-a"), stripe("sk_test_")], p)).toEqual({ allowed: true });
    expect(fenceVerdict([meta("act_1"), recipient("x@gmail.com"), meta("act_9")], p)).toEqual({ allowed: false, reason: "recipient x@gmail.com is outside the test fence" });
  });

  it("TST-5 an enabled fence with nothing to check allows", () => {
    expect(fenceVerdict([], policy())).toEqual({ allowed: true });
  });

  it("TST-5 verdicts are frozen and the inputs are left alone", () => {
    const p = Object.freeze(policy({ metaAdAccounts: ["act_1"] }));
    const targets = Object.freeze([meta("act_9")]);
    const denied = fenceVerdict(targets, p);
    expect(Object.isFrozen(denied)).toBe(true);
    expect(Object.isFrozen(fenceVerdict([meta("act_1")], p))).toBe(true);
    expect(p.metaAdAccounts).toEqual(["act_1"]);
    expect(targets).toEqual([meta("act_9")]);
  });
});

describe("TST-5 fence schemas", () => {
  it("TST-5 FencePolicySchema fills the defaults and pins the Stripe test prefix", () => {
    expect(FencePolicySchema.parse({ enabled: true })).toEqual({
      enabled: true,
      metaAdAccounts: [],
      githubOwners: [],
      vercelProjectPrefix: "e2e-",
      recipientDomains: [],
      stripeKeyPrefix: "sk_test_",
    });
    expect(FencePolicySchema.safeParse({ enabled: true, stripeKeyPrefix: "sk_live_" }).success).toBe(false);
    expect(FencePolicySchema.safeParse({}).success).toBe(false);
  });

  it("TST-5 FenceTargetSchema accepts the five account kinds and an unknown target, and nothing else", () => {
    for (const target of [meta("act_1"), owner("acme"), project("e2e-x"), recipient("a@b.io"), stripe("sk_test_"), unknown("ads.start")]) {
      expect(FenceTargetSchema.parse(target)).toEqual(target);
    }
    expect(FenceTargetSchema.safeParse({ kind: "ssh_host", host: "prod" }).success).toBe(false);
    expect(FenceTargetSchema.safeParse({ kind: "meta_ad_account" }).success).toBe(false);
    expect(FenceTargetSchema.safeParse({ kind: "recipient", id: "a@b.io" }).success).toBe(false);
    expect(FenceTargetSchema.safeParse({ kind: "unknown", action: "not.a.kind" }).success).toBe(false);
  });

  it("TST-5 a target the caller could not determine is never inside an enabled fence, and the reason says so", () => {
    const wide = policy({ metaAdAccounts: ["act_1"], githubOwners: ["acme"], recipientDomains: ["resend.app"] });
    expect(fenceVerdict([unknown("ads.start")], wide)).toEqual({ allowed: false, reason: "unknown target for ads.start" });
    expect(fenceVerdict([meta("act_1"), unknown("repo.push")], wide)).toEqual({ allowed: false, reason: "unknown target for repo.push" });
    expect(fenceVerdict([unknown("ads.start")], FencePolicySchema.parse({ enabled: false }))).toEqual({ allowed: true });
  });
});

describe("TST-5 fencePolicyFromEnv", () => {
  it("TST-5 parses comma-separated lists, trimming and dropping empties", () => {
    const parsed = fencePolicyFromEnv({ NORTH_TEST_FENCE: "1", NORTH_FENCE_META_AD_ACCOUNTS: "act_1, act_2" });
    expect(parsed.enabled).toBe(true);
    expect(parsed.metaAdAccounts).toEqual(["act_1", "act_2"]);
    const messy = fencePolicyFromEnv({ NORTH_TEST_FENCE: "1", NORTH_FENCE_GITHUB_OWNERS: " a ,, b ,", NORTH_FENCE_RECIPIENT_DOMAINS: "resend.app,  ,example.test" });
    expect(messy.githubOwners).toEqual(["a", "b"]);
    expect(messy.recipientDomains).toEqual(["resend.app", "example.test"]);
  });

  it("TST-5 is enabled only when NORTH_TEST_FENCE is exactly 1", () => {
    for (const value of [undefined, "", "0", "true", "yes", " 1", "1 ", "11"]) {
      expect(fencePolicyFromEnv({ NORTH_TEST_FENCE: value }).enabled).toBe(false);
    }
    expect(fencePolicyFromEnv({ NORTH_TEST_FENCE: "1" }).enabled).toBe(true);
    expect(fencePolicyFromEnv({}).enabled).toBe(false);
  });

  it("TST-5 an empty environment is a disabled fence with the defaults", () => {
    expect(fencePolicyFromEnv({})).toEqual({
      enabled: false,
      metaAdAccounts: [],
      githubOwners: [],
      vercelProjectPrefix: "e2e-",
      recipientDomains: [],
      stripeKeyPrefix: "sk_test_",
    });
  });

  it("TST-5 reads the Vercel prefix, and a blank value keeps the default", () => {
    expect(fencePolicyFromEnv({ NORTH_FENCE_VERCEL_PREFIX: " ci- " }).vercelProjectPrefix).toBe("ci-");
    expect(fencePolicyFromEnv({ NORTH_FENCE_VERCEL_PREFIX: "   " }).vercelProjectPrefix).toBe("e2e-");
    expect(fencePolicyFromEnv({ NORTH_FENCE_VERCEL_PREFIX: "" }).vercelProjectPrefix).toBe("e2e-");
  });

  it("TST-5 an enabled env with no lists fences off every outside target", () => {
    const p = fencePolicyFromEnv({ NORTH_TEST_FENCE: "1" });
    expect(fenceVerdict([meta("act_1")], p)).toMatchObject({ allowed: false });
    expect(fenceVerdict([project("e2e-site")], p)).toEqual({ allowed: true });
  });

  it("TST-5 returns a frozen policy and does not touch the env object", () => {
    const env = Object.freeze({ NORTH_TEST_FENCE: "1", NORTH_FENCE_META_AD_ACCOUNTS: "act_1" });
    const parsed = fencePolicyFromEnv(env);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(env).toEqual({ NORTH_TEST_FENCE: "1", NORTH_FENCE_META_AD_ACCOUNTS: "act_1" });
  });
});

describe("TST-5 the identifiers the fence and the adapters share", () => {
  it("TST-5 metaAdAccountId makes 123 and act_123 the same id", () => {
    expect(metaAdAccountId("123")).toBe("act_123");
    expect(metaAdAccountId("act_123")).toBe("act_123");
    expect(metaAdAccountId(" act_9 ")).toBe("act_9");
  });

  it("TST-5 isStripeTestKey: a secret or restricted test key, nothing else", () => {
    for (const key of ["sk_test_x", "rk_test_51Abc"]) expect(isStripeTestKey(key), key).toBe(true);
    for (const key of ["sk_live_x", "rk_live_x", "pk_test_x", "", " sk_test_x", "SK_TEST_x", "sk_test"]) expect(isStripeTestKey(key), key).toBe(false);
  });

  it("TST-5 isRepoFullName accepts owner/repo as GitHub names them", () => {
    for (const name of ["Owner/repo.name-1", "sandbox/lumen-site", "a/b", "north-e2e/x_y", `${"o".repeat(39)}/${"r".repeat(100)}`]) expect(isRepoFullName(name), name).toBe(true);
  });

  it("TST-5 isRepoFullName refuses dot segments, encodings and anything that could move the API path", () => {
    for (const name of ["allowed/../victim/repo", "allowed/%2e%2e/victim/repo", "allowed/..", "allowed/.", "../victim", "owner/repo/extra", "owner", "/repo", "owner/", "own.er/repo", "own_er/repo", "owner/re po", "owner/repo%2f", "owner/repo?x=1", "owner/repo#x", `${"o".repeat(40)}/repo`, `owner/${"r".repeat(101)}`, "owner\\repo", ""]) {
      expect(isRepoFullName(name), name).toBe(false);
    }
  });
});
