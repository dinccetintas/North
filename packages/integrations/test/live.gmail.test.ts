import { describe, expect, it } from "vitest";
import { NotConfiguredError, ProviderError } from "../src/errors";
import type { FetchLike } from "../src/live/github";
import { FOOTER_MARKER } from "@north/core";
import { GMAIL_API, GmailOutreach, OPT_OUT_PATTERN, REPLY_METADATA_HEADERS, buildRawMessage, countReplies, normaliseAddress, parseGmailRef } from "../src/live/gmail";

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
const UNSUBSCRIBE = { mailto: "founder@acme.example?subject=unsubscribe", url: "https://worker.north.example/u/tok_123" };
const FOOTER = "Acme Ltd, 1 Example Street, Springfield 12345\nReply \"no\" and I won't write again, or unsubscribe: https://worker.north.example/u/tok_123";
const input = { companyId: "c1", to: "mara@example.test", subject: "Northwind and the weekly routine", text: "Hi Mara,\n\nOne ask.\n\nThanks", kind: "first_contact" as const, footer: FOOTER, unsubscribe: UNSUBSCRIBE };
const COMPLIANCE_HEADERS = ["List-Unsubscribe: <mailto:founder@acme.example?subject=unsubscribe>, <https://worker.north.example/u/tok_123>", "List-Unsubscribe-Post: List-Unsubscribe=One-Click"];

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
    expect(headers?.split("\r\n")).toEqual(["To: mara@example.test", "Subject: Northwind and the weekly routine", ...COMPLIANCE_HEADERS, "MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64"]);
    expect(Buffer.from(body ?? "", "base64").toString("utf8")).toBe(`${input.text}${FOOTER_MARKER}${FOOTER}`);
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
      { messageId: "gmail:m1:t1", replies: 2, lastReplyAt: new Date(1760534400000).toISOString(), bounced: false, optedOut: false },
      { messageId: "gmail:m9:t2", replies: 0, lastReplyAt: null, bounced: false, optedOut: false },
      { messageId: "sandbox:msg:x", replies: 0, lastReplyAt: null, bounced: false, optedOut: false },
      { messageId: "gmail:m7:t_missing", replies: 0, lastReplyAt: null, bounced: false, optedOut: false },
    ]);
    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get("format")).toBe("metadata");
    expect(url.searchParams.getAll("metadataHeaders")).toEqual([...REPLY_METADATA_HEADERS]);
    expect(REPLY_METADATA_HEADERS).toEqual(["From", "Auto-Submitted", "Precedence", "Content-Type"]);
    expect(calls.filter((c) => c.path.includes("/threads/")).map((c) => c.path)).toEqual(["/gmail/v1/users/me/threads/t1", "/gmail/v1/users/me/threads/t2", "/gmail/v1/users/me/threads/t_missing"]);
    // CMP-1: each human reply's snippet is read once (format=minimal); a 404 there is no snippet, not an error.
    expect(calls.filter((c) => c.path.includes("/messages/")).map((c) => c.path)).toEqual(["/gmail/v1/users/me/messages/m2", "/gmail/v1/users/me/messages/m4"]);
  });

  it("without auth.account the connected address comes from the profile, fetched once", async () => {
    const { calls, fetchImpl } = scripted({
      "GET /gmail/v1/users/me/profile": () => ({ status: 200, json: { emailAddress: "Founder@Acme.example" } }),
      "GET /gmail/v1/users/me/threads/t1": () => ({ status: 200, json: { id: "t1", messages: [{ id: "m1", internalDate: "1", payload: { headers: [{ name: "From", value: "founder@acme.example" }] } }, { id: "m2", internalDate: "2000", payload: { headers: [{ name: "From", value: "x@example.test" }] } }] } }),
    });
    const gmail = new GmailOutreach({ token: "t" }, fetchImpl);
    expect(await gmail.replies({ companyId: "c1", messageIds: ["gmail:m1:t1"] })).toEqual([{ messageId: "gmail:m1:t1", replies: 1, lastReplyAt: "1970-01-01T00:00:02.000Z", bounced: false, optedOut: false }]);
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
  it("M4 review H2: a reply is bound to the lead's thread: threadId in the send body, In-Reply-To and References from the thread's Message-ID header", async () => {
    const { calls, fetchImpl } = scripted({
      "GET /gmail/v1/users/me/messages/m1": () => ({ status: 200, json: { id: "m1", threadId: "t1", payload: { headers: [{ name: "Message-ID", value: "<orig-123@mail.gmail.com>" }] } } }),
      "POST /gmail/v1/users/me/messages/send": () => ({ status: 200, json: { id: "m2", threadId: "t1" } }),
    });
    const gmail = new GmailOutreach(auth, fetchImpl);
    await expect(gmail.send({ ...input, kind: "reply", inReplyTo: { messageId: "m1", threadId: "t1" } })).resolves.toEqual({ messageId: "gmail:m2:t1", sandbox: false });
    const lookup = calls.find((c) => c.path.endsWith("/messages/m1"));
    expect(new URL(lookup!.url).searchParams.getAll("metadataHeaders")).toEqual(["Message-ID"]);
    const send = calls.find((c) => c.path.endsWith("/messages/send"))!;
    expect(send.body?.threadId).toBe("t1");
    const headers = decodeRaw(String(send.body?.raw)).split("\r\n\r\n")[0]?.split("\r\n");
    expect(headers).toContain("In-Reply-To: <orig-123@mail.gmail.com>");
    expect(headers).toContain("References: <orig-123@mail.gmail.com>");
    // Without a Message-ID header the API id is used as a best effort; a first contact carries no thread at all.
    const { calls: bare, fetchImpl: bareFetch } = scripted({
      "GET /gmail/v1/users/me/messages/m1": () => ({ status: 404, json: {} }),
      "POST /gmail/v1/users/me/messages/send": () => ({ status: 200, json: { id: "m3", threadId: "t1" } }),
    });
    await new GmailOutreach(auth, bareFetch).send({ ...input, kind: "reply", inReplyTo: { messageId: "m1", threadId: "t1" } });
    expect(decodeRaw(String(bare.at(-1)?.body?.raw))).toContain("In-Reply-To: <m1>");
    expect(buildRawMessage({ to: "a@example.test", subject: "s", text: "t" })).not.toContain("In-Reply-To");
    const injected = buildRawMessage({ to: "a@example.test", subject: "s", text: "t", inReplyTo: "<x>\r\nBcc: evil@example.test" }).split("\r\n\r\n")[0]?.split("\r\n") ?? [];
    expect(injected.some((h) => h.startsWith("Bcc:"))).toBe(false);
    expect(injected).toHaveLength(7);
  });

  it("M4 review L1: bounces and auto-replies are not replies (Auto-Submitted, Precedence bulk/auto_reply, mailer-daemon and postmaster senders)", () => {
    const from = (value: string, extra: { name: string; value: string }[] = []) => ({ payload: { headers: [{ name: "From", value }, ...extra] } });
    const messages = [
      { id: "m1", internalDate: "1000", ...from("founder@acme.example") },
      { id: "m2", internalDate: "2000", ...from("Mail Delivery Subsystem <MAILER-DAEMON@googlemail.com>") },
      { id: "m3", internalDate: "3000", ...from("postmaster@example.test") },
      { id: "m4", internalDate: "4000", ...from("mara@example.test", [{ name: "Auto-Submitted", value: "auto-replied" }]) },
      { id: "m5", internalDate: "5000", ...from("mara@example.test", [{ name: "Precedence", value: "bulk" }]) },
      { id: "m6", internalDate: "6000", ...from("mara@example.test", [{ name: "Precedence", value: "auto_reply" }]) },
      { id: "m7", internalDate: "7000", ...from("mara@example.test", [{ name: "Auto-Submitted", value: "no" }, { name: "Precedence", value: "list" }]) },
      { id: "m8", internalDate: "8000", ...from("Mara <mara@example.test>") },
    ];
    expect(countReplies(messages, "m1", "founder@acme.example")).toEqual({ replies: 2, lastReplyAt: new Date(8000).toISOString(), bounced: true });
  });
});

describe("GmailOutreach compliance on the wire (CMP-1)", () => {
  const sendRoute = () => scripted({ "POST /gmail/v1/users/me/messages/send": () => ({ status: 200, json: { id: "m1", threadId: "t1" } }) });
  const headersOf = (call: Call | undefined): string[] => decodeRaw(String(call?.body?.raw)).split("\r\n\r\n")[0]?.split("\r\n") ?? [];

  it("CMP-1: the raw message carries List-Unsubscribe (mailto and https), List-Unsubscribe-Post, Cc/Bcc from the arrays only, and the footer after the signature marker", async () => {
    const { calls, fetchImpl } = sendRoute();
    await new GmailOutreach(auth, fetchImpl).send({ ...input, cc: ["Dev@Example.test", "ops@example.test"], bcc: ["audit@example.test"] });
    const mime = decodeRaw(String(calls[0]?.body?.raw));
    const [head, body] = mime.split("\r\n\r\n");
    expect(head?.split("\r\n")).toEqual([
      "To: mara@example.test",
      "Cc: Dev@Example.test, ops@example.test",
      "Bcc: audit@example.test",
      "Subject: Northwind and the weekly routine",
      ...COMPLIANCE_HEADERS,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
    ]);
    const text = Buffer.from(body ?? "", "base64").toString("utf8");
    expect(text.endsWith(`\n\n-- \n${FOOTER}`)).toBe(true);
    expect(text.indexOf(FOOTER_MARKER)).toBe(input.text.length);
    // Without copies there is no Cc or Bcc line at all; buildRawMessage alone (no compliance input) adds neither header.
    const { calls: plain, fetchImpl: plainFetch } = sendRoute();
    await new GmailOutreach(auth, plainFetch).send(input);
    expect(headersOf(plain[0]).some((h) => /^(Cc|Bcc):/i.test(h))).toBe(false);
    expect(buildRawMessage({ to: "a@example.test", subject: "s", text: "t" })).not.toContain("List-Unsubscribe");
  });

  it("CMP-1: a CR or LF in an address or the subject, a copy that is not a plain address, or a bad unsubscribe target is refused before anything is sent", async () => {
    const { calls, fetchImpl } = sendRoute();
    const gmail = new GmailOutreach(auth, fetchImpl);
    const refused: Record<string, unknown>[] = [
      { subject: "Hello\r\nBcc: evil@example.test" },
      { subject: "Hello\nthere" },
      { to: "mara@example.test\r\nBcc: evil@example.test" },
      { cc: ["dev@example.test\r\nBcc: evil@example.test"] },
      { bcc: ["evil@example.test\n"] },
      { cc: ["Dev <dev@example.test>"] },
      { cc: ["a@example.test, b@example.test"] },
      { cc: "dev@example.test" },
      { unsubscribe: { ...UNSUBSCRIBE, url: "https://worker.north.example/u/x\r\nBcc: evil@example.test" } },
      { unsubscribe: { ...UNSUBSCRIBE, url: "https://worker.north.example/u/a>, <https://evil.example" } },
      { unsubscribe: { ...UNSUBSCRIBE, mailto: "founder@acme.example>, <mailto:evil@example.test" } },
      { unsubscribe: { ...UNSUBSCRIBE, mailto: "founder@acme.example" } },
    ];
    for (const patch of refused) await expect(gmail.send({ ...input, ...patch } as typeof input), JSON.stringify(patch)).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it("CMP-1: the live adapter never sends outreach without the footer and List-Unsubscribe, nor with a link that is not https", async () => {
    const { calls, fetchImpl } = sendRoute();
    const gmail = new GmailOutreach(auth, fetchImpl);
    const bare = { companyId: input.companyId, to: input.to, subject: input.subject, text: input.text, kind: input.kind };
    await expect(gmail.send(bare)).rejects.toBeInstanceOf(ProviderError);
    await expect(gmail.send({ ...bare, unsubscribe: UNSUBSCRIBE })).rejects.toThrow(/footer and List-Unsubscribe/);
    await expect(gmail.send({ ...bare, footer: FOOTER })).rejects.toThrow(/footer and List-Unsubscribe/);
    await expect(gmail.send({ ...input, unsubscribe: { ...UNSUBSCRIBE, url: "http://worker.north.example/u/tok_123" } })).rejects.toThrow(/https/);
    expect(calls).toEqual([]);
  });

  it("CMP-1: countReplies marks a bounce (mailer-daemon/postmaster sender, or Auto-Submitted auto-replied with a delivery report) after the send, never as a reply", () => {
    const msg = (id: string, from: string, extra: { name: string; value: string }[] = []) => ({ id, internalDate: id.replace(/\D/g, "") || "1", payload: { headers: [{ name: "From", value: from }, ...extra] } });
    const sent = msg("m1", "founder@acme.example");
    expect(countReplies([sent, msg("m2", "Mail Delivery Subsystem <MAILER-DAEMON@x.example>")], "m1", "founder@acme.example")).toEqual({ replies: 0, lastReplyAt: null, bounced: true });
    expect(countReplies([sent, msg("m2", "PostMaster@mx.example.test")], "m1", "founder@acme.example")).toMatchObject({ replies: 0, bounced: true });
    const report = [{ name: "Auto-Submitted", value: "auto-replied" }, { name: "Content-Type", value: 'multipart/report; report-type=delivery-status; boundary="b"' }];
    expect(countReplies([sent, msg("m2", "mail@relay.example.test", report)], "m1", "founder@acme.example")).toEqual({ replies: 0, lastReplyAt: null, bounced: true });
    // An out-of-office (auto-replied, plain text) is automated but no bounce; a human reply is neither.
    expect(countReplies([sent, msg("m2", "mara@example.test", [{ name: "Auto-Submitted", value: "auto-replied" }, { name: "Content-Type", value: "text/plain" }])], "m1", "founder@acme.example")).toEqual({ replies: 0, lastReplyAt: null, bounced: false });
    expect(countReplies([sent, msg("m2", "Mara <mara@example.test>")], "m1", "founder@acme.example")).toEqual({ replies: 1, lastReplyAt: new Date(2).toISOString(), bounced: false });
    // A bounce before the send belongs to another message.
    expect(countReplies([msg("m0", "mailer-daemon@x.example"), sent], "m1", "founder@acme.example")).toMatchObject({ bounced: false });
  });

  it("CMP-1: replies() reads each human reply's snippet (format=minimal, at most 20 per thread), sets optedOut on the opt-out pattern and never keeps the snippet", async () => {
    const human = (n: number) => ({ id: `r${n}`, internalDate: String(1000 + n), payload: { headers: [{ name: "From", value: "mara@example.test" }] } });
    const sentMsg = { id: "m1", internalDate: "1", payload: { headers: [{ name: "From", value: "founder@acme.example" }] } };
    const snippets: Record<string, string> = { r1: "Thanks, but please remove me from your list", r2: "Sounds good, let&#39;s talk Tuesday" };
    const { calls, fetchImpl } = scripted({
      "GET /gmail/v1/users/me/threads/t1": () => ({ status: 200, json: { id: "t1", messages: [sentMsg, human(1)] } }),
      "GET /gmail/v1/users/me/threads/t2": () => ({ status: 200, json: { id: "t2", messages: [sentMsg, human(2)] } }),
      "GET /gmail/v1/users/me/threads/t3": () => ({ status: 200, json: { id: "t3", messages: [sentMsg, ...Array.from({ length: 25 }, (_, i) => human(100 + i))] } }),
      "GET /gmail/v1/users/me/threads/t4": () => ({ status: 200, json: { id: "t4", messages: [sentMsg, { id: "b1", internalDate: "5", payload: { headers: [{ name: "From", value: "MAILER-DAEMON@googlemail.com" }] } }, human(3)] } }),
      ...Object.fromEntries(["r1", "r2", "r3", ...Array.from({ length: 25 }, (_, i) => `r${100 + i}`)].map((id) => [`GET /gmail/v1/users/me/messages/${id}`, () => ({ status: 200, json: { id, snippet: snippets[id] ?? "Interesting, tell me more" } })])),
    });
    const counts = await new GmailOutreach(auth, fetchImpl).replies({ companyId: "c1", messageIds: ["gmail:m1:t1", "gmail:m1:t2", "gmail:m1:t3", "gmail:m1:t4"] });
    expect(counts.map((c) => [c.messageId, c.replies, c.bounced, c.optedOut])).toEqual([
      ["gmail:m1:t1", 1, false, true],
      ["gmail:m1:t2", 1, false, false],
      ["gmail:m1:t3", 25, false, false],
      ["gmail:m1:t4", 1, true, false],
    ]);
    const minimal = calls.filter((c) => c.path.includes("/messages/"));
    expect(minimal.every((c) => new URL(c.url).searchParams.get("format") === "minimal")).toBe(true);
    expect(minimal.filter((c) => /\/r1\d\d$/.test(c.path))).toHaveLength(20);
    // A bounced thread needs no snippet: the address is suppressed either way.
    expect(minimal.some((c) => c.path.endsWith("/r3"))).toBe(false);
    expect(JSON.stringify(counts)).not.toMatch(/remove me|Tuesday|tell me more/);
  });

  it("CMP-1: OPT_OUT_PATTERN matches the ways people ask to stop, and not ordinary interest", () => {
    for (const yes of ["Unsubscribe", "please opt me out — opt out", "opt-out", "optout", "Stop emailing me", "stop contacting us", "Remove me", "Not interested, thanks", "No thanks."]) expect(OPT_OUT_PATTERN.test(yes), yes).toBe(true);
    for (const no of ["I'm interested", "stopping by next week", "removed the blocker", "thanks!"]) expect(OPT_OUT_PATTERN.test(no), no).toBe(false);
  });
});
