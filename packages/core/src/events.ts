import { z } from "zod";
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
export const ConnectionOauthCodeSchema = z.object({
  userId: z.string().uuid(),
  provider: z.enum(["github", "vercel"]),
  code: z.string().min(1).max(2048),
  redirectUri: z.string().url(),
});
export type ConnectionOauthCodeEvent = z.infer<typeof ConnectionOauthCodeSchema>;

export const ConnectionRevokedSchema = z.object({ userId: z.string().uuid(), provider: z.enum(["github", "vercel", "gmail", "stripe", "meta_ads"]) });
export type ConnectionRevokedEvent = z.infer<typeof ConnectionRevokedSchema>;

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
