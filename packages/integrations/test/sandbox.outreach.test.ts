import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SandboxOutreach } from "../src/sandbox/outreach";
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
      { messageId: a.messageId, replies: 2, lastReplyAt: "2026-10-15T12:00:00.000Z" },
      { messageId: b.messageId, replies: 0, lastReplyAt: null },
      { messageId: "sandbox:msg:missing", replies: 0, lastReplyAt: null },
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
    expect(await outreach.replies({ companyId: "c2", messageIds: [a.messageId] })).toEqual([{ messageId: a.messageId, replies: 0, lastReplyAt: null }]);
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
});
