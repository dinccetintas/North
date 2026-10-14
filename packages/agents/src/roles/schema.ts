import { z } from "zod";
import { MODEL_ALIASES, TIERS } from "@north/core";

/** Schema for `agents/<role>.yaml` (docs/SPEC.md "AI ekip"). */
export const RoleDefinitionSchema = z.object({
  role: z.string().regex(/^[a-z][a-z_]+$/),
  title: z.string().min(1).max(60),
  mission: z.string().min(1).max(400),
  max_action_tier: z.enum(TIERS),
  model: z.enum(MODEL_ALIASES),
  max_turns: z.number().int().min(1).max(500),
  max_budget_usd: z.number().positive().max(100),
  tools: z.array(z.string().regex(/^[a-z][a-z0-9_.]*$/)).min(1),
  outputs: z.array(z.string().min(1)).min(1),
  system_prompt: z.string().min(20),
});
export type RoleDefinition = z.infer<typeof RoleDefinitionSchema>;

export const REQUIRED_ROLES = [
  "chief_of_staff",
  "research",
  "strategy_product",
  "engineering",
  "design",
  "growth",
  "sales",
  "ops_finance",
] as const;
export type RoleName = (typeof REQUIRED_ROLES)[number];
