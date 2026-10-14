import { describe, expect, it } from "vitest";
import { MetaAds } from "../src/live/meta-ads";
import { ResendMail } from "../src/live/resend";
import { WebPush } from "../src/live/web-push";
import { SandboxAds } from "../src/sandbox/ads";
import { SandboxMail } from "../src/sandbox/mail";
import { SandboxPush } from "../src/sandbox/push";
import { createSandboxIntegrations } from "../src/sandbox/index";
import { selectIntegrations } from "../src/select";
import type { SandboxEvent } from "../src/types";

const VAPID = { VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv", VAPID_SUBJECT: "mailto:ceo@example.test" };
const RESEND = { RESEND_API_KEY: "re_test", RESEND_FROM: "North <north@example.test>" };
const META = { META_ACCESS_TOKEN: "tok", META_AD_ACCOUNT_ID: "act_1" };

const warnings = () => {
  const lines: string[] = [];
  return { lines, warn: (line: string) => void lines.push(line) };
};

describe("createSandboxIntegrations", () => {
  it("wires all three sandbox providers to one sink", async () => {
    const events: SandboxEvent[] = [];
    const integrations = createSandboxIntegrations((e) => void events.push(e));
    expect(integrations.mode).toBe("sandbox");
    await integrations.mail.send({ companyId: "c1", to: "a@example.test", subject: "s", text: "t", kind: "notification" });
    await integrations.ads.startCampaign({ companyId: "c1", name: "n", dailyBudgetUsd: 1, audience: "a", creativeMarkdown: "# c" });
    await integrations.push.send({ endpoint: "https://p.example.test/1", p256dh: "k", auth: "a" }, { title: "t", body: "b", url: "/" });
    expect(events.map((e) => e.provider)).toEqual(["mail", "ads", "push"]);
  });
});

describe("selectIntegrations", () => {
  it("returns sandbox by default and for any non-live mode value", () => {
    const { lines, warn } = warnings();
    for (const env of [{}, { INTEGRATIONS_MODE: "sandbox" }, { INTEGRATIONS_MODE: "production" }]) {
      const integrations = selectIntegrations(env, undefined, warn);
      expect(integrations.mode).toBe("sandbox");
      expect(integrations.ads).toBeInstanceOf(SandboxAds);
      expect(integrations.mail).toBeInstanceOf(SandboxMail);
      expect(integrations.push).toBeInstanceOf(SandboxPush);
    }
    expect(lines).toEqual([]);
  });

  it("in live mode without keys falls back to sandbox per provider and warns once per provider", () => {
    const { lines, warn } = warnings();
    const integrations = selectIntegrations({ INTEGRATIONS_MODE: "live" }, undefined, warn);
    expect(integrations.mode).toBe("live");
    expect(integrations.ads).toBeInstanceOf(SandboxAds);
    expect(integrations.mail).toBeInstanceOf(SandboxMail);
    expect(integrations.push).toBeInstanceOf(SandboxPush);
    expect(lines).toHaveLength(3);
    expect(lines.join("\n")).toMatch(/ads/);
    expect(lines.join("\n")).toMatch(/mail/);
    expect(lines.join("\n")).toMatch(/push/);
  });

  it("in live mode uses each live adapter only when its keys exist", () => {
    const { lines, warn } = warnings();
    const integrations = selectIntegrations({ INTEGRATIONS_MODE: "live", ...RESEND, ...VAPID, ...META }, undefined, warn);
    expect(integrations.ads).toBeInstanceOf(MetaAds);
    expect(integrations.mail).toBeInstanceOf(ResendMail);
    expect(integrations.push).toBeInstanceOf(WebPush);
    expect(lines).toEqual([]);

    const partial = selectIntegrations({ INTEGRATIONS_MODE: "live", ...RESEND }, undefined, warn);
    expect(partial.mail).toBeInstanceOf(ResendMail);
    expect(partial.ads).toBeInstanceOf(SandboxAds);
    expect(partial.push).toBeInstanceOf(SandboxPush);
    expect(lines).toHaveLength(2);
  });

  it("treats a half-configured provider as missing", () => {
    const { lines, warn } = warnings();
    const integrations = selectIntegrations({ INTEGRATIONS_MODE: "live", RESEND_API_KEY: "re_x", VAPID_PUBLIC_KEY: "pub" }, undefined, warn);
    expect(integrations.mail).toBeInstanceOf(SandboxMail);
    expect(integrations.push).toBeInstanceOf(SandboxPush);
    expect(lines).toHaveLength(3);
  });

  it("passes the sink to the sandbox fallbacks in live mode", async () => {
    const events: SandboxEvent[] = [];
    const integrations = selectIntegrations({ INTEGRATIONS_MODE: "live" }, (e) => void events.push(e), () => undefined);
    await integrations.mail.send({ companyId: "c1", to: "a@example.test", subject: "s", text: "t", kind: "reply" });
    expect(events).toHaveLength(1);
  });
});
