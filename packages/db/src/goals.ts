import { GoalInputSchema, METRIC_KEYS, type GoalInput, type MetricKey } from "@north/core";
import { z } from "zod";
import type { DbClient } from "./client";
import { dbError } from "./errors";
import { UuidSchema } from "./json";

export const GOAL_STATUSES = ["active", "done", "dropped"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export interface GoalRecord {
  readonly id: string;
  readonly metricKey: MetricKey;
  readonly targetValue: number;
  readonly dueDate: string;
  readonly status: GoalStatus;
}

const GOAL_COLUMNS = "id, metric_key, target_value, due_date, status";

const GoalRowSchema = z.object({
  id: z.string(),
  metric_key: z.enum(METRIC_KEYS),
  target_value: z.coerce.number(),
  due_date: z.string(),
  status: z.enum(GOAL_STATUSES),
});

const toRecord = (row: unknown): GoalRecord => {
  const r = GoalRowSchema.parse(row);
  return Object.freeze({ id: r.id, metricKey: r.metric_key, targetValue: r.target_value, dueDate: r.due_date, status: r.status });
};

/** ONB-2: creates one measurable goal for the company. */
export async function createGoal(db: DbClient, companyId: string, input: GoalInput): Promise<{ readonly id: string }> {
  const id = UuidSchema.parse(companyId);
  const goal = GoalInputSchema.parse(input);
  const { data, error } = await db
    .from("goals")
    .insert({ company_id: id, metric_key: goal.metricKey, target_value: goal.targetValue, due_date: goal.dueDate })
    .select("id")
    .single();
  if (error || !data) throw dbError("Could not create goal", error);
  return Object.freeze({ id: data.id });
}

/** Every goal of the company, oldest first. */
export async function listGoals(db: DbClient, companyId: string): Promise<readonly GoalRecord[]> {
  const id = UuidSchema.parse(companyId);
  const { data, error } = await db.from("goals").select(GOAL_COLUMNS).eq("company_id", id).order("created_at", { ascending: true });
  if (error) throw dbError("Could not list goals", error);
  return Object.freeze((data ?? []).map(toRecord));
}
