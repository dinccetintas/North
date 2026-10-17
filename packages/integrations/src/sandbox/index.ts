import type { AdsProvider, OutreachMailProvider } from "../growth-types";
import type { Integrations, SandboxSink } from "../types";
import { SandboxAds } from "./ads";
import { SandboxAnalytics } from "./analytics";
import { SandboxBilling } from "./billing";
import { SandboxCodeHost } from "./code";
import { SandboxDeploy, defaultSiteBaseUrl } from "./deploy";
import { defaultSandboxRoot } from "./files";
import { SandboxImages } from "./images";
import { SandboxMail } from "./mail";
import { SandboxOutreach } from "./outreach";
import { SandboxPayments } from "./payments";
import { SandboxPush } from "./push";
import { createSandboxSignals } from "./signals";

export interface SandboxOptions {
  /** Folder for sandbox repos, sites, campaigns and mail; defaults to `SANDBOX_ROOT` or a temp dir. */
  readonly root?: string;
  /** Public base URL of the worker that serves `/sandbox/sites`. */
  readonly siteBaseUrl?: string;
  /** Injected clock for deterministic timestamps in tests. */
  readonly clock?: () => Date;
}

/** The simulation-only surface the worker's sandbox routes and cron use (`deliver`, `pace`, `simulateReply`, the billing pages' `completeCheckout` …). */
export interface SandboxSimulation {
  readonly ads: SandboxAds;
  readonly outreach: SandboxOutreach;
  readonly analytics: SandboxAnalytics;
  readonly payments: SandboxPayments;
  readonly billing: SandboxBilling;
}

/** The sandbox bundle: the `Integrations` contract plus typed access to the simulation methods. */
export interface SandboxIntegrations extends Integrations {
  readonly mode: "sandbox";
  readonly billing: SandboxBilling;
  readonly sandbox: SandboxSimulation;
}

export const isSandboxAds = (provider: AdsProvider): provider is SandboxAds => provider instanceof SandboxAds;
export const isSandboxOutreach = (provider: OutreachMailProvider): provider is SandboxOutreach => provider instanceof SandboxOutreach;

/** Every provider in sandbox mode, sharing one sink and one root. The default for every environment. */
export function createSandboxIntegrations(sink?: SandboxSink, options: SandboxOptions = {}): SandboxIntegrations {
  const root = options.root ?? defaultSandboxRoot();
  const baseUrl = options.siteBaseUrl ?? defaultSiteBaseUrl();
  const clock = options.clock ?? (() => new Date());
  const ads = new SandboxAds(sink, root, clock);
  const outreach = new SandboxOutreach(sink, root, clock);
  const analytics = new SandboxAnalytics(sink, root);
  const payments = new SandboxPayments(sink);
  const code = new SandboxCodeHost(sink, root, clock);
  const deploy = new SandboxDeploy(sink, root, baseUrl);
  const billing = new SandboxBilling(sink, root, clock, { siteBaseUrl: baseUrl });
  return Object.freeze({
    mode: "sandbox" as const,
    ads: () => ads,
    outreach: () => outreach,
    analytics: () => analytics,
    payments: () => payments,
    mail: new SandboxMail(sink),
    push: new SandboxPush(sink),
    images: new SandboxImages(sink),
    code: () => code,
    deploy: () => deploy,
    signals: createSandboxSignals(clock),
    billing,
    sandbox: Object.freeze({ ads, outreach, analytics, payments, billing }),
  });
}

export { SandboxAds, hourlyDelivery, SANDBOX_COST_PER_CLICK_USD, SANDBOX_CLICK_THROUGH, SANDBOX_CONVERSION_RATE, type SandboxCampaign, type SandboxCampaignStatus } from "./ads";
export { AdsStore, SandboxCampaignSchema, DeliveryLineSchema, sumDeliveries, type DeliveryLine } from "./ads-store";
export { SandboxOutreach, SandboxMessageSchema, OutreachSendInputSchema, SANDBOX_OUTREACH_MAILBOX, SANDBOX_REPLY_KINDS, type SandboxMessage, type SandboxReply, type SandboxReplyKind } from "./outreach";
export { SandboxAnalytics } from "./analytics";
export { SandboxPayments } from "./payments";
export {
  SandboxBilling,
  isSandboxBilling,
  signSandboxWebhook,
  signedSandboxEvent,
  addMonths,
  SANDBOX_STRIPE_WEBHOOK_SECRET,
  SANDBOX_STRIPE_API_VERSION,
  SANDBOX_BILLING_CHECKOUT_PATH,
  SANDBOX_BILLING_PORTAL_PATH,
  SandboxStripeEventSchema,
  SandboxCheckoutSessionSchema,
  SandboxSubscriptionSchema,
  type SandboxBillingOptions,
  type SandboxStripeEvent,
  type SandboxCheckoutSession,
  type SandboxSubscription,
  type SignedSandboxEvent,
} from "./billing";
export { SandboxMail } from "./mail";
export { SandboxPush } from "./push";
export { SandboxCodeHost, SandboxPullRequestSchema, BRANCHES_DIR, PULLS_DIR, type SandboxPullRequest } from "./code";
export { SandboxReddit, SandboxProductHunt, SandboxGoogleTrends, SandboxCompetitorSites, createSandboxSignals, sandboxSignalRefs, SANDBOX_CHANGE_HASH } from "./signals";
export { SandboxDeploy, SANDBOX_SITES_PATH, defaultSiteBaseUrl, liveSiteDir } from "./deploy";
export { SandboxImages, placeholderSvg } from "./images";
export { defaultSandboxRoot, safeJoin, writeTree } from "./files";
export { sandboxRef } from "./record";
