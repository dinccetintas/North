import { describe, expect, it } from "vitest";
import { isPublicPath } from "./public-paths";

describe("proxy public paths", () => {
  it("admits the public page, legal documents and PWA files without a session", () => {
    for (const path of ["/", "/login", "/p/acme", "/legal/terms", "/offline", "/manifest.webmanifest", "/sw.js", "/icons/icon-192.png"]) expect(isPublicPath(path)).toBe(true);
  });

  it("keeps every app screen behind the session", () => {
    for (const path of ["/companies", "/settings/billing", "/settings/export", "/c/acme", "/c/acme/public", "/new", "/offlinex", "/sw.js.map"]) expect(isPublicPath(path)).toBe(false);
  });
});
