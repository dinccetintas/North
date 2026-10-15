import { describe, expect, it } from "vitest";
import { sentryDsn } from "./env";
import { scrubBreadcrumb, scrubEvent, stripQuery } from "./sentry-scrub";

describe("OBS-1 web Sentry: no user data leaves the browser or the server", () => {
  it("drops the user, cookies, headers and body and keeps the path without its query", () => {
    const event = {
      message: "boom",
      user: { id: "u1", email: "founder@north.test", ip_address: "1.2.3.4" },
      request: { url: "https://north.app/api/connections/github/callback?code=secret&state=s", method: "GET", cookies: { sb: "token" }, headers: { authorization: "Bearer x" }, data: "{}" },
      tags: { route: "/c/[slug]" },
    };
    const scrubbed = scrubEvent(event);
    expect(scrubbed).toEqual({ message: "boom", tags: { route: "/c/[slug]" }, request: { url: "https://north.app/api/connections/github/callback", method: "GET" } });
    expect(event.user.email).toBe("founder@north.test");
  });

  it("removes typed input and strips queries from navigation and fetch breadcrumbs", () => {
    expect(scrubBreadcrumb({ category: "ui.input", message: "input[name=email]" })).toBeNull();
    expect(scrubBreadcrumb({ category: "navigation", data: { from: "/login?next=/c/a", to: "/companies?checkout=abc" } })).toEqual({ category: "navigation", data: { from: "/login", to: "/companies" } });
    expect(scrubBreadcrumb({ category: "fetch", data: { url: "/api/x?token=1", method: "POST", status_code: 200 } })).toEqual({ category: "fetch", data: { url: "/api/x", method: "POST", status_code: 200 } });
    expect(scrubBreadcrumb({ category: "console", message: "hello founder@north.test", data: { arguments: ["founder@north.test"] } })).toEqual({ category: "console", message: "[console]" });
  });

  it("strips the query and fragment of relative and absolute URLs", () => {
    expect(stripQuery("/a?b=1#c")).toBe("/a");
    expect(stripQuery("https://x.test/a?b=1")).toBe("https://x.test/a");
    expect(stripQuery(undefined)).toBeUndefined();
  });

  it("reads the public DSN only when it is an https URL", () => {
    expect(sentryDsn("https://abc@o1.ingest.sentry.io/123")).toBe("https://abc@o1.ingest.sentry.io/123");
    expect(sentryDsn("")).toBeNull();
    expect(sentryDsn(undefined)).toBeNull();
    expect(sentryDsn("http://abc@o1.ingest.sentry.io/123")).toBeNull();
    expect(sentryDsn("not a url")).toBeNull();
  });
});
