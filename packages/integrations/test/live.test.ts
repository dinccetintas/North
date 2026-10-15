import { describe, expect, it } from "vitest";
import { ProviderError } from "../src/errors";
import { ResendMail, resendConfig, type ResendClient } from "../src/live/resend";
import { WebPush, webPushConfig, type PushSender } from "../src/live/web-push";

describe("ResendMail", () => {
  const input = { companyId: "c1", to: "mara@example.test", subject: "Hello", text: "Hi", kind: "first_contact" as const };
  const config = { apiKey: "re_test", from: "North <north@example.test>" };

  it("sends through the client with the configured from address and returns a live message id", async () => {
    const sent: unknown[] = [];
    const client: ResendClient = {
      emails: {
        send: async (payload) => {
          sent.push(payload);
          return { data: { id: "msg_123" }, error: null };
        },
      },
    };
    const mail = new ResendMail(config, client);
    await expect(mail.send(input)).resolves.toEqual({ messageId: "msg_123", sandbox: false });
    expect(sent[0]).toEqual({ from: config.from, to: "mara@example.test", subject: "Hello", text: "Hi" });
  });

  it("turns a provider error into ProviderError without leaking the key", async () => {
    const client: ResendClient = {
      emails: { send: async () => ({ data: null, error: { name: "validation_error", message: "bad recipient" } }) },
    };
    const mail = new ResendMail(config, client);
    const failure = mail.send(input);
    await expect(failure).rejects.toBeInstanceOf(ProviderError);
    await expect(failure).rejects.toThrow(/validation_error: bad recipient/);
    await expect(failure).rejects.not.toThrow(/re_test/);
  });

  it("validates input before calling the client", async () => {
    const client: ResendClient = { emails: { send: async () => ({ data: { id: "x" }, error: null }) } };
    await expect(new ResendMail(config, client).send({ ...input, to: "nope" })).rejects.toThrow();
  });

  it("reads config only when both env values exist", () => {
    expect(resendConfig({})).toBeNull();
    expect(resendConfig({ RESEND_API_KEY: "k" })).toBeNull();
    expect(resendConfig({ RESEND_API_KEY: "k", RESEND_FROM: "f" })).toEqual({ apiKey: "k", from: "f" });
  });
});

describe("WebPush", () => {
  const config = { publicKey: "pub", privateKey: "priv", subject: "mailto:ceo@example.test" };
  const subscription = { endpoint: "https://push.example.test/1", p256dh: "k", auth: "a" };
  const payload = { title: "t", body: "b", url: "/decisions/1" };

  it("sends the JSON payload with per-call VAPID details", async () => {
    const calls: Parameters<PushSender>[] = [];
    const sender: PushSender = async (...args) => {
      calls.push(args);
      return { statusCode: 201, body: "", headers: {} };
    };
    const push = new WebPush(config, sender);
    await expect(push.send(subscription, payload)).resolves.toEqual({ ok: true, sandbox: false });
    const [sub, body, options] = calls[0]!;
    expect(sub).toEqual({ endpoint: subscription.endpoint, keys: { p256dh: "k", auth: "a" } });
    expect(JSON.parse(String(body))).toEqual(payload);
    expect(options?.vapidDetails).toEqual(config);
  });

  it("reports a failed push as ok:false with the error message instead of throwing", async () => {
    const sender: PushSender = async () => {
      throw new Error("410 Gone");
    };
    const push = new WebPush(config, sender);
    await expect(push.send(subscription, payload)).resolves.toEqual({ ok: false, sandbox: false, error: "410 Gone" });
  });

  it("reads config only when all three env values exist", () => {
    expect(webPushConfig({ VAPID_PUBLIC_KEY: "p", VAPID_PRIVATE_KEY: "s" })).toBeNull();
    expect(webPushConfig({ VAPID_PUBLIC_KEY: "p", VAPID_PRIVATE_KEY: "s", VAPID_SUBJECT: "mailto:x@y.z" })).toEqual({
      publicKey: "p",
      privateKey: "s",
      subject: "mailto:x@y.z",
    });
  });
});
