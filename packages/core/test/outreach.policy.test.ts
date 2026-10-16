// CMP-1: who an outreach email may be sent to, and under whose name.
import { describe, expect, it } from "vitest";
import { ActionSpecSchema, type ActionSpec } from "../src/authority/index";
import { SenderIdentitySchema, normaliseEmail, outreachRefusal, recipientsOf, type SenderIdentity } from "../src/outreach/policy";

const IDENTITY: SenderIdentity = { legalName: "North Studio Ltd", postalAddress: "1 Example Street, Springfield 12345" };

const spec = (over: Partial<ActionSpec>): ActionSpec =>
  ActionSpecSchema.parse({ kind: "research", companyId: "c1", agentRole: "sales", description: "Outreach", ...over });
const first = (payload: Record<string, unknown>): ActionSpec => spec({ kind: "email.send.first_contact", payload });
const reply = (payload: Record<string, unknown>): ActionSpec => spec({ kind: "email.send.reply", payload });
const batch = (recipients: string[]): ActionSpec => first({ batchId: "batch-1", to: recipients[0], recipients });
const research = (): ActionSpec => spec({ kind: "research" });

describe("CMP-1 outreach policy", () => {
  it("refuses a first contact to a suppressed address, case-insensitively, with a display name", () => {
    const s = first({ to: "Ada Lovelace <Ada@Example.com>" });
    expect(outreachRefusal(s, { suppressed: ["ada@example.com"], senderIdentity: IDENTITY })).toBe("suppressed");
  });

  it("refuses when any batch recipient's domain is suppressed", () => {
    const s = batch(["a@ok.io", "b@blocked.io"]);
    expect(outreachRefusal(s, { suppressed: ["blocked.io"], senderIdentity: IDENTITY })).toBe("suppressed");
  });

  it("refuses without a sender identity and allows with one", () => {
    expect(outreachRefusal(first({ to: "a@ok.io" }), { suppressed: [], senderIdentity: null })).toBe("no_sender_identity");
    expect(outreachRefusal(first({ to: "a@ok.io" }), { suppressed: [], senderIdentity: IDENTITY })).toBeNull();
  });

  it("ignores non-email kinds", () => {
    expect(outreachRefusal(research(), { suppressed: ["x"], senderIdentity: null })).toBeNull();
    expect(outreachRefusal(spec({ kind: "support.reply.template", payload: { to: "x" } }), { suppressed: ["x"], senderIdentity: null })).toBeNull();
  });

  it("refuses a reply to a suppressed address too, and a reply without a sender identity", () => {
    expect(outreachRefusal(reply({ to: "Ada@Example.com" }), { suppressed: ["ada@example.com"], senderIdentity: IDENTITY })).toBe("suppressed");
    expect(outreachRefusal(reply({ to: "a@ok.io" }), { suppressed: ["ada@example.com"], senderIdentity: IDENTITY })).toBeNull();
    expect(outreachRefusal(reply({ to: "a@ok.io" }), { suppressed: [], senderIdentity: null })).toBe("no_sender_identity");
  });

  it("normalises the suppressed list again, and an address only matches itself or its own domain", () => {
    const ctx = { suppressed: ["ADA@Example.com", "  Blocked.IO "], senderIdentity: IDENTITY };
    expect(outreachRefusal(first({ to: "ada@example.com" }), ctx)).toBe("suppressed");
    expect(outreachRefusal(first({ to: "x@blocked.io" }), ctx)).toBe("suppressed");
    expect(outreachRefusal(first({ to: "other@example.com" }), ctx)).toBeNull();
    expect(outreachRefusal(first({ to: "x@notblocked.io" }), ctx)).toBeNull();
  });

  it("checks a batch send's own `to` as well as the recipient list", () => {
    const s = first({ batchId: "batch-1", to: "b@blocked.io", recipients: ["a@ok.io"] });
    expect(outreachRefusal(s, { suppressed: ["blocked.io"], senderIdentity: IDENTITY })).toBe("suppressed");
  });

  it("names a suppressed recipient before a missing sender identity", () => {
    expect(outreachRefusal(first({ to: "a@ok.io" }), { suppressed: ["a@ok.io"], senderIdentity: null })).toBe("suppressed");
  });

  it("leaves an email with no recipient to the sender identity check alone", () => {
    expect(outreachRefusal(first({}), { suppressed: ["a@ok.io"], senderIdentity: IDENTITY })).toBeNull();
  });
});

describe("CMP-1 normaliseEmail", () => {
  it.each([
    ["Ada <Ada@Example.com>", "ada@example.com"],
    ["  ADA@EXAMPLE.COM  ", "ada@example.com"],
    ['"Lovelace, Ada" <Ada@Example.com>', "ada@example.com"],
    ["<Ada@Example.com>", "ada@example.com"],
    ["Blocked.IO", "blocked.io"],
    // The real address is the one in the last angle brackets, not one smuggled into the display name.
    ['"<victim@blocked.io>" <Ok@Ok.io>', "ok@ok.io"],
  ])("CMP-1 %j becomes %j", (input, expected) => {
    expect(normaliseEmail(input)).toBe(expected);
  });
});

describe("CMP-1 recipientsOf", () => {
  it("uses the batch recipient list when the payload carries one, normalised and frozen", () => {
    const list = recipientsOf(batch(["A@OK.io", "b@ok.io"]));
    expect(list).toEqual(["a@ok.io", "b@ok.io"]);
    expect(Object.isFrozen(list)).toBe(true);
  });

  it("falls back to payload.to, normalised, for a single send and for a reply", () => {
    expect(recipientsOf(first({ to: "Ada Lovelace <Ada@Example.com>" }))).toEqual(["ada@example.com"]);
    expect(recipientsOf(first({ batchId: "b1", to: "Ada@Example.com" }))).toEqual(["ada@example.com"]);
    expect(recipientsOf(reply({ to: "Ada@Example.com" }))).toEqual(["ada@example.com"]);
  });

  it("is empty without a usable `to`, and for every other kind", () => {
    expect(recipientsOf(first({}))).toEqual([]);
    expect(recipientsOf(first({ to: "   " }))).toEqual([]);
    expect(recipientsOf(first({ to: 42 }))).toEqual([]);
    expect(recipientsOf(spec({ kind: "email.send.first_contact" }))).toEqual([]);
    expect(recipientsOf(spec({ kind: "research", payload: { to: "a@ok.io" } }))).toEqual([]);
  });

  it("does not mutate the spec", () => {
    const s = batch(["A@OK.io"]);
    const snapshot = JSON.stringify(s);
    recipientsOf(s);
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});

describe("CMP-1 SenderIdentitySchema", () => {
  it("trims, and demands a name and a real-looking postal address", () => {
    expect(SenderIdentitySchema.parse({ legalName: "  North Ltd ", postalAddress: " 1 Example Street, Springfield " })).toEqual({ legalName: "North Ltd", postalAddress: "1 Example Street, Springfield" });
    expect(SenderIdentitySchema.safeParse({ legalName: "", postalAddress: "1 Example Street" }).success).toBe(false);
    expect(SenderIdentitySchema.safeParse({ legalName: "North", postalAddress: "short" }).success).toBe(false);
    expect(SenderIdentitySchema.safeParse({ legalName: "x".repeat(121), postalAddress: "1 Example Street" }).success).toBe(false);
    expect(SenderIdentitySchema.safeParse({ legalName: "North", postalAddress: "x".repeat(301) }).success).toBe(false);
  });
});
