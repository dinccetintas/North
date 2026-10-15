import { z } from "zod";
import { DAY_SCHEMA } from "./brief/types";
import { CONNECTION_PROVIDERS } from "./connections";
import { SIGNAL_KINDS } from "./signals/types";
import { TASK_TYPES } from "./tasks/types";

/**
 * Event names and payload schemas shared by apps/web and apps/worker.
 * Kept free of any queue library so the domain stays portable (ADR 0002).
 */
export const EVENT = {
  companyCreated: "company/created",
  companyOnboarded: "company/onboarded",
  planRequested: "plan/requested",
  planCreated: "plan/created",
  taskDispatch: "task/dispatch",
  taskFinished: "task/finished",
  taskEscalated: "task/escalated",
  decisionOpened: "decision/opened",
  decisionAnswered: "decision/answered",
  decisionExpired: "decision/expired",
  decisionDeferred: "decision/deferred",
  signalDetected: "signal/detected",
  signalScan: "signal/scan",
  metricCollect: "metric/collect",
  briefTick: "brief/tick",
  briefGenerate: "brief/generate",
  companyKillSwitch: "company/killswitch",
  companyResume: "company/resume",
  connectionOauthCode: "connection/oauth_code",
  connectionRevoked: "connection/revoked",
  billingSessionRequested: "billing/session_requested",
  billingEvent: "billing/event",
  billingTick: "billing/tick",
  usageTick: "usage/tick",
  retentionTick: "retention/tick",
  exportRequested: "export/requested",
} as const;
export type EventName = (typeof EVENT)[keyof typeof EVENT];

export const CompanyEventSchema = z.object({ companyId: z.string().uuid() });
export const TaskDispatchSchema = z.object({ companyId: z.string().uuid(), taskId: z.string().uuid() });
export const TaskFinishedSchema = z.object({
  companyId: z.string().uuid(),
  taskId: z.string().uuid(),
  taskType: z.enum(TASK_TYPES),
  status: z.enum(["done", "failed", "waiting_decision"]),
});
/** AGT-3: both attempts failed; the Chief of Staff (and the brief, M5) take it from here. */
export const TaskEscalatedSchema = z.object({
  companyId: z.string().uuid(),
  taskId: z.string().uuid(),
  taskType: z.enum(TASK_TYPES),
  reason: z.string().min(1).max(4000),
});
export type TaskEscalatedEvent = z.infer<typeof TaskEscalatedSchema>;

/**
 * ONB-3: the web callback hands the one-time OAuth code to the worker, which
 * holds the client secret, exchanges it and stores the token (ADR 0008). The
 * code is single-use and short-lived; the web never sees the token.
 */
export const OAUTH_CODE_PROVIDERS = ["github", "vercel", "meta_ads", "gmail", "stripe"] as const;

export const ConnectionOauthCodeSchema = z.object({
  userId: z.string().uuid(),
  provider: z.enum(OAUTH_CODE_PROVIDERS),
  code: z.string().min(1).max(2048),
  redirectUri: z.string().url(),
});
export type ConnectionOauthCodeEvent = z.infer<typeof ConnectionOauthCodeSchema>;

export const ConnectionRevokedSchema = z.object({ userId: z.string().uuid(), provider: z.enum(CONNECTION_PROVIDERS) });
export type ConnectionRevokedEvent = z.infer<typeof ConnectionRevokedSchema>;

/**
 * The secret a connection stores (ADR 0008): a plain token for GitHub and
 * Vercel, or an access/refresh pair with an expiry for Google and Meta. Only
 * the worker reads or writes it.
 */
export const ProviderTokenSchema = z.union([
  z.string().min(1),
  z.object({
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1).optional(),
    expiresAt: z.iso.datetime({ offset: true }).optional(),
  }),
]);
export type ProviderToken = z.infer<typeof ProviderTokenSchema>;

/** OUT-2: collect a company's metrics now; `cron` is the hourly fan-out, `manual` a smoke or e2e trigger. */
export const MetricCollectSchema = z.object({ companyId: z.string().uuid(), reason: z.enum(["cron", "manual"]) });
export type MetricCollectEvent = z.infer<typeof MetricCollectSchema>;

/** BRF-1: generate the brief of one company for one owner-local day (`brief/tick` picks the companies at 07:00). */
export const BriefGenerateSchema = z.object({ companyId: z.string().uuid(), day: DAY_SCHEMA });
export type BriefGenerateEvent = z.infer<typeof BriefGenerateSchema>;

/** PRO-1: scan a company's signal sources now; `cron` is the six-hourly fan-out, `manual` a smoke or e2e trigger. */
export const SignalScanSchema = z.object({ companyId: z.string().uuid(), reason: z.enum(["cron", "manual"]) });
export type SignalScanEvent = z.infer<typeof SignalScanSchema>;

/** PRO-2: a signal row exists; `watch-errors` listens for `kind: error`. */
export const SignalDetectedSchema = z.object({ companyId: z.string().uuid(), signalId: z.string().uuid(), kind: z.enum(SIGNAL_KINDS) });
export type SignalDetectedEvent = z.infer<typeof SignalDetectedSchema>;

export const DecisionAnsweredSchema = z.object({
  companyId: z.string().uuid(),
  cardId: z.string().uuid(),
  optionId: z.string().min(1),
  answeredBy: z.enum(["user", "default", "auto_rule"]),
});
export const DecisionOpenedSchema = z.object({
  companyId: z.string().uuid(),
  cardId: z.string().uuid(),
  taskId: z.string().uuid().nullable(),
});
export const DecisionDeferredSchema = z.object({
  companyId: z.string().uuid(),
  taskId: z.string().uuid(),
  reason: z.string().min(1),
});
export type DecisionOpenedEvent = z.infer<typeof DecisionOpenedSchema>;
export type DecisionDeferredEvent = z.infer<typeof DecisionDeferredSchema>;

/** BIL-1 (ADR 0014): the owner inserted a `requested` billing session; the worker, which holds the Stripe key, creates the provider session. */
export const BillingSessionRequestedSchema = z.object({ sessionId: z.uuid(), userId: z.uuid() });
export type BillingSessionRequestedEvent = z.infer<typeof BillingSessionRequestedSchema>;

/** BIL-1: a `billing_events` row is stored and waits to be applied (`apply-billing-event`, one at a time per user). The Stripe body itself is `BillingEventSchema` in `billing/events`. */
export const BillingEventPayloadSchema = z.object({ billingEventId: z.uuid(), userId: z.uuid() });
export type BillingEventPayload = z.infer<typeof BillingEventPayloadSchema>;

/** EXP-1 (ADR 0016): the owner inserted a `requested` export; `build-export` fulfils it in the worker. */
export const ExportRequestedSchema = z.object({ exportId: z.uuid(), userId: z.uuid() });
export type ExportRequestedEvent = z.infer<typeof ExportRequestedSchema>;

export type CompanyEvent = z.infer<typeof CompanyEventSchema>;
export type TaskDispatchEvent = z.infer<typeof TaskDispatchSchema>;
export type TaskFinishedEvent = z.infer<typeof TaskFinishedSchema>;
export type DecisionAnsweredEvent = z.infer<typeof DecisionAnsweredSchema>;
