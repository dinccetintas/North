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
  decisionOpened: "decision/opened",
  decisionAnswered: "decision/answered",
  decisionExpired: "decision/expired",
  signalDetected: "signal/detected",
  metricCollect: "metric/collect",
  briefGenerate: "brief/generate",
  companyKillSwitch: "company/killswitch",
  companyResume: "company/resume",
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
export const DecisionAnsweredSchema = z.object({
  companyId: z.string().uuid(),
  cardId: z.string().uuid(),
  optionId: z.string().min(1),
  answeredBy: z.enum(["user", "default", "auto_rule"]),
});

export type CompanyEvent = z.infer<typeof CompanyEventSchema>;
export type TaskDispatchEvent = z.infer<typeof TaskDispatchSchema>;
export type TaskFinishedEvent = z.infer<typeof TaskFinishedSchema>;
export type DecisionAnsweredEvent = z.infer<typeof DecisionAnsweredSchema>;
