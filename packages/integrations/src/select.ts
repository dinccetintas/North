import { GitHubCodeHost } from "./live/github";
import { MetaAds, metaAdsConfig } from "./live/meta-ads";
import { ResendMail, resendConfig } from "./live/resend";
import { VercelDeploy } from "./live/vercel";
import { WebPush, webPushConfig } from "./live/web-push";
import { integrationMode } from "./mode";
import { SandboxAds } from "./sandbox/ads";
import { createSandboxIntegrations } from "./sandbox/index";
import { SandboxImages } from "./sandbox/images";
import { SandboxMail } from "./sandbox/mail";
import { SandboxPush } from "./sandbox/push";
import type { AdsProvider, Integrations, MailProvider, ProviderAuth, PushProvider, SandboxSink } from "./types";

export type Warn = (line: string) => void;

const fallback = (provider: string, warn: Warn): void =>
  warn(`[integrations] INTEGRATIONS_MODE=live but the ${provider} keys are missing; using the ${provider} sandbox adapter`);

/**
 * Chooses the adapters for the process (ADR 0005). Sandbox unless the mode is
 * exactly `live`; in live mode each platform provider needs its own complete
 * key set, otherwise that provider silently stays in sandbox and a warning is
 * logged. Code hosting and deploys use the user's own connections, so in live
 * mode they are always the live adapters (and refuse without a connection).
 */
export function selectIntegrations(env: NodeJS.ProcessEnv = process.env, sink?: SandboxSink, warn: Warn = (line) => console.warn(line)): Integrations {
  const mode = integrationMode(env);
  if (mode === "sandbox") return createSandboxIntegrations(sink, { ...(env.SANDBOX_ROOT ? { root: env.SANDBOX_ROOT } : {}), ...(env.SANDBOX_SITE_BASE_URL ? { siteBaseUrl: env.SANDBOX_SITE_BASE_URL } : {}) });

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

  // Image generation has no live provider yet (M4); the placeholder is explicit, not a silent fallback.
  const images = new SandboxImages(sink);

  return Object.freeze({
    mode,
    ads,
    mail,
    push,
    images,
    code: (auth: ProviderAuth | null) => new GitHubCodeHost(auth),
    deploy: (auth: ProviderAuth | null) => new VercelDeploy(auth),
  });
}
