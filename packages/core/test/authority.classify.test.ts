import { describe, expect, it } from "vitest";
import { classify, ActionSpecSchema, K3_SINGLE_SPEND_USD, type ActionSpec } from "../src/authority/index";

const spec = (over: Partial<ActionSpec>): ActionSpec =>
  ActionSpecSchema.parse({ kind: "research", companyId: "c1", agentRole: "research", description: "x", ...over });

describe("DEC-1 classify(): spec rule table", () => {
  it("K0: research, drafts, artifacts, preview deploys do not touch the world or are reversible", () => {
    for (const kind of ["research", "draft", "artifact.write", "memory.write"] as const) {
      expect(classify(spec({ kind })).tier).toBe("K0");
    }
  });

  it("K1: external, reversible, no spend (preview deploy, repo push, templated support reply, pause ads)", () => {
    expect(classify(spec({ kind: "deploy.preview" })).tier).toBe("K1");
    expect(classify(spec({ kind: "repo.push" })).tier).toBe("K1");
    expect(classify(spec({ kind: "ads.pause" })).tier).toBe("K1");
    expect(classify(spec({ kind: "content.publish.approved" })).tier).toBe("K1");
    expect(classify(spec({ kind: "support.reply.template" })).tier).toBe("K1");
    expect(classify(spec({ kind: "email.send.reply" })).tier).toBe("K1");
  });

  it("K2: spending money, speaking in public, contacting a new person, going live", () => {
    expect(classify(spec({ kind: "ads.start", amountUsd: 10, category: "ads" }))).toMatchObject({ tier: "K2" });
    expect(classify(spec({ kind: "email.send.first_contact" })).tier).toBe("K2");
    expect(classify(spec({ kind: "deploy.production" })).tier).toBe("K2");
    expect(classify(spec({ kind: "price.change" })).tier).toBe("K2");
    expect(classify(spec({ kind: "social.publish" })).tier).toBe("K2");
    expect(classify(spec({ kind: "support.reply.custom" })).tier).toBe("K2");
  });

  it("K3: contracts, payment account changes, data deletion, domain transfer", () => {
    for (const kind of ["contract.sign", "payment_account.change", "data.delete", "domain.transfer"] as const) {
      expect(classify(spec({ kind })).tier).toBe("K3");
    }
  });

  it(`K3: any single spend above $${K3_SINGLE_SPEND_USD}`, () => {
    expect(classify(spec({ kind: "spend.oneoff", amountUsd: K3_SINGLE_SPEND_USD })).tier).toBe("K2");
    expect(classify(spec({ kind: "spend.oneoff", amountUsd: K3_SINGLE_SPEND_USD + 0.01 })).tier).toBe("K3");
    expect(classify(spec({ kind: "ads.start", amountUsd: 600 })).reasons).toContain("single_spend_over_limit");
  });

  it("an agent can raise a tier but never lower it", () => {
    expect(classify(spec({ kind: "research", requestedTier: "K2" })).tier).toBe("K2");
    expect(classify(spec({ kind: "deploy.production", requestedTier: "K0" })).tier).toBe("K2");
    expect(classify(spec({ kind: "contract.sign", requestedTier: "K1" })).tier).toBe("K3");
  });

  it("returns frozen, reason-bearing results", () => {
    const result = classify(spec({ kind: "ads.start", amountUsd: 5 }));
    expect(Object.isFrozen(result)).toBe(true);
    expect(result.reasons).toEqual(expect.arrayContaining(["spends_money", "public_statement"]));
  });

  it("rejects malformed specs at the boundary", () => {
    expect(() => ActionSpecSchema.parse({ kind: "nope", companyId: "c", agentRole: "r", description: "d" })).toThrow();
    expect(() => spec({ amountUsd: -1 })).toThrow();
  });
});
