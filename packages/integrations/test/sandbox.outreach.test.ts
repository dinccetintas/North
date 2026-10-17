import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SANDBOX_OUTREACH_MAILBOX, SandboxOutreach } from "../src/sandbox/outreach";
import type { SandboxEvent } from "../src/types";

const recorder = () => {
  const events: SandboxEvent[] = [];
  return { events, sink: (event: SandboxEvent) => void events.push(event) };
};

const root = () => mkdtemp(join(tmpdir(), "north-outreach-"));
const input = { companyId: "c1", to: "mara@example.test", subject: "Hello", text: "Hi Mara, the secret body", kind: "first_contact" as const };

describe("SandboxOutreach (B4-3, SLS-K2)", () => {
  it("send writes <root>/mail/<messageId>.json without the body, records the event and returns a sandbox:msg ref", async () => {
    const dir = await root();
    const { events, sink } = recorder();
    const outreach = new SandboxOutreach(sink, dir);
    const result = await outreach.send(input);
    expect(result.sandbox).toBe(true);
    expect(result.messageId).toMatch(/^sandbox:msg:[0-9a-f-]{36}$/);
    const raw = await readFile(join(dir, "mail", `${result.messageId}.json`), "utf8");
    expect(JSON.parse(raw)).toMatchObject({ messageId: result.messageId, companyId: "c1", to: "mara@example.test", subject: "Hello", kind: "first_contact" });
    expect(JSON.parse(raw).sentAt).toMatch(/^\d{4}-/);
    expect(raw).not.toContain("secret body");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ provider: "outreach", op: "send", companyId: "c1", ref: result.messageId, payload: { to: "mara@example.test", subject: "Hello", kind: "first_contact", textChars: input.text.length } });
    expect(JSON.stringify(events[0])).not.toContain("secret body");
    expect(await outreach.status(result.messageId)).toBe("sent");
    expect(await new SandboxOutreach(undefined, dir).status(result.messageId)).toBe("sent");
  });

  it("status is unknown for a missing, malformed or escaping id", async () => {
    const dir = await root();
    const outreach = new SandboxOutreach(undefined, dir);
    expect(await outreach.status("sandbox:msg:missing")).toBe("unknown");
    expect(await outreach.status("../escape")).toBe("unknown");
    expect(await outreach.status("")).toBe("unknown");
    expect(await readdir(dir)).toEqual([]);
  });

  it("simulateReply appends to <messageId>.replies.jsonl; replies counts per message with the last reply time", async () => {
    const dir = await root();
    const { events, sink } = recorder();
    const outreach = new SandboxOutreach(sink, dir);
    const a = await outreach.send(input);
    const b = await outreach.send({ ...input, to: "dev@example.test" });
    await outreach.simulateReply(a.messageId, "2026-10-15T10:00:00.000Z");
    await outreach.simulateReply(a.messageId, "2026-10-15T12:00:00.000Z");
    const lines = (await readFile(join(dir, "mail", `${a.messageId}.replies.jsonl`), "utf8")).trim().split("\n");
    expect(lines).toHaveLength(2);
    const counts = await outreach.replies({ companyId: "c1", messageIds: [a.messageId, b.messageId, "sandbox:msg:missing"] });
    expect(counts).toEqual([
      { messageId: a.messageId, replies: 2, lastReplyAt: "2026-10-15T12:00:00.000Z", bounced: false, optedOut: false },
      { messageId: b.messageId, replies: 0, lastReplyAt: null, bounced: false, optedOut: false },
      { messageId: "sandbox:msg:missing", replies: 0, lastReplyAt: null, bounced: false, optedOut: false },
    ]);
    expect(events.map((e) => e.op)).toEqual(["send", "send", "simulateReply", "simulateReply"]);
    expect(events[2]).toMatchObject({ provider: "outreach", companyId: "c1", ref: a.messageId });
    const later = await outreach.simulateReply(a.messageId);
    expect(later.at).toMatch(/^\d{4}-/);
  });

  it("replies never count another company's messages; simulateReply refuses an unknown message", async () => {
    const dir = await root();
    const outreach = new SandboxOutreach(undefined, dir);
    const a = await outreach.send(input);
    await outreach.simulateReply(a.messageId);
    expect(await outreach.replies({ companyId: "c2", messageIds: [a.messageId] })).toEqual([{ messageId: a.messageId, replies: 0, lastReplyAt: null, bounced: false, optedOut: false }]);
    await expect(outreach.simulateReply("sandbox:msg:missing")).rejects.toThrow(/unknown message/i);
    await expect(outreach.simulateReply(a.messageId, "yesterday")).rejects.toThrow();
  });

  it("validates input at the boundary", async () => {
    const dir = await root();
    const outreach = new SandboxOutreach(undefined, dir);
    await expect(outreach.send({ ...input, to: "not-an-email" })).rejects.toThrow();
    await expect(outreach.send({ ...input, kind: "notification" as unknown as "reply" })).rejects.toThrow();
    await expect(outreach.replies({ companyId: "c1", messageIds: [] })).rejects.toThrow();
  });
  it("M4 review H2: a reply records the thread it belongs to (inReplyTo) next to the message; a first contact records none", async () => {
    const dir = await root();
    const { events, sink } = recorder();
    const outreach = new SandboxOutreach(sink, dir);
    const first = await outreach.send(input);
    const reply = await outreach.send({ ...input, kind: "reply", inReplyTo: { messageId: first.messageId, threadId: first.messageId } });
    const stored = JSON.parse(await readFile(join(dir, "mail", `${reply.messageId}.json`), "utf8"));
    expect(stored).toMatchObject({ kind: "reply", inReplyTo: { messageId: first.messageId, threadId: first.messageId } });
    expect(JSON.parse(await readFile(join(dir, "mail", `${first.messageId}.json`), "utf8")).inReplyTo).toBeUndefined();
    expect(events[1]?.payload).toMatchObject({ kind: "reply", inReplyTo: { threadId: first.messageId } });
    await expect(outreach.send({ ...input, kind: "reply", inReplyTo: { messageId: "", threadId: "x" } })).rejects.toThrow();
  });
});

describe("SandboxOutreach compliance (CMP-1)", () => {
  const unsubscribe = { mailto: "outreach@sandbox.north.invalid?subject=unsubscribe", url: "http://127.0.0.1:3101/u/tok_123" };
  const footer = "Lumen Labs Ltd, 1 Example Street, Springfield 12345\nReply \"no\" and I won't write again, or unsubscribe: http://127.0.0.1:3101/u/tok_123";

  it("CMP-1: the sent record stores the footer, the List-Unsubscribe targets and the copies, never the body", async () => {
    const dir = await root();
    const { events, sink } = recorder();
    const outreach = new SandboxOutreach(sink, dir);
    const sent = await outreach.send({ ...input, footer, unsubscribe, cc: ["dev@example.test"], bcc: ["audit@example.test"] });
    const raw = await readFile(join(dir, "mail", `${sent.messageId}.json`), "utf8");
    expect(JSON.parse(raw)).toMatchObject({ footer, unsubscribe, cc: ["dev@example.test"], bcc: ["audit@example.test"] });
    expect(raw).not.toContain("secret body");
    expect(events[0]?.payload).toMatchObject({ footer: true, listUnsubscribe: true, cc: ["dev@example.test"], bcc: ["audit@example.test"] });
    expect(JSON.stringify(events[0])).not.toContain("tok_123");
    const bare = await outreach.send(input);
    const stored = JSON.parse(await readFile(join(dir, "mail", `${bare.messageId}.json`), "utf8"));
    expect(stored.footer).toBeUndefined();
    expect(stored.unsubscribe).toBeUndefined();
  });

  it("CMP-1: simulateReply(id, at, 'bounce') makes replies() say bounced (not a reply); 'opt_out' says optedOut; the default stays a reply", async () => {
    const dir = await root();
    const outreach = new SandboxOutreach(undefined, dir);
    const bounced = await outreach.send(input);
    const optedOut = await outreach.send({ ...input, to: "dev@example.test" });
    const replied = await outreach.send({ ...input, to: "ops@example.test" });
    expect(await outreach.simulateReply(bounced.messageId, undefined, "bounce")).toMatchObject({ kind: "bounce" });
    await outreach.simulateReply(optedOut.messageId, "2026-10-15T10:00:00.000Z", "opt_out");
    expect(await outreach.simulateReply(replied.messageId, "2026-10-15T11:00:00.000Z")).toEqual({ at: "2026-10-15T11:00:00.000Z", kind: "reply" });
    const counts = await outreach.replies({ companyId: "c1", messageIds: [bounced.messageId, optedOut.messageId, replied.messageId] });
    expect(counts).toEqual([
      { messageId: bounced.messageId, replies: 0, lastReplyAt: null, bounced: true, optedOut: false },
      { messageId: optedOut.messageId, replies: 1, lastReplyAt: "2026-10-15T10:00:00.000Z", bounced: false, optedOut: true },
      { messageId: replied.messageId, replies: 1, lastReplyAt: "2026-10-15T11:00:00.000Z", bounced: false, optedOut: false },
    ]);
    await expect(outreach.simulateReply(replied.messageId, undefined, "complaint" as unknown as "reply")).rejects.toThrow();
  });

  it("CMP-1: a CR or LF in the subject or an address, copies that are not plain addresses, and a malformed unsubscribe target are refused", async () => {
    const dir = await root();
    const outreach = new SandboxOutreach(undefined, dir);
    for (const patch of [{ subject: "Hi\r\nBcc: evil@example.test" }, { cc: ["a@example.test\r\nBcc: evil@example.test"] }, { cc: ["Ada <ada@example.test>"] }, { bcc: "audit@example.test" }, { unsubscribe: { ...unsubscribe, url: "javascript:alert(1)" } }, { unsubscribe: { ...unsubscribe, mailto: "x" } }, { footer: "" }]) {
      await expect(outreach.send({ ...input, ...patch } as typeof input), JSON.stringify(patch)).rejects.toThrow();
    }
    await expect(readdir(join(dir, "mail"))).rejects.toThrow();
  });
});

describe("SandboxOutreach mailbox (CMP-1)", () => {
  it("CMP-1: mailbox() is the sandbox mailbox, the List-Unsubscribe mailto target in sandbox mode", async () => {
    expect(await new SandboxOutreach(undefined, await root()).mailbox()).toBe(SANDBOX_OUTREACH_MAILBOX);
  });
});
