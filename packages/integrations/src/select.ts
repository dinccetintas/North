import { GitHubCodeHost } from "./live/github";
import { GmailOutreach } from "./live/gmail";
import { MetaAds } from "./live/meta-ads";
import { PostHogAnalytics } from "./live/posthog";
import { ResendMail, resendConfig } from "./live/resend";
import { StripeReadPayments } from "./live/stripe-read";
import { VercelDeploy } from "./live/vercel";
import { WebPush, webPushConfig } from "./live/web-push";
import { integrationMode } from "./mode";
import { createSandboxIntegrations } from "./sandbox/index";
import { SandboxImages } from "./sandbox/images";
import { SandboxMail } from "./sandbox/mail";
import { SandboxPush } from "./sandbox/push";
import type { Integrations, MailProvider, ProviderAuth, PushProvider, SandboxSink } from "./types";

export type Warn = (line: string) => void;

const fallback = (provider: string, warn: Warn): void =>
  warn(`[integrations] INTEGRATIONS_MODE=live but the ${provider} keys are missing; using the ${provider} sandbox adapter`);

/**
 * Chooses the adapters for the process (ADR 0005). Sandbox unless the mode is
 * exactly `live`. In live mode the platform providers (mail, push) need their
 * own complete key set, otherwise that provider silently stays in sandbox and
 * a warning is logged. Ads, outreach, code and deploys run on the user's own
 * connections (BUD-2, ADR 0010), so in live mode they are always the live
 * adapters and refuse without a connection; analytics and payments are the
 * honest M4 stubs. There are no platform ads keys any more.
 */
export function selectIntegrations(env: NodeJS.ProcessEnv = process.env, sink?: SandboxSink, warn: Warn = (line) => console.warn(line)): Integrations {
  const mode = integrationMode(env);
  if (mode === "sandbox") return createSandboxIntegrations(sink, { ...(env.SANDBOX_ROOT ? { root: env.SANDBOX_ROOT } : {}), ...(env.SANDBOX_SITE_BASE_URL ? { siteBaseUrl: env.SANDBOX_SITE_BASE_URL } : {}) });

  const resend = resendConfig(env);
  const vapid = webPushConfig(env);

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

  // Image generation has no live provider yet; the placeholder is explicit, not a silent fallback.
  const images = new SandboxImages(sink);

  return Object.freeze({
    mode,
    ads: (auth: ProviderAuth | null) => new MetaAds(auth),
    outreach: (auth: ProviderAuth | null) => new GmailOutreach(auth),
    analytics: (auth: ProviderAuth | null) => new PostHogAnalytics(auth),
    payments: (auth: ProviderAuth | null) => new StripeReadPayments(auth),
    mail,
    push,
    images,
    code: (auth: ProviderAuth | null) => new GitHubCodeHost(auth),
    deploy: (auth: ProviderAuth | null) => new VercelDeploy(auth),
  });
}
