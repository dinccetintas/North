/**
 * TST-3: the pure part of priming Vercel's bypass cookie outside the browser
 * (`bypass-cookie.ts`, used by `e2e/global-setup.ts`): which `Set-Cookie`
 * line is the staging host's `_vercel_jwt`, its expiry, and the Playwright
 * storage state it becomes. No network.
 */
import { describe, expect, it } from "vitest";
import { BYPASS_COOKIE, bypassCookieFrom, storageStateFor, storageStatePath } from "./bypass-cookie";

const HOST = "staging.north.example";
const NOW = new Date("2026-10-17T12:00:00.000Z");
const nowSeconds = Math.floor(NOW.getTime() / 1000);

describe("TST-3 bypassCookieFrom: the staging host's _vercel_jwt from the Set-Cookie lines", () => {
  it("TST-3 reads the cookie as a SameSite=None, secure cookie for the staging host on /", () => {
    const cookie = bypassCookieFrom(["other=1; Path=/", `${BYPASS_COOKIE}=eyJhbGciOi.payload.sig==; Path=/app; Max-Age=3600; Secure; HttpOnly; SameSite=None`], HOST, NOW);
    expect(cookie).toEqual({ name: "_vercel_jwt", value: "eyJhbGciOi.payload.sig==", domain: HOST, path: "/", expires: nowSeconds + 3600, httpOnly: true, secure: true, sameSite: "None" });
  });

  it("TST-3 answers null without the cookie", () => {
    expect(bypassCookieFrom([], HOST, NOW)).toBeNull();
    expect(bypassCookieFrom(["session=abc; Path=/", "_vercel_jwt_other=x"], HOST, NOW)).toBeNull();
    expect(bypassCookieFrom([`${BYPASS_COOKIE}=; Path=/`], HOST, NOW)).toBeNull();
  });

  it("TST-3 refuses a cookie scoped to another domain, and accepts the host or a parent domain", () => {
    expect(bypassCookieFrom([`${BYPASS_COOKIE}=x; Domain=evil.example; Max-Age=60`], HOST, NOW)).toBeNull();
    expect(bypassCookieFrom([`${BYPASS_COOKIE}=x; Domain=north.example.evil.com; Max-Age=60`], HOST, NOW)).toBeNull();
    expect(bypassCookieFrom([`${BYPASS_COOKIE}=x; Domain=.north.example; Max-Age=60`], HOST, NOW)?.domain).toBe(HOST);
    expect(bypassCookieFrom([`${BYPASS_COOKIE}=x; Domain=Staging.North.Example; Max-Age=60`], HOST, NOW)?.domain).toBe(HOST);
  });

  it("TST-3 takes the expiry from Max-Age (over Expires), else Expires, else one day", () => {
    const expires = "Sun, 18 Oct 2026 12:00:00 GMT";
    expect(bypassCookieFrom([`${BYPASS_COOKIE}=x; Expires=${expires}`], HOST, NOW)?.expires).toBe(Math.floor(Date.parse(expires) / 1000));
    expect(bypassCookieFrom([`${BYPASS_COOKIE}=x; Expires=${expires}; Max-Age=120`], HOST, NOW)?.expires).toBe(nowSeconds + 120);
    expect(bypassCookieFrom([`${BYPASS_COOKIE}=x`], HOST, NOW)?.expires).toBe(nowSeconds + 86_400);
  });

  it("TST-3 answers null for a cookie that is already expired", () => {
    expect(bypassCookieFrom([`${BYPASS_COOKIE}=x; Max-Age=0`], HOST, NOW)).toBeNull();
    expect(bypassCookieFrom([`${BYPASS_COOKIE}=x; Expires=Thu, 01 Jan 2026 00:00:00 GMT`], HOST, NOW)).toBeNull();
  });

  it("TST-3 takes the last _vercel_jwt line when there are several", () => {
    expect(bypassCookieFrom([`${BYPASS_COOKIE}=first; Max-Age=60`, `${BYPASS_COOKIE}=second; Max-Age=60`], HOST, NOW)?.value).toBe("second");
  });
});

describe("TST-3 storageStateFor and storageStatePath", () => {
  it("TST-3 wraps the cookie in a Playwright storage state with no origins", () => {
    const cookie = bypassCookieFrom([`${BYPASS_COOKIE}=x; Max-Age=60`], HOST, NOW);
    expect(cookie).not.toBeNull();
    if (cookie) expect(storageStateFor(cookie)).toEqual({ cookies: [cookie], origins: [] });
  });

  it("TST-3 keeps the file under the web app's git-ignored test-results", () => {
    expect(storageStatePath("/repo/apps/web")).toBe("/repo/apps/web/test-results/staging-storage-state.json");
  });
});
