import { describe, expect, it } from "vitest";
import { SandboxMail } from "../src/sandbox/mail";
import { SandboxPush } from "../src/sandbox/push";
import type { SandboxEvent } from "../src/types";

const recorder = () => {
  const events: SandboxEvent[] = [];
  return { events, sink: (event: SandboxEvent) => void events.push(event) };
};

describe("SandboxMail", () => {
  it("records the send and returns a sandbox message id", async () => {
    const { events, sink } = recorder();
    const mail = new SandboxMail(sink);
    const result = await mail.send({ companyId: "c1", to: "mara@example.test", subject: "Hello", text: "Hi Mara", kind: "first_contact" });
    expect(result.sandbox).toBe(true);
    expect(result.messageId).toMatch(/^sandbox:msg:[0-9a-f-]{36}$/);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      provider: "mail",
      op: "send",
      companyId: "c1",
      ref: result.messageId,
      payload: { to: "mara@example.test", subject: "Hello", kind: "first_contact" },
    });
  });

  it("rejects an invalid recipient or an unknown kind", async () => {
    const mail = new SandboxMail();
    await expect(mail.send({ companyId: "c1", to: "not-an-email", subject: "x", text: "y", kind: "reply" })).rejects.toThrow();
    await expect(
      mail.send({ companyId: "c1", to: "a@example.test", subject: "x", text: "y", kind: "spam" as unknown as "reply" }),
    ).rejects.toThrow();
  });
});

describe("SandboxPush", () => {
  const subscription = { endpoint: "https://push.example.test/sub/1", p256dh: "p256dh-key", auth: "auth-secret" };
  const payload = { title: "Decision needed", body: "Approve the test campaign?", url: "/c/lumen/decisions/1" };

  it("records the push without the subscription secrets and returns ok", async () => {
    const { events, sink } = recorder();
    const push = new SandboxPush(sink);
    const result = await push.send(subscription, payload);
    expect(result).toEqual({ ok: true, sandbox: true });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ provider: "push", op: "send", companyId: null, payload: { endpoint: subscription.endpoint, ...payload } });
    expect(events[0]?.ref).toMatch(/^sandbox:push:[0-9a-f-]{36}$/);
    expect(JSON.stringify(events[0]?.payload)).not.toContain("auth-secret");
    expect(JSON.stringify(events[0]?.payload)).not.toContain("p256dh-key");
  });

  it("rejects a subscription without an https endpoint", async () => {
    const push = new SandboxPush();
    await expect(push.send({ ...subscription, endpoint: "ftp://nope" }, payload)).rejects.toThrow();
  });
});
