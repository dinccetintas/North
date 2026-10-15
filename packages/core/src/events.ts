import { z } from "zod";
import { CONNECTION_PROVIDERS } from "./connections";
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
  metricCollect: "metric/collect",
  briefGenerate: "brief/generate",
  companyKillSwitch: "company/killswitch",
  companyResume: "company/resume",
  connectionOauthCode: "connection/oauth_code",
  connectionRevoked: "connection/revoked",
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
export const OAUTH_CODE_PROVIDERS = ["github", "vercel", "meta_ads", "gmail"] as const;

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

export type CompanyEvent = z.infer<typeof CompanyEventSchema>;
export type TaskDispatchEvent = z.infer<typeof TaskDispatchSchema>;
export type TaskFinishedEvent = z.infer<typeof TaskFinishedSchema>;
export type DecisionAnsweredEvent = z.infer<typeof DecisionAnsweredSchema>;
