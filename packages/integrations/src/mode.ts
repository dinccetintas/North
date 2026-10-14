/**
 * ADR 0005: every integration has a `live` and a `sandbox` implementation.
 * Sandbox is the default; live is selected only by explicit configuration.
 */
export const INTEGRATION_MODES = ["sandbox", "live"] as const;
export type IntegrationMode = (typeof INTEGRATION_MODES)[number];

export function integrationMode(env: NodeJS.ProcessEnv = process.env): IntegrationMode {
  const value = env.INTEGRATIONS_MODE;
  return value === "live" ? "live" : "sandbox";
}
