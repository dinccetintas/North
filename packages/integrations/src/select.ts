import { MetaAds, metaAdsConfig } from "./live/meta-ads";
import { ResendMail, resendConfig } from "./live/resend";
import { WebPush, webPushConfig } from "./live/web-push";
import { integrationMode } from "./mode";
import { SandboxAds } from "./sandbox/ads";
import { SandboxMail } from "./sandbox/mail";
import { SandboxPush } from "./sandbox/push";
import type { AdsProvider, Integrations, MailProvider, PushProvider, SandboxSink } from "./types";

export type Warn = (line: string) => void;

const fallback = (provider: string, warn: Warn): void =>
  warn(`[integrations] INTEGRATIONS_MODE=live but the ${provider} keys are missing; using the ${provider} sandbox adapter`);

/**
 * Chooses the adapters for the process (ADR 0005). Sandbox unless the mode is
 * exactly `live`; in live mode each provider needs its own complete key set,
 * otherwise that provider silently stays in sandbox and a warning is logged.
 */
export function selectIntegrations(env: NodeJS.ProcessEnv = process.env, sink?: SandboxSink, warn: Warn = (line) => console.warn(line)): Integrations {
  const mode = integrationMode(env);
  if (mode === "sandbox") {
    return Object.freeze({ mode, ads: new SandboxAds(sink), mail: new SandboxMail(sink), push: new SandboxPush(sink) });
  }

  const meta = metaAdsConfig(env);
  const resend = resendConfig(env);
  const vapid = webPushConfig(env);

  let ads: AdsProvider;
  if (meta) ads = new MetaAds(meta);
  else {
    fallback("ads", warn);
    ads = new SandboxAds(sink);
  }

  let mail: MailProvider;
  if (resend) mail = new ResendMail(resend);
  else {
    fallback("mail", warn);
    mail = new SandboxMail(sink);
  }

  let push: PushProvider;
  if (vapid) push = new WebPush(vapid);
  else {
    fallback("push", warn);
    push = new SandboxPush(sink);
  }

  return Object.freeze({ mode, ads, mail, push });
}
