import { z } from "zod";
import { ACTION_KINDS, BUDGET_CATEGORIES } from "../authority/action";
import { CHANNELS } from "../metrics";
import { SIGNAL_SOURCES, SIGNAL_STATUSES } from "../signals/types";
import { TASK_STATUSES } from "../tasks/lifecycle";
import { AGENT_ROLES, METRIC_KEYS } from "../tasks/types";
import { TIERS } from "../tiers";

/**
 * BRF-1: the morning brief is a `briefs` row whose `content` is this shape,
 * rendered to markdown for the email and to the home screen panel. It is not
 * written by a model: the numbers are the ledger's and the order is fixed.
 */
export const BRIEF_MAX_WORDS = 200;

export const DAY_SCHEMA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

/** List bounds: the gatherer never hands more than this; `composeBrief` clamps anyway. */
export const BRIEF_LIST_MAX = Object.freeze({ outcomes: 50, actions: 50, metrics: 20, pending: 20, today: 20, spend: 10, signals: 20, escalations: 20 });

/** A known metric key or budget category; typed as `string` so the gatherer's rows need no cast, checked at runtime. */
const known = (values: readonly string[], what: string) => z.string().max(40).refine((value) => values.includes(value), { message: `unknown ${what}` });
const MetricKeySchema = known(METRIC_KEYS, "metric key");

const Outcome = z.object({
  what: z.string().max(200),
  metricKey: MetricKeySchema,
  delta: z.number(),
  costUsd: z.number().nonnegative(),
  channel: z.enum(CHANNELS).nullable(),
});

const Action = z.object({
  kind: z.enum(ACTION_KINDS),
  status: z.string().min(1).max(40),
  description: z.string().max(500),
});

const Metric = z.object({
  key: MetricKeySchema,
  value: z.number(),
  previous: z.number().nullable(),
  measuredAt: z.iso.datetime({ offset: true }),
});

const Goal = z.object({
  metricKey: MetricKeySchema,
  target: z.number(),
  current: z.number(),
  dueDate: DAY_SCHEMA,
});

const PendingCard = z.object({
  id: z.string().min(1).max(64),
  question: z.string().min(1).max(200),
  dueAt: z.iso.datetime({ offset: true }),
  tier: z.enum(TIERS),
});

const TodayTask = z.object({
  taskId: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
  role: z.enum(AGENT_ROLES),
  status: z.enum(TASK_STATUSES),
});

const Spend = z.object({
  category: known(BUDGET_CATEGORIES, "budget category"),
  spentTodayUsd: z.number().nonnegative(),
  dailyCapUsd: z.number().nonnegative(),
  spentTotalUsd: z.number().nonnegative(),
  totalCapUsd: z.number().nonnegative(),
});

const Signal = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
  source: z.enum(SIGNAL_SOURCES),
  score: z.number().min(0).max(1),
  status: z.enum(SIGNAL_STATUSES),
});

const Escalation = z.object({ title: z.string().min(1).max(200) });

export const BriefSchema = z.object({
  day: DAY_SCHEMA,
  companyName: z.string().min(1).max(200),
  /** The kill switch is active: the brief says so instead of promising work. */
  stopped: z.boolean(),
  yesterday: z.object({
    outcomes: z.array(Outcome).max(BRIEF_LIST_MAX.outcomes),
    actions: z.array(Action).max(BRIEF_LIST_MAX.actions),
  }),
  metrics: z.array(Metric).max(BRIEF_LIST_MAX.metrics),
  goal: Goal.nullable(),
  decisions: z.object({
    pending: z.array(PendingCard).max(BRIEF_LIST_MAX.pending),
    deferred: z.number().int().nonnegative(),
    answeredYesterday: z.number().int().nonnegative(),
  }),
  today: z.array(TodayTask).max(BRIEF_LIST_MAX.today),
  spend: z.array(Spend).max(BRIEF_LIST_MAX.spend),
  signals: z.array(Signal).max(BRIEF_LIST_MAX.signals),
  escalations: z.array(Escalation).max(BRIEF_LIST_MAX.escalations),
  /** Words of the rendered markdown; at most BRIEF_MAX_WORDS. */
  wordCount: z.number().int().nonnegative(),
});
export type Brief = z.infer<typeof BriefSchema>;

/** What the worker gathers; `composeBrief` trims it and counts the words. */
export type BriefInput = Omit<Brief, "wordCount">;
export type BriefSignal = Brief["signals"][number];
