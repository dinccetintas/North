import { describe, expect, it } from "vitest";
import { NotConfiguredError, ProviderError } from "../src/errors";
import type { FetchLike } from "../src/live/github";
import { GMAIL_API, GmailOutreach, buildRawMessage, normaliseAddress, parseGmailRef } from "../src/live/gmail";

interface Call {
  readonly method: string;
  readonly url: string;
  readonly path: string;
  readonly body: Record<string, unknown> | undefined;
  readonly auth: string | null;
}

function scripted(routes: Record<string, (body: Record<string, unknown> | undefined, url: URL) => { status: number; json?: unknown }>) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const method = init?.method ?? "GET";
    const parsed = new URL(url);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    const headers = init?.headers as Record<string, string> | undefined;
    calls.push({ method, url, path: parsed.pathname, body, auth: headers?.authorization ?? null });
    const handler = routes[`${method} ${parsed.pathname}`];
    if (!handler) return new Response(JSON.stringify({ error: { code: 404, message: `no route ${method} ${parsed.pathname}` } }), { status: 404 });
    const { status, json } = handler(body, parsed);
    return new Response(json === undefined ? null : JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
  };
  return { calls, fetchImpl };
}

const decodeRaw = (raw: string): string => Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
const auth = { token: "ya29-secret", account: "Founder <founder@acme.example>" };
const input = { companyId: "c1", to: "mara@example.test", subject: "Northwind and the weekly routine", text: "Hi Mara,\n\nOne ask.\n\nThanks", kind: "first_contact" as const };

describe("GmailOutreach live adapter (B4-5, SLS-K2)", () => {
  it("refuses without a connection and never echoes the token in errors", async () => {
    await expect(new GmailOutreach(null).send(input)).rejects.toBeInstanceOf(NotConfiguredError);
    const { fetchImpl } = scripted({ "POST /gmail/v1/users/me/messages/send": () => ({ status: 401, json: { error: { code: 401, message: "Invalid Credentials ya29-secret" } } }) });
    const failure = new GmailOutreach(auth, fetchImpl).send(input);
    await expect(failure).rejects.toBeInstanceOf(ProviderError);
    await expect(failure).rejects.toThrow(/401/);
    await expect(failure).rejects.not.toThrow(/ya29-secret/);
  });

  it("send builds an RFC 2822 message, base64url-encodes it and returns gmail:<messageId>:<threadId>", async () => {
    const { calls, fetchImpl } = scripted({ "POST /gmail/v1/users/me/messages/send": () => ({ status: 200, json: { id: "m1", threadId: "t1", labelIds: ["SENT"] } }) });
    const gmail = new GmailOutreach(auth, fetchImpl);
    await expect(gmail.send(input)).resolves.toEqual({ messageId: "gmail:m1:t1", sandbox: false });
    expect(calls[0]?.auth).toBe("Bearer ya29-secret");
    expect(calls[0]?.url).toBe(`${GMAIL_API}/messages/send`);
    const raw = String(calls[0]?.body?.raw);
    expect(raw).not.toMatch(/[+/=]/);
    const mime = decodeRaw(raw);
    const [headers, body] = mime.split("\r\n\r\n");
    expect(headers?.split("\r\n")).toEqual(["To: mara@example.test", "Subject: Northwind and the weekly routine", "MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64"]);
    expect(Buffer.from(body ?? "", "base64").toString("utf8")).toBe(input.text);
    expect(mime).not.toContain("ya29");
  });

  it("buildRawMessage encodes non-ASCII subjects per RFC 2047 and strips header injection", () => {
    const mime = buildRawMessage({ to: "a@example.test", subject: "Merhaba İstanbul\r\nBcc: evil@example.test", text: "x" });
    expect(mime).toContain("Subject: =?UTF-8?B?");
    expect(mime).not.toContain("Bcc:");
    expect(mime.split("\r\n\r\n")[0]?.split("\r\n")).toHaveLength(5);
  });

  it("replies counts, per sent thread, the messages after the send whose From is not the connected address", async () => {
    const thread = {
      id: "t1",
      messages: [
        { id: "m0", internalDate: "1760520000000", payload: { headers: [{ name: "From", value: "Founder <founder@acme.example>" }] } },
        { id: "m1", internalDate: "1760523600000", payload: { headers: [{ name: "From", value: "founder@acme.example" }] } },
        { id: "m2", internalDate: "1760527200000", payload: { headers: [{ name: "From", value: "Mara Lindqvist <Mara@Example.test>" }] } },
        { id: "m3", internalDate: "1760530800000", payload: { headers: [{ name: "From", value: "FOUNDER@acme.example" }] } },
        { id: "m4", internalDate: "1760534400000", payload: { headers: [{ name: "From", value: "mara@example.test" }] } },
      ],
    };
    const { calls, fetchImpl } = scripted({
      "GET /gmail/v1/users/me/threads/t1": () => ({ status: 200, json: thread }),
      "GET /gmail/v1/users/me/threads/t2": () => ({ status: 200, json: { id: "t2", messages: [{ id: "m9", internalDate: "1", payload: { headers: [{ name: "From", value: "founder@acme.example" }] } }] } }),
    });
    const gmail = new GmailOutreach(auth, fetchImpl);
    const counts = await gmail.replies({ companyId: "c1", messageIds: ["gmail:m1:t1", "gmail:m9:t2", "sandbox:msg:x", "gmail:m7:t_missing"] });
    expect(counts).toEqual([
      { messageId: "gmail:m1:t1", replies: 2, lastReplyAt: new Date(1760534400000).toISOString() },
      { messageId: "gmail:m9:t2", replies: 0, lastReplyAt: null },
      { messageId: "sandbox:msg:x", replies: 0, lastReplyAt: null },
      { messageId: "gmail:m7:t_missing", replies: 0, lastReplyAt: null },
    ]);
    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get("format")).toBe("metadata");
    expect(url.searchParams.getAll("metadataHeaders")).toEqual(["From"]);
    expect(calls.map((c) => c.path)).toEqual(["/gmail/v1/users/me/threads/t1", "/gmail/v1/users/me/threads/t2", "/gmail/v1/users/me/threads/t_missing"]);
  });

  it("without auth.account the connected address comes from the profile, fetched once", async () => {
    const { calls, fetchImpl } = scripted({
      "GET /gmail/v1/users/me/profile": () => ({ status: 200, json: { emailAddress: "Founder@Acme.example" } }),
      "GET /gmail/v1/users/me/threads/t1": () => ({ status: 200, json: { id: "t1", messages: [{ id: "m1", internalDate: "1", payload: { headers: [{ name: "From", value: "founder@acme.example" }] } }, { id: "m2", internalDate: "2000", payload: { headers: [{ name: "From", value: "x@example.test" }] } }] } }),
    });
    const gmail = new GmailOutreach({ token: "t" }, fetchImpl);
    expect(await gmail.replies({ companyId: "c1", messageIds: ["gmail:m1:t1"] })).toEqual([{ messageId: "gmail:m1:t1", replies: 1, lastReplyAt: "1970-01-01T00:00:02.000Z" }]);
    await gmail.replies({ companyId: "c1", messageIds: ["gmail:m1:t1"] });
    expect(calls.filter((c) => c.path.endsWith("/profile"))).toHaveLength(1);
  });

  it("status reads the message; 404 is unknown, other errors are ProviderError", async () => {
    const { calls, fetchImpl } = scripted({
      "GET /gmail/v1/users/me/messages/m1": () => ({ status: 200, json: { id: "m1", threadId: "t1", labelIds: ["SENT"] } }),
      "GET /gmail/v1/users/me/messages/m500": () => ({ status: 500, json: { error: { code: 500, message: "boom" } } }),
    });
    const gmail = new GmailOutreach(auth, fetchImpl);
    expect(await gmail.status("gmail:m1:t1")).toBe("sent");
    expect(await gmail.status("gmail:m404:t1")).toBe("unknown");
    expect(await gmail.status("sandbox:msg:x")).toBe("unknown");
    await expect(gmail.status("gmail:m500:t1")).rejects.toBeInstanceOf(ProviderError);
    expect(new URL(calls[0]!.url).searchParams.get("format")).toBe("minimal");
  });

  it("address normalisation and ref parsing", () => {
    expect(normaliseAddress("Founder <Founder@Acme.example>")).toBe("founder@acme.example");
    expect(normaliseAddress("  x@y.z ")).toBe("x@y.z");
    expect(normaliseAddress('"Last, First" <a@b.c>')).toBe("a@b.c");
    expect(parseGmailRef("gmail:m1:t1")).toEqual({ messageId: "m1", threadId: "t1" });
    expect(parseGmailRef("gmail:m1")).toBeNull();
    expect(parseGmailRef("sandbox:msg:1")).toBeNull();
  });
});
