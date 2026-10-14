import { z } from "zod";
import type { IntegrationMode } from "./mode";

/**
 * Provider contracts for everything that touches the outside world (ADR 0005).
 * Inputs are validated with Zod at the adapter boundary so neither sandbox nor
 * live code ever sees a malformed request.
 */

export const PROVIDERS = ["ads", "mail", "push"] as const;
export type Provider = (typeof PROVIDERS)[number];

/** What an agent asks the ads provider to run; the authority gate has already approved it. */
export const CampaignSpecSchema = z.object({
  companyId: z.string().min(1),
  name: z.string().trim().min(1).max(200),
  dailyBudgetUsd: z.number().nonnegative(),
  audience: z.string().max(2000).default(""),
  creativeMarkdown: z.string().max(20_000).default(""),
});
export type CampaignSpec = z.input<typeof CampaignSpecSchema>;

export interface StartCampaignResult {
  /** Provider reference; sandbox refs start with `sandbox:`. */
  readonly campaignId: string;
  readonly sandbox: boolean;
}

export interface PauseAllResult {
  readonly paused: readonly string[];
}

export interface AdsProvider {
  startCampaign(spec: CampaignSpec): Promise<StartCampaignResult>;
  pauseCampaign(companyId: string, campaignId: string): Promise<void>;
  /** Kill switch: every active campaign of the company stops; returns what was paused. */
  pauseAll(companyId: string): Promise<PauseAllResult>;
}

export const MAIL_KINDS = ["first_contact", "reply", "notification"] as const;
export type MailKind = (typeof MAIL_KINDS)[number];

export const SendMailInputSchema = z.object({
  companyId: z.string().min(1),
  to: z.string().email(),
  subject: z.string().trim().min(1).max(998),
  text: z.string().min(1).max(100_000),
  kind: z.enum(MAIL_KINDS),
});
export type SendMailInput = z.input<typeof SendMailInputSchema>;

export interface SendMailResult {
  readonly messageId: string;
  readonly sandbox: boolean;
}

export interface MailProvider {
  send(input: SendMailInput): Promise<SendMailResult>;
}

const httpsUrl = z
  .string()
  .url()
  .refine((value) => value.startsWith("https://"), { message: "push endpoints must use https" });

/** A browser push subscription as stored in `push_subscriptions`. */
export const PushSubscriptionSchema = z.object({
  endpoint: httpsUrl,
  p256dh: z.string().min(1),
  auth: z.string().min(1),
});
export type PushSubscription = z.input<typeof PushSubscriptionSchema>;

export const PushPayloadSchema = z.object({
  title: z.string().min(1).max(120),
  body: z.string().max(500),
  url: z.string().min(1).max(2048),
});
export type PushPayload = z.input<typeof PushPayloadSchema>;

export interface PushResult {
  readonly ok: boolean;
  readonly sandbox: boolean;
  /** Present only when `ok` is false. */
  readonly error?: string;
}

export interface PushProvider {
  send(subscription: PushSubscription, payload: PushPayload): Promise<PushResult>;
}

/** The three providers the worker depends on, plus the mode they were selected for. */
export interface Integrations {
  readonly mode: IntegrationMode;
  readonly ads: AdsProvider;
  readonly mail: MailProvider;
  readonly push: PushProvider;
}

/** What a sandbox adapter records instead of calling a real service. */
export interface SandboxEvent {
  readonly provider: Provider;
  readonly op: string;
  /** Null when the operation has no company (push goes to a user). */
  readonly companyId: string | null;
  readonly ref: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly at: string;
}

/** Receives every sandbox event; may be async. The worker writes them to the audit trail. */
export type SandboxSink = (event: SandboxEvent) => void | Promise<void>;
