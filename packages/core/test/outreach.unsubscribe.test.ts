// CMP-1: the signed link in every outreach email that opts a recipient out, for one company.
import { describe, expect, it } from "vitest";
import { signUnsubscribeToken, verifyUnsubscribeToken } from "../src/outreach/unsubscribe";

const SECRET = "test-secret-0123456789";
const claims = { companyId: "company-1", email: "ada@example.com" };

const decode = (token: string): Record<string, string> => JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as Record<string, string>;
const encode = (value: unknown): string => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");

describe("CMP-1 unsubscribe token", () => {
  it("round-trips the company and the email", () => {
    const token = signUnsubscribeToken(claims, SECRET);
    expect(verifyUnsubscribeToken(token, SECRET)).toEqual(claims);
  });

  it("is URL-safe", () => {
    expect(signUnsubscribeToken(claims, SECRET)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("verifies a token signed for Ada@Example.com as ada@example.com", () => {
    const token = signUnsubscribeToken({ companyId: "company-1", email: "Ada@Example.com" }, SECRET);
    expect(verifyUnsubscribeToken(token, SECRET)).toEqual(claims);
    expect(token).toBe(signUnsubscribeToken(claims, SECRET));
  });

  it("also normalises a display name before signing", () => {
    const token = signUnsubscribeToken({ companyId: "company-1", email: "Ada <Ada@Example.com>" }, SECRET);
    expect(verifyUnsubscribeToken(token, SECRET)).toEqual(claims);
  });

  it("rejects a tampered byte anywhere in the token", () => {
    const token = signUnsubscribeToken(claims, SECRET);
    for (let i = 0; i < token.length; i += 1) {
      const swapped = token[i] === "A" ? "B" : "A";
      expect(verifyUnsubscribeToken(token.slice(0, i) + swapped + token.slice(i + 1), SECRET)).toBeNull();
    }
  });

  it("rejects a token with something appended, cut short, or padded", () => {
    const token = signUnsubscribeToken(claims, SECRET);
    expect(verifyUnsubscribeToken(`${token}A`, SECRET)).toBeNull();
    expect(verifyUnsubscribeToken(token.slice(0, -1), SECRET)).toBeNull();
    expect(verifyUnsubscribeToken(`${token}=`, SECRET)).toBeNull();
  });

  it("rejects a non-canonical encoding that Buffer would decode to the same bytes", () => {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const token = signUnsubscribeToken(claims, SECRET);
    const bytes = Buffer.from(token, "base64url");
    // The last character carries unused bits: another one decodes to identical bytes.
    const twin = [...alphabet].map((ch) => token.slice(0, -1) + ch).find((other) => other !== token && Buffer.from(other, "base64url").equals(bytes));
    expect(twin).toBeDefined();
    expect(verifyUnsubscribeToken(twin ?? "", SECRET)).toBeNull();
    // A single dangling character after a whole number of groups is dropped by the decoder.
    const whole = signUnsubscribeToken({ companyId: "c", email: "a@b.io" }, SECRET);
    expect(whole.length % 4).toBe(0);
    expect(Buffer.from(`${whole}A`, "base64url").equals(Buffer.from(whole, "base64url"))).toBe(true);
    expect(verifyUnsubscribeToken(whole, SECRET)).toEqual({ companyId: "c", email: "a@b.io" });
    expect(verifyUnsubscribeToken(`${whole}A`, SECRET)).toBeNull();
  });

  it("rejects a token signed with another secret", () => {
    const token = signUnsubscribeToken(claims, SECRET);
    expect(verifyUnsubscribeToken(token, "another-secret-0123456789")).toBeNull();
  });

  it("rejects another company's or another recipient's claims carrying a copied signature", () => {
    const parts = decode(signUnsubscribeToken(claims, SECRET));
    expect(Object.keys(parts).sort()).toEqual(["c", "e", "s"]);
    expect(verifyUnsubscribeToken(encode({ ...parts, c: "company-2" }), SECRET)).toBeNull();
    expect(verifyUnsubscribeToken(encode({ ...parts, e: "victim@example.com" }), SECRET)).toBeNull();
  });

  it("does not confuse (company, email) pairs that concatenate to the same string", () => {
    const a = signUnsubscribeToken({ companyId: "a.b", email: "c@example.com" }, SECRET);
    const parts = decode(a);
    expect(verifyUnsubscribeToken(encode({ ...parts, c: "a", e: "b.c@example.com" }), SECRET)).toBeNull();
  });

  it("answers null, never throws, for anything that is not a token", () => {
    const parts = decode(signUnsubscribeToken(claims, SECRET));
    const junk = [
      "",
      "not a token",
      "!!!",
      "%00",
      "e30",
      encode(null),
      encode([]),
      encode("text"),
      encode({}),
      encode({ ...parts, s: "short" }),
      encode({ ...parts, s: "z".repeat(64) }),
      encode({ ...parts, s: parts.s?.toUpperCase() }),
      encode({ ...parts, extra: "x" }),
      encode({ c: 1, e: parts.e, s: parts.s }),
      encode({ c: "", e: parts.e, s: parts.s }),
      Buffer.from("not json", "utf8").toString("base64url"),
    ];
    for (const token of junk) expect(verifyUnsubscribeToken(token, SECRET)).toBeNull();
  });
});
