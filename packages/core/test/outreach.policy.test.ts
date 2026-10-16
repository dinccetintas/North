// CMP-1: who an outreach email may be sent to, and under whose name.
import { describe, expect, it } from "vitest";
import { ActionSpecSchema, type ActionSpec } from "../src/authority/index";
import {
  SenderIdentitySchema,
  UNREADABLE_RECIPIENT,
  normaliseEmail,
  outreachRefusal,
  recipientsOf,
  singleAddress,
  type SenderIdentity,
} from "../src/outreach/policy";

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
    expect(outreachRefusal(first({ to: "   " }), { suppressed: ["a@ok.io"], senderIdentity: IDENTITY })).toBeNull();
    expect(outreachRefusal(first({ to: null }), { suppressed: ["a@ok.io"], senderIdentity: IDENTITY })).toBeNull();
    expect(outreachRefusal(first({}), { suppressed: [], senderIdentity: null })).toBe("no_sender_identity");
  });
});

// A compliance check must fail closed: a recipient it cannot read as one address is refused, never waved through.
describe("CMP-1 outreach policy fails closed on recipients it cannot read", () => {
  const ctx = { suppressed: ["b@blocked.io"], senderIdentity: IDENTITY };

  it("splits a string on commas and semicolons and checks every address, by exact address too", () => {
    expect(outreachRefusal(first({ to: "a@ok.io, b@blocked.io" }), ctx)).toBe("suppressed");
    expect(outreachRefusal(first({ to: "a@ok.io; B@Blocked.io" }), ctx)).toBe("suppressed");
    expect(outreachRefusal(first({ to: "Ada <a@ok.io>, Bo <B@Blocked.io>" }), ctx)).toBe("suppressed");
    expect(outreachRefusal(reply({ to: "a@ok.io, b@blocked.io" }), ctx)).toBe("suppressed");
    expect(outreachRefusal(first({ to: "a@ok.io, c@ok.io," }), ctx)).toBeNull();
  });

  it("does not split inside a quoted display name or angle brackets", () => {
    const comma = '"Lovelace, Ada" <ada@ok.io>';
    expect(outreachRefusal(first({ to: comma }), { suppressed: [], senderIdentity: IDENTITY })).toBeNull();
    expect(outreachRefusal(first({ to: comma }), { suppressed: ["ada@ok.io"], senderIdentity: IDENTITY })).toBe("suppressed");
    expect(outreachRefusal(first({ to: '"jane@corp.io" <jane@corp.io>' }), { suppressed: [], senderIdentity: IDENTITY })).toBeNull();
    expect(outreachRefusal(first({ to: '<ok@ok.io> "<b@blocked.io>"' }), { suppressed: ["b@blocked.io"], senderIdentity: IDENTITY })).toBeNull();
  });

  it("reads an array `to` as a list", () => {
    expect(outreachRefusal(first({ to: ["b@blocked.io"] }), ctx)).toBe("suppressed");
    expect(outreachRefusal(first({ to: ["a@ok.io", "Bo <b@blocked.io>"] }), ctx)).toBe("suppressed");
    expect(outreachRefusal(first({ to: ["a@ok.io", "x@ok.io, b@blocked.io"] }), ctx)).toBe("suppressed");
    expect(outreachRefusal(first({ to: ["a@ok.io", "c@ok.io"] }), ctx)).toBeNull();
  });

  it("reads a `recipients` list even without a batchId", () => {
    const s = first({ to: "a@ok.io", recipients: ["a@ok.io", "b@blocked.io"] });
    expect(outreachRefusal(s, { suppressed: ["blocked.io"], senderIdentity: IDENTITY })).toBe("suppressed");
    expect(outreachRefusal(first({ recipients: ["b@blocked.io"] }), ctx)).toBe("suppressed");
    expect(outreachRefusal(first({ recipients: "x@ok.io, b@blocked.io" }), ctx)).toBe("suppressed");
    expect(outreachRefusal(first({ recipients: ["a@ok.io"] }), ctx)).toBeNull();
  });

  it("keeps an unreadable entry of a recipient list instead of dropping it", () => {
    const s = first({ to: "a@ok.io", recipients: ["a@ok.io", "not an email"] });
    expect(outreachRefusal(s, { suppressed: [], senderIdentity: IDENTITY })).toBe("suppressed");
  });

  it.each([
    ["a number", 42],
    ["true", true],
    ["an object", { address: "a@ok.io" }],
    ["an array holding a number", ["a@ok.io", 7]],
    ["a nested array", [["b@blocked.io"]]],
    ["null inside a list", [null]],
  ])("CMP-1 refuses an unreadable `to`: %s", (_label, to) => {
    expect(outreachRefusal(first({ to }), { suppressed: [], senderIdentity: IDENTITY })).toBe("suppressed");
    expect(outreachRefusal(reply({ to }), { suppressed: [], senderIdentity: IDENTITY })).toBe("suppressed");
  });

  it.each([
    ["an unclosed quote hiding a second address", '"a@ok.io, victim@blocked.io'],
    ["an address in the unquoted display name", "victim@blocked.io <a@ok.io>"],
    ["two angle groups", "<a@ok.io><victim@blocked.io>"],
    ["a stray opening bracket", "a@ok.io <victim@blocked.io"],
    ["a stray closing bracket", "a@ok.io> victim@blocked.io"],
    ["an unclosed bracket before a real group", "<victim@blocked.io <a@ok.io>"],
    ["a stray closing bracket before a real group", "victim> <a@ok.io>"],
    ["a stray quote before a real group", 'victim" <a@ok.io>'],
    ["two addresses split by a space", "a@ok.io victim@blocked.io"],
    ["no @", "not an address"],
    ["two @", "a@@ok.io"],
    ["no local part", "@ok.io"],
    ["no domain", "a@"],
    ["empty brackets", "<>"],
    ["a comma inside the brackets", "<a@ok.io,victim@blocked.io>"],
    ["a quoted bare address", '"a@ok.io"'],
    ["text far too long to be an address list", "a@ok.io, ".repeat(1000)],
  ])("CMP-1 refuses a recipient string with %s", (_label, to) => {
    expect(outreachRefusal(first({ to }), { suppressed: [], senderIdentity: IDENTITY })).toBe("suppressed");
  });

  it("does not refuse well-formed addresses, with or without a display name", () => {
    for (const to of ["a@ok.io", "Ada Lovelace <a@ok.io>", '"Ada, L." <a@ok.io>', "<a@ok.io>", " A@OK.io ", "a@ok.io;"]) {
      expect(outreachRefusal(first({ to }), { suppressed: [], senderIdentity: IDENTITY })).toBeNull();
    }
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
    ['<Ok@Ok.io> "<victim@blocked.io>"', "ok@ok.io"],
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

  it("is empty when the payload names nobody", () => {
    expect(recipientsOf(first({}))).toEqual([]);
    expect(recipientsOf(first({ to: "   " }))).toEqual([]);
    expect(recipientsOf(first({ to: null }))).toEqual([]);
    expect(recipientsOf(spec({ kind: "email.send.first_contact" }))).toEqual([]);
    expect(recipientsOf(research())).toEqual([]);
  });

  it("splits strings and lists into one normalised entry per address", () => {
    expect(recipientsOf(first({ to: "A@ok.io, Bo <B@ok.io>; c@ok.io," }))).toEqual(["a@ok.io", "b@ok.io", "c@ok.io"]);
    expect(recipientsOf(first({ to: ["A@ok.io", "x@ok.io, Y@ok.io"] }))).toEqual(["a@ok.io", "x@ok.io", "y@ok.io"]);
    expect(recipientsOf(first({ recipients: ["A@ok.io", "b@ok.io"] }))).toEqual(["a@ok.io", "b@ok.io"]);
    // An empty list names nobody, so the send's own `to` stands.
    expect(recipientsOf(first({ to: "a@ok.io", recipients: [] }))).toEqual(["a@ok.io"]);
  });

  it("keeps a place for what it cannot read, so no consumer can overlook it", () => {
    expect(recipientsOf(first({ to: 42 }))).toEqual([UNREADABLE_RECIPIENT]);
    expect(recipientsOf(first({ to: ["a@ok.io", { x: 1 }] }))).toEqual(["a@ok.io", UNREADABLE_RECIPIENT]);
    expect(recipientsOf(first({ to: "a@ok.io victim@blocked.io" }))).toEqual([UNREADABLE_RECIPIENT]);
    expect(UNREADABLE_RECIPIENT).not.toContain("@");
  });

  it("does not depend on the kind: any spec carrying recipients or `to` returns them", () => {
    expect(recipientsOf(spec({ kind: "research", payload: { to: "a@ok.io" } }))).toEqual(["a@ok.io"]);
    expect(recipientsOf(spec({ kind: "support.reply.template", payload: { recipients: ["B@ok.io"] } }))).toEqual(["b@ok.io"]);
    expect(recipientsOf(spec({ kind: "draft", payload: { batchId: "b1", recipients: ["a@ok.io"] } }))).toEqual(["a@ok.io"]);
  });

  it("does not mutate the spec", () => {
    const s = batch(["A@OK.io"]);
    const snapshot = JSON.stringify(s);
    recipientsOf(s);
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});

describe("CMP-1 singleAddress", () => {
  it("returns the normalised address when the value is exactly one readable address", () => {
    expect(singleAddress("Ada Lovelace <Ada@Example.com>")).toBe("ada@example.com");
    expect(singleAddress(" A@OK.io ")).toBe("a@ok.io");
    expect(singleAddress('"Lovelace, Ada" <ada@ok.io>')).toBe("ada@ok.io");
    expect(singleAddress("a@ok.io,")).toBe("a@ok.io");
  });

  it("returns null for none, several, or anything it cannot read", () => {
    for (const value of ["", "   ", ",", "a@ok.io, b@ok.io", "a@ok.io; b@ok.io", "a@", "@ok.io", "ok.io", "x <y>", "a@ok.io <b@ok.io", '"a@ok.io, b@ok.io']) {
      expect(singleAddress(value)).toBeNull();
    }
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
