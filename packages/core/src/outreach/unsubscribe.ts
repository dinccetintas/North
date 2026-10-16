// CMP-1: signed, stateless unsubscribe tokens: the link in an outreach email proves which company and address it opts out.
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { normaliseEmail } from "./policy";

/** What a token vouches for: this recipient, opting out of this company's mail. */
export interface UnsubscribeClaims {
  readonly companyId: string;
  readonly email: string;
}

/** The decoded token: company, normalised email, and the hex HMAC over both. No other key is allowed. */
const TokenBodySchema = z.strictObject({
  c: z.string().min(1),
  e: z.string().min(1),
  s: z.string().regex(/^[0-9a-f]{64}$/),
});

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** HMAC-SHA256 over the claims as a JSON pair, so no two (company, email) pairs share an input. */
function mac(secret: string, companyId: string, email: string): Buffer {
  return createHmac("sha256", secret).update(JSON.stringify([companyId, email])).digest();
}

/**
 * The URL-safe token for one recipient of one company: base64url of
 * `{"c": companyId, "e": email, "s": hmac}`, the email normalised first so
 * `Ada@Example.com` and `ada@example.com` give the same token.
 */
export function signUnsubscribeToken(claims: UnsubscribeClaims, secret: string): string {
  const email = normaliseEmail(claims.email);
  const body = { c: claims.companyId, e: email, s: mac(secret, claims.companyId, email).toString("hex") };
  return Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
}

/** The JSON inside a token, or null when it is not canonical base64url of valid JSON. */
function decode(token: string): unknown {
  if (!BASE64URL.test(token)) return null;
  const bytes = Buffer.from(token, "base64url");
  // Buffer decodes leniently; a token that does not re-encode to itself was altered or padded.
  if (bytes.toString("base64url") !== token) return null;
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * The claims a token vouches for, or null on any defect: not base64url, not
 * the expected shape, signed with another secret, or altered. The signature
 * is compared in constant time.
 */
export function verifyUnsubscribeToken(token: string, secret: string): UnsubscribeClaims | null {
  const parsed = TokenBodySchema.safeParse(decode(token));
  if (!parsed.success) return null;
  const { c, e, s } = parsed.data;
  const given = Buffer.from(s, "hex");
  const expected = mac(secret, c, e);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return Object.freeze({ companyId: c, email: e });
}
