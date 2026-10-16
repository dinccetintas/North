import { afterEach, describe, expect, it, vi } from "vitest";
import { sentryDsn } from "./env";
import { dropTransaction, scrubBreadcrumb, scrubEvent, SENTRY_PRIVACY_OPTIONS, stripQuery } from "./sentry-scrub";

const init = vi.hoisted(() => vi.fn());
vi.mock("@sentry/nextjs", () => ({ init }));

/** A server transaction as the SDK would build it for an OAuth callback: the code and state are in the URL, the spans and the trace context. */
const callbackTransaction = {
  type: "transaction" as const,
  transaction: "GET /api/connections/[provider]/callback",
  request: { url: "https://north.app/api/connections/github/callback?code=secret-code&state=s", query_string: "code=secret-code&state=s" },
  contexts: { trace: { trace_id: "t", span_id: "s", data: { "http.target": "/api/connections/github/callback?code=secret-code&state=s", "url.query": "?code=secret-code" } } },
  spans: [{ span_id: "a", trace_id: "t", start_timestamp: 1, description: "GET https://github.com/login/oauth/access_token?code=secret-code", data: { "url.full": "https://github.com/login/oauth/access_token?code=secret-code" } }],
};

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

  it("M6 review L7: no transaction is ever sent; tracing is off, so an incoming sampled sentry-trace cannot turn it on", () => {
    expect(dropTransaction(callbackTransaction)).toBeNull();
    expect(SENTRY_PRIVACY_OPTIONS.beforeSendTransaction(callbackTransaction)).toBeNull();
    // `tracesSampleRate: 0` is not enough: the SDK honours a parent's sampled decision over the rate (@sentry/core sampleSpan).
    expect("tracesSampleRate" in SENTRY_PRIVACY_OPTIONS).toBe(false);
    expect("tracesSampler" in SENTRY_PRIVACY_OPTIONS).toBe(false);
    expect(SENTRY_PRIVACY_OPTIONS.sendDefaultPii).toBe(false);
    expect(SENTRY_PRIVACY_OPTIONS.beforeSend({ message: "boom", user: { id: "u1" }, request: { url: "/c/a?x=1", method: "GET" } })).toEqual({ message: "boom", request: { url: "/c/a", method: "GET" } });
    expect(SENTRY_PRIVACY_OPTIONS.beforeBreadcrumb({ category: "ui.input", message: "x" })).toBeNull();
  });

  describe("both Sentry configs initialise with the privacy options and no tracing", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.resetModules();
      init.mockReset();
    });

    for (const file of ["server", "client"] as const) {
      it(`sentry.${file}.config.ts`, async () => {
        vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://abc@o1.ingest.sentry.io/123");
        vi.resetModules();
        await (file === "server" ? import("../../sentry.server.config") : import("../../sentry.client.config"));
        expect(init).toHaveBeenCalledTimes(1);
        const options = init.mock.calls[0]?.[0] as Record<string, unknown> & { beforeSendTransaction: (event: unknown) => unknown; beforeSend: (event: unknown) => unknown };
        expect(options).toMatchObject({ dsn: "https://abc@o1.ingest.sentry.io/123", sendDefaultPii: false });
        expect(Object.keys(options).filter((key) => /^traces/.test(key))).toEqual([]);
        expect(options.beforeSendTransaction(callbackTransaction)).toBeNull();
        expect(options.beforeSend({ user: { email: "founder@north.test" }, request: { url: "/x?code=1" } })).toEqual({ request: { url: "/x" } });
      });
    }

    it("stays off without a DSN", async () => {
      vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");
      await import("../../sentry.server.config");
      expect(init).not.toHaveBeenCalled();
    });
  });

  it("reads the public DSN only when it is an https URL", () => {
    expect(sentryDsn("https://abc@o1.ingest.sentry.io/123")).toBe("https://abc@o1.ingest.sentry.io/123");
    expect(sentryDsn("")).toBeNull();
    expect(sentryDsn(undefined)).toBeNull();
    expect(sentryDsn("http://abc@o1.ingest.sentry.io/123")).toBeNull();
    expect(sentryDsn("not a url")).toBeNull();
  });
});
