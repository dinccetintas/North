/**
 * Sent with every web response by `next.config.ts` (`headers()`, source
 * `/:path*`): no other site may frame a North page, so a decision card's
 * approve button cannot be clickjacked (`frame-ancestors` for current
 * browsers, `X-Frame-Options` for older ones); no MIME sniffing; and a
 * cross-site referrer carries the origin only, never a path or query. The CSP
 * names `frame-ancestors` alone: it restricts framing and nothing else.
 */
export const SECURITY_HEADERS: readonly { readonly key: string; readonly value: string }[] = Object.freeze([
  Object.freeze({ key: "Content-Security-Policy", value: "frame-ancestors 'none'" }),
  Object.freeze({ key: "X-Frame-Options", value: "DENY" }),
  Object.freeze({ key: "X-Content-Type-Options", value: "nosniff" }),
  Object.freeze({ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" }),
]);
