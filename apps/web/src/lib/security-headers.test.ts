import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import { SECURITY_HEADERS } from "./security-headers";

/**
 * Framing (reviewer's note to the M6 review): no other site may frame a North
 * page, so a decision card's approve button cannot be clickjacked; every
 * response also refuses MIME sniffing and keeps paths out of cross-site
 * referrers.
 */

type HeaderRule = { readonly source: string; readonly headers: readonly { readonly key: string; readonly value: string }[] };

describe("security headers on every web response", () => {
  it("forbids framing in both the CSP and the legacy header, refuses sniffing and trims the referrer", () => {
    expect(Object.fromEntries(SECURITY_HEADERS.map((h) => [h.key, h.value]))).toEqual({
      "Content-Security-Policy": "frame-ancestors 'none'",
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    });
  });

  it("next.config.ts sends them for every path and keeps the service worker's own headers", async () => {
    const rules = ((await nextConfig.headers?.()) ?? []) as readonly HeaderRule[];
    const all = rules.find((r) => r.source === "/:path*");
    expect(all?.headers).toEqual(SECURITY_HEADERS);
    const sw = rules.find((r) => r.source === "/sw.js");
    expect(sw?.headers).toEqual([
      { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
      { key: "Service-Worker-Allowed", value: "/" },
    ]);
    // No other rule sets a CSP or a frame option that could override the one for every path.
    for (const rule of rules.filter((r) => r !== all)) expect(rule.headers.map((h) => h.key.toLowerCase())).not.toEqual(expect.arrayContaining(["content-security-policy"]));
    for (const rule of rules.filter((r) => r !== all)) expect(rule.headers.map((h) => h.key.toLowerCase())).not.toContain("x-frame-options");
  });
});
