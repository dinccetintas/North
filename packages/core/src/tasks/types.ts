import { z } from "zod";
import { ActionSpecSchema } from "../authority/action";

/**
 * Task types the platform knows how to run. Each belongs to one role and
 * produces one structured output shape (see AgentOutputSchema / PlanOutputSchema).
 */
export const TASK_TYPES = [
  "market_report",
  "personas",
  "competitor_map",
  "prd",
  "business_plan",
  "investor_deck",
  "brand_kit",
  "screen_designs",
  "build_site",
  "campaign_spec",
  "lead_research",
  "outreach_batch",
  "plan_week",
  "brief",
] as const;
export type TaskType = (typeof TASK_TYPES)[number];

/** The eight staff roles (docs/SPEC.md "AI ekip"). Tasks may only be owned by one of these. */
export const AGENT_ROLES = [
  "chief_of_staff",
  "research",
  "strategy_product",
  "engineering",
  "design",
  "growth",
  "sales",
  "ops_finance",
] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export const TASK_OWNER: Readonly<Record<TaskType, AgentRole>> = Object.freeze({
  market_report: "research",
  personas: "research",
  competitor_map: "research",
  prd: "strategy_product",
  business_plan: "strategy_product",
  investor_deck: "strategy_product",
  brand_kit: "design",
  screen_designs: "design",
  build_site: "engineering",
  campaign_spec: "growth",
  lead_research: "sales",
  outreach_batch: "sales",
  plan_week: "chief_of_staff",
  brief: "chief_of_staff",
});

/** Outcome metrics: the only keys a goal may point at (ONB-2). Extend here, never inline strings. */
export const OUTCOME_METRIC_KEYS = [
  "paying_customers",
  "signups",
  "waitlist",
  "demo_calls",
  "mrr_usd",
  "revenue_usd",
  "site_visitors",
  "email_replies",
  "artifacts",
] as const;
export type OutcomeMetricKey = (typeof OUTCOME_METRIC_KEYS)[number];

/** Channel metrics (OUT-2): what a campaign or batch did, sampled per source; never a goal. */
export const CHANNEL_METRIC_KEYS = ["ad_spend_usd", "ad_impressions", "ad_clicks", "emails_sent"] as const;
export type ChannelMetricKey = (typeof CHANNEL_METRIC_KEYS)[number];

/** Every metric key a sample, task or ledger entry can carry. */
export const METRIC_KEYS = [...OUTCOME_METRIC_KEYS, ...CHANNEL_METRIC_KEYS] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

export const ARTIFACT_KINDS = [
  "market_report",
  "personas",
  "competitor_map",
  "prd",
  "business_plan",
  "investor_deck",
  "brand_kit",
  "screen_designs",
  "build_report",
  "campaign_spec",
  "lead_list",
  "outreach_batch",
  "plan",
  "brief",
  "doc",
] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export const MAX_OUTPUT_FILES = 60;
export const MAX_OUTPUT_FILE_BYTES = 512 * 1024;
export const MAX_OUTPUT_TOTAL_BYTES = 2 * 1024 * 1024;

/** Relative, forward-slash paths inside the task workspace; no traversal, no absolute paths, no hidden dirs. */
export const WorkspacePathSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_-][A-Za-z0-9._-]*(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/, "relative path: segments of letters, digits, '.', '_' or '-', none starting with '.'");

/** One file an engineering run produced; the worker writes it into the workspace and pushes it to the user's repo. */
export const OutputFileSchema = z.object({
  path: WorkspacePathSchema,
  content: z.string().max(MAX_OUTPUT_FILE_BYTES),
});
export type OutputFile = z.infer<typeof OutputFileSchema>;

export const OutputFilesSchema = z
  .array(OutputFileSchema)
  .max(MAX_OUTPUT_FILES)
  .refine((files) => new Set(files.map((f) => f.path)).size === files.length, { message: "duplicate file path" })
  .refine((files) => files.reduce((sum, f) => sum + new TextEncoder().encode(f.content).length, 0) <= MAX_OUTPUT_TOTAL_BYTES, {
    message: `files exceed ${MAX_OUTPUT_TOTAL_BYTES} bytes in total`,
  });

export const MEMORY_KINDS = ["thesis", "persona", "decision", "learning", "doc"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export const ArtifactDraftSchema = z.object({
  kind: z.enum(ARTIFACT_KINDS),
  title: z.string().min(1).max(120),
  markdown: z.string().min(1),
});
export type ArtifactDraft = z.infer<typeof ArtifactDraftSchema>;

export const MemoryDraftSchema = z.object({
  kind: z.enum(MEMORY_KINDS),
  title: z.string().min(1).max(120),
  content: z.string().min(1).max(4000),
});
export type MemoryDraft = z.infer<typeof MemoryDraftSchema>;

/** The most leads one `lead_research` run may hand over. */
export const MAX_LEADS = 50;

/** One prospect from `lead_research`; the worker persists it to `leads` (source `research`, unique on email per company). */
export const LeadDraftSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.email().max(254),
  company: z.string().max(120).default(""),
  why: z.string().min(1).max(500),
});
export type LeadDraft = z.infer<typeof LeadDraftSchema>;

/** What every non-planning agent run returns. Artifacts and memory are persisted by the worker; actions are gated. */
export const AgentOutputSchema = z.object({
  summary: z.string().min(1).max(2000),
  artifacts: z.array(ArtifactDraftSchema).max(10),
  memory: z.array(MemoryDraftSchema).max(20),
  actions: z.array(ActionSpecSchema).max(20).default([]),
  /** Files for the task workspace (engineering); the mock runtime returns them, the SDK runtime writes them itself. */
  files: OutputFilesSchema.optional(),
  /** Prospects from `lead_research` (sales); the worker persists them, nothing is contacted here. */
  leads: z.array(LeadDraftSchema).max(MAX_LEADS).optional(),
  /** Honest self-assessment the Chief of Staff reads when planning the next week. */
  confidence: z.enum(["low", "medium", "high"]).default("medium"),
});
export type AgentOutput = z.infer<typeof AgentOutputSchema>;

export const PlannedTaskSchema = z.object({
  taskType: z.enum(TASK_TYPES),
  title: z.string().min(1).max(200),
  input: z.string().max(4000).default(""),
  metricKey: z.enum(METRIC_KEYS),
  expectedDelta: z.number(),
  costEstimateUsd: z.number().nonnegative(),
});
export type PlannedTask = z.infer<typeof PlannedTaskSchema>;

/** Chief of Staff output for `plan_week` (PLN-1). */
export const PlanOutputSchema = z.object({
  summary: z.string().min(1).max(2000),
  rationale: z.string().min(1).max(4000),
  tasks: z.array(PlannedTaskSchema).min(1).max(12),
});
export type PlanOutput = z.infer<typeof PlanOutputSchema>;

/** JSON schema the Agent SDK validates against; derived from the zod schema so there is one source of truth. */
export function outputJsonSchema(taskType: TaskType): Record<string, unknown> {
  const schema = taskType === "plan_week" ? PlanOutputSchema : AgentOutputSchema;
  return z.toJSONSchema(schema) as Record<string, unknown>;
}
