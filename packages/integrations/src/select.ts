import { CompetitorSites, type AllowUrl } from "./live/competitor-sites";
import { GitHubCodeHost, type FetchLike } from "./live/github";
import { GmailOutreach } from "./live/gmail";
import { GoogleTrendsSignals } from "./live/google-trends";
import { MetaAds } from "./live/meta-ads";
import { PostHogAnalytics } from "./live/posthog";
import { ProductHuntSignals } from "./live/producthunt";
import { RedditSignals } from "./live/reddit";
import { ResendMail, resendConfig } from "./live/resend";
import { StripeBilling, stripeBillingConfig } from "./live/stripe-billing";
import { StripeReadPayments } from "./live/stripe-read";
import { VercelDeploy } from "./live/vercel";
import { WebPush, webPushConfig } from "./live/web-push";
import { integrationMode } from "./mode";
import { SandboxBilling } from "./sandbox/billing";
import { defaultSiteBaseUrl } from "./sandbox/deploy";
import { defaultSandboxRoot } from "./sandbox/files";
import { createSandboxIntegrations } from "./sandbox/index";
import { SandboxImages } from "./sandbox/images";
import { SandboxMail } from "./sandbox/mail";
import { SandboxPush } from "./sandbox/push";
import type { BillingProvider, Integrations, MailProvider, ProviderAuth, PushProvider, SandboxSink, SignalSource } from "./types";

export type Warn = (line: string) => void;

/** What the worker injects into the live adapters: the verifier's host policy for competitor pages, and a fetch for tests. */
export interface SelectOptions {
  /** The verifier's host policy (no private or loopback hosts). Without it every competitor URL is skipped. */
  readonly allowUrl?: AllowUrl;
  readonly fetchImpl?: FetchLike;
  /** Deterministic time for the sandbox sources and the sandbox code host. */
  readonly clock?: () => Date;
  /** TST-5: the test fence is on, so the platform's Stripe runs on a test key or not at all (`stripeBillingConfig`'s `requireTestKey`). */
  readonly requireStripeTestKey?: boolean;
}

const fallback = (provider: string, warn: Warn): void =>
  warn(`[integrations] INTEGRATIONS_MODE=live but the ${provider} keys are missing; using the ${provider} sandbox adapter`);

/**
 * The platform's Stripe (BIL-1): `StripeBilling` with both keys, else the
 * sandbox adapter and the M3 fallback warning. Its checkout pages live on the
 * worker's sandbox routes, which a live worker does not mount, so a live
 * deployment without keys sells nothing rather than something fake. Under
 * the test fence a key that is not a test key counts as no key (TST-5).
 */
function liveBilling(env: NodeJS.ProcessEnv, sink: SandboxSink | undefined, warn: Warn, options: SelectOptions): BillingProvider {
  const config = stripeBillingConfig(env, { requireTestKey: options.requireStripeTestKey === true, warn });
  if (config) return new StripeBilling(config, options.fetchImpl);
  fallback("billing", warn);
  return new SandboxBilling(sink, defaultSandboxRoot(env), options.clock, { siteBaseUrl: defaultSiteBaseUrl(env) });
}

/** Live mode: Reddit and competitor sites read the public web; Product Hunt and Google Trends are honest stubs (scope decisions). */
function liveSignals(warn: Warn, options: SelectOptions): readonly SignalSource[] {
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  let allowUrl = options.allowUrl;
  if (!allowUrl) {
    warn("[integrations] competitor sites: no host policy (allowUrl) was injected; every competitor URL is skipped until the worker provides one");
    allowUrl = async () => false;
  }
  return Object.freeze([new RedditSignals({ fetchImpl, warn }), new CompetitorSites({ fetchImpl, allowUrl, warn }), new ProductHuntSignals(), new GoogleTrendsSignals()]);
}

/**
 * Chooses the adapters for the process (ADR 0005). Sandbox unless the mode is
 * exactly `live`. In live mode the platform providers (mail, push, billing)
 * need their own complete key set, otherwise that provider silently stays in
 * sandbox and a warning is logged. Ads, outreach, code, deploys and the
 * payments read (the user's Stripe, OUT-2) run on the user's own connections
 * (BUD-2, ADR 0010), so in live mode they are always the live adapters and
 * refuse without a connection; analytics is the honest M4 stub. There are no
 * platform ads keys any more.
 */
export function selectIntegrations(env: NodeJS.ProcessEnv = process.env, sink?: SandboxSink, warn: Warn = (line) => console.warn(line), options: SelectOptions = {}): Integrations {
  const mode = integrationMode(env);
  if (mode === "sandbox") {
    return createSandboxIntegrations(sink, {
      ...(env.SANDBOX_ROOT ? { root: env.SANDBOX_ROOT } : {}),
      ...(env.SANDBOX_SITE_BASE_URL ? { siteBaseUrl: env.SANDBOX_SITE_BASE_URL } : {}),
      ...(options.clock ? { clock: options.clock } : {}),
    });
  }

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
  const billing = liveBilling(env, sink, warn, options);
  const fetchImpl = options.fetchImpl;

  return Object.freeze({
    mode,
    ads: (auth: ProviderAuth | null) => new MetaAds(auth),
    outreach: (auth: ProviderAuth | null) => new GmailOutreach(auth),
    analytics: (auth: ProviderAuth | null) => new PostHogAnalytics(auth),
    payments: (auth: ProviderAuth | null) => new StripeReadPayments(auth, fetchImpl, options.clock),
    mail,
    push,
    images,
    code: (auth: ProviderAuth | null) => new GitHubCodeHost(auth),
    deploy: (auth: ProviderAuth | null) => new VercelDeploy(auth),
    signals: liveSignals(warn, options),
    billing,
  });
}
