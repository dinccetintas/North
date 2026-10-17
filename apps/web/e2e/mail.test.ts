/**
 * TST-3: the magic-link reader (`mail.ts`) without a mail server: the pure
 * link extraction and newest-match pick, the provider switch, and both
 * branches against a fake `fetch` (Mailpit locally, Resend's receiving API on
 * staging). No network, no real key.
 */
import { describe, expect, it } from "vitest";
import { extractMagicLink, latestMagicLink, mailProviderOf, pickNewestFor, RESEND_POLL_MS, RESEND_TIMEOUT_MS, type MailDeps } from "./mail";

const EMAIL = "e2e-abc123-mobile@staging.north.example";
const KEY = "re_fake_key_never_printed_123";
const LINK = "https://ref.supabase.co/auth/v1/verify?token=tok123&type=magiclink&redirect_to=https://staging.north.example/auth/callback";

interface Call {
  readonly url: string;
  readonly auth: string | null;
}

/** A fake clock and fetch: `sleep` advances the clock; `answer` maps each URL to a JSON body (or a status). */
function fakeDeps(env: Record<string, string>, answer: (url: string, call: number) => { status?: number; body?: unknown }) {
  const calls: Call[] = [];
  let clock = 0;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, auth: headers.get("authorization") });
    const { status = 200, body = {} } = answer(url, calls.length);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const deps: MailDeps = {
    env,
    fetch: fetchImpl,
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
  };
  return { deps, calls, elapsed: () => clock };
}

const RESEND_ENV = { E2E_MAIL_PROVIDER: "resend", E2E_RESEND_KEY: KEY };
const LIST_URL = "https://api.resend.com/emails/receiving?limit=100";
const listOf = (...data: unknown[]) => ({ object: "list", has_more: false, data });
const summary = (id: string, to: string[], createdAt: string) => ({ id, to, from: "North <auth@staging.north.example>", created_at: createdAt, subject: "Your sign-in link", cc: [], bcc: [], reply_to: [], message_id: `<${id}@resend>`, attachments: [] });

describe("TST-3 extractMagicLink: the first sign-in URL, text first, then HTML", () => {
  it("TST-3 reads the link from the text body", () => {
    expect(extractMagicLink(`Sign in:\n${LINK}\n\nThanks`, null)).toBe(LINK);
  });

  it("TST-3 falls back to the HTML body and decodes &amp;", () => {
    const html = `<a href="${LINK.replace(/&/g, "&amp;")}">Sign in</a>`;
    expect(extractMagicLink("No link in this part.", html)).toBe(LINK);
    expect(extractMagicLink(undefined, html)).toBe(LINK);
  });

  it("TST-3 prefers the text body when both carry a link", () => {
    const other = "https://ref.supabase.co/auth/v1/verify?token=from-html";
    expect(extractMagicLink(LINK, `<a href="${other}">x</a>`)).toBe(LINK);
  });

  it("TST-3 ignores URLs without a token, token_hash or code parameter, and answers null without one", () => {
    expect(extractMagicLink("Visit https://staging.north.example/help today", "<a href='https://north.example'>x</a>")).toBeNull();
    expect(extractMagicLink(null, null)).toBeNull();
    expect(extractMagicLink("https://x.example/cb?code=abc", null)).toBe("https://x.example/cb?code=abc");
  });
});

describe("TST-3 pickNewestFor: the newest received mail addressed to the e2e user", () => {
  it("TST-3 matches the address in any case and in the Name <address> form", () => {
    const items = Object.freeze([summary("a", ["someone@else.example"], "2026-10-17T10:00:00Z"), summary("b", [`E2E User <${EMAIL.toUpperCase()}>`], "2026-10-17T09:00:00Z")]);
    expect(pickNewestFor(items, EMAIL)?.id).toBe("b");
  });

  it("TST-3 picks the newest match by created_at, also in Resend's space-separated form", () => {
    const items = [summary("old", [EMAIL], "2026-10-17 09:00:00.123456+00"), summary("new", [EMAIL], "2026-10-17 10:30:00.5+00"), summary("mid", [EMAIL], "2026-10-17T10:00:00.000Z")];
    expect(pickNewestFor(items, EMAIL)?.id).toBe("new");
  });

  it("TST-3 keeps the list's order (newest first) when the times tie or cannot be read", () => {
    const items = [summary("first", [EMAIL], "not a date"), summary("second", [EMAIL], "not a date either")];
    expect(pickNewestFor(items, EMAIL)?.id).toBe("first");
  });

  it("TST-3 answers null when no mail is addressed to the user, never a partial match, and leaves the input alone", () => {
    const items = Object.freeze([summary("x", [`x${EMAIL}`], "2026-10-17T10:00:00Z"), summary("y", [`${EMAIL}.evil.example`], "2026-10-17T10:00:00Z")]);
    expect(pickNewestFor(items, EMAIL)).toBeNull();
    expect(items.map((i) => i.id)).toEqual(["x", "y"]);
  });
});

describe("TST-3 mailProviderOf: E2E_MAIL_PROVIDER, mailpit by default", () => {
  it("TST-3 defaults to mailpit and reads resend in any case", () => {
    expect(mailProviderOf({})).toBe("mailpit");
    expect(mailProviderOf({ E2E_MAIL_PROVIDER: "  " })).toBe("mailpit");
    expect(mailProviderOf({ E2E_MAIL_PROVIDER: "Resend" })).toBe("resend");
  });

  it("TST-3 refuses anything else, naming the variable", () => {
    expect(() => mailProviderOf({ E2E_MAIL_PROVIDER: "gmail" })).toThrow(/E2E_MAIL_PROVIDER must be mailpit or resend/);
  });
});

describe("TST-3 latestMagicLink on Resend: list the newest 100, filter on to, retrieve the match", () => {
  it("TST-3 lists, retrieves the newest match and returns its link, with the key only in the Authorization header", async () => {
    const { deps, calls } = fakeDeps(RESEND_ENV, (url) =>
      url === LIST_URL
        ? { body: listOf(summary("newer", [EMAIL], "2026-10-17T10:05:00Z"), summary("other", ["someone@else.example"], "2026-10-17T10:06:00Z"), summary("older", [EMAIL], "2026-10-17T10:00:00Z")) }
        : { body: { object: "email", id: "newer", to: [EMAIL], text: `Your link: ${LINK}`, html: null } },
    );
    await expect(latestMagicLink(EMAIL, undefined, deps)).resolves.toBe(LINK);
    expect(calls.map((c) => c.url)).toEqual([LIST_URL, "https://api.resend.com/emails/receiving/newer"]);
    expect(calls.every((c) => c.auth === `Bearer ${KEY}`)).toBe(true);
    expect(calls.some((c) => c.url.includes(KEY))).toBe(false);
  });

  it("TST-3 falls back to the HTML body of the retrieved mail", async () => {
    const { deps } = fakeDeps(RESEND_ENV, (url) =>
      url === LIST_URL ? { body: listOf(summary("m1", [EMAIL], "2026-10-17T10:00:00Z")) } : { body: { text: null, html: `<a href="${LINK.replace(/&/g, "&amp;")}">Sign in</a>` } },
    );
    await expect(latestMagicLink(EMAIL, undefined, deps)).resolves.toBe(LINK);
  });

  it("TST-3 polls every 3 s until the mail arrives", async () => {
    const { deps, calls, elapsed } = fakeDeps(RESEND_ENV, (url, n) =>
      url === LIST_URL ? { body: n < 3 ? listOf() : listOf(summary("late", [EMAIL], "2026-10-17T10:00:00Z")) } : { body: { text: LINK } },
    );
    await expect(latestMagicLink(EMAIL, undefined, deps)).resolves.toBe(LINK);
    expect(calls.filter((c) => c.url === LIST_URL)).toHaveLength(3);
    expect(elapsed()).toBe(2 * RESEND_POLL_MS);
  });

  it("TST-3 retries a rate limit or a server error until the deadline", async () => {
    const { deps } = fakeDeps(RESEND_ENV, (url, n) => (n === 1 ? { status: 429 } : n === 2 ? { status: 503 } : url === LIST_URL ? { body: listOf(summary("m", [EMAIL], "2026-10-17T10:00:00Z")) } : { body: { text: LINK } }));
    await expect(latestMagicLink(EMAIL, undefined, deps)).resolves.toBe(LINK);
  });

  it("TST-3 retries a request that fails on the network, and refuses a body that is not JSON", async () => {
    let n = 0;
    const flaky: MailDeps = {
      ...fakeDeps(RESEND_ENV, () => ({})).deps,
      fetch: (async (input: RequestInfo | URL) => {
        n += 1;
        if (n === 1) throw new TypeError("fetch failed");
        const url = String(input);
        const body = url === LIST_URL ? listOf(summary("m", [EMAIL], "2026-10-17T10:00:00Z")) : { text: LINK };
        return new Response(JSON.stringify(body), { status: 200 });
      }) as typeof fetch,
    };
    await expect(latestMagicLink(EMAIL, undefined, flaky)).resolves.toBe(LINK);
    const { deps } = fakeDeps(RESEND_ENV, () => ({}));
    const html: MailDeps = { ...deps, fetch: (async () => new Response("<html>bad gateway</html>", { status: 200 })) as typeof fetch };
    await expect(latestMagicLink(EMAIL, 30_000, html)).rejects.toThrow(/Resend receiving list: GET \/emails\/receiving\?limit=100 did not match the expected shape/);
  });

  it("TST-3 times out after 90 s by default with an error naming the address and never the key", async () => {
    const { deps, elapsed } = fakeDeps(RESEND_ENV, () => ({ body: listOf(summary("x", ["someone@else.example"], "2026-10-17T10:00:00Z")) }));
    const error = await latestMagicLink(EMAIL, undefined, deps).then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(error?.message).toContain(EMAIL);
    expect(error?.message).toContain(`${RESEND_TIMEOUT_MS}ms`);
    expect(error?.message).toContain("Resend");
    expect(error?.message).not.toContain(KEY);
    expect(elapsed()).toBeGreaterThanOrEqual(RESEND_TIMEOUT_MS);
  });

  it("TST-3 stops at once when Resend refuses the key, without printing it", async () => {
    const { deps, calls } = fakeDeps(RESEND_ENV, () => ({ status: 401, body: { name: "validation_error", message: `API key ${KEY} is invalid` } }));
    const error = await latestMagicLink(EMAIL, 30_000, deps).then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(error?.message).toMatch(/401/);
    expect(error?.message).toContain("E2E_RESEND_KEY");
    expect(error?.message).not.toContain(KEY);
    expect(calls).toHaveLength(1);
  });

  it("TST-3 refuses a list that is not Resend's shape", async () => {
    const { deps } = fakeDeps(RESEND_ENV, () => ({ body: { data: [{ id: 42 }] } }));
    await expect(latestMagicLink(EMAIL, 30_000, deps)).rejects.toThrow(/Resend receiving list/);
  });

  it("TST-3 needs E2E_RESEND_KEY and names it", async () => {
    const { deps, calls } = fakeDeps({ E2E_MAIL_PROVIDER: "resend" }, () => ({}));
    await expect(latestMagicLink(EMAIL, 30_000, deps)).rejects.toThrow(/E2E_RESEND_KEY/);
    expect(calls).toHaveLength(0);
  });
});

describe("TST-3 latestMagicLink on Mailpit (the local default) behaves as before", () => {
  it("TST-3 lists /messages?limit=20 at E2E_MAIL_API, reads the match and returns its link", async () => {
    const api = "http://127.0.0.1:54324/api/v1";
    const { deps, calls } = fakeDeps({}, (url) =>
      url.endsWith("/messages?limit=20")
        ? { body: { messages: [{ ID: "m-other", To: [{ Address: "someone@north.test" }], Created: "x" }, { ID: "m-1", To: [{ Address: EMAIL.toUpperCase() }], Created: "x" }] } }
        : { body: { Text: `Sign in: ${LINK}`, HTML: "" } },
    );
    await expect(latestMagicLink(EMAIL, undefined, deps)).resolves.toBe(LINK);
    expect(calls.map((c) => c.url)).toEqual([`${api}/messages?limit=20`, `${api}/message/m-1`]);
    expect(calls.every((c) => c.auth === null)).toBe(true);
  });

  it("TST-3 times out after 20 s by default", async () => {
    const { deps, elapsed } = fakeDeps({}, () => ({ body: { messages: [] } }));
    await expect(latestMagicLink(EMAIL, undefined, deps)).rejects.toThrow(`No magic link for ${EMAIL} within 20000ms`);
    expect(elapsed()).toBeGreaterThanOrEqual(20_000);
  });
});
