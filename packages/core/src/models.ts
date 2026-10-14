/**
 * Model routing. The only place model IDs may appear in the codebase.
 *
 * Aliases map a job shape to a model so that cost/quality tuning is a one-line
 * change. Agent role YAML files reference aliases, never IDs.
 */
export const MODEL_ALIASES = ["planner", "coder", "drafter", "classifier"] as const;
export type ModelAlias = (typeof MODEL_ALIASES)[number];

export const MODEL_ROUTING: Readonly<Record<ModelAlias, string>> = Object.freeze({
  planner: "claude-opus-5-5",
  coder: "claude-opus-5-5",
  drafter: "claude-sonnet-5-5",
  classifier: "claude-haiku-5-5",
});

export const EFFORT_BY_ALIAS: Readonly<Record<ModelAlias, "low" | "medium" | "high" | "xhigh">> =
  Object.freeze({
    planner: "high",
    coder: "xhigh",
    drafter: "medium",
    classifier: "low",
  });

export function isModelAlias(value: string): value is ModelAlias {
  return (MODEL_ALIASES as readonly string[]).includes(value);
}

/** Resolves an alias to a concrete model ID; throws on unknown alias. */
export function resolveModel(alias: string): string {
  if (!isModelAlias(alias)) {
    throw new Error(`Unknown model alias "${alias}". Known: ${MODEL_ALIASES.join(", ")}`);
  }
  return MODEL_ROUTING[alias];
}
