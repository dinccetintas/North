import { mockScripts } from "../fixtures/index";
import { ClaudeAgentSdkRuntime, type ClaudeAgentSdkDeps } from "./claude-agent-sdk";
import { MockRuntime } from "./mock";
import type { AgentRuntime } from "./types";

/** Env value that switches on the live Agent SDK runtime. */
export const LIVE_RUNTIME = "claude-agent-sdk";

/**
 * Picks the runtime from the environment: the fixture-backed `MockRuntime`
 * unless `AGENT_RUNTIME=claude-agent-sdk`, in which case the live adapter.
 */
export function selectRuntime(deps: ClaudeAgentSdkDeps, env: NodeJS.ProcessEnv = process.env): AgentRuntime {
  return env.AGENT_RUNTIME === LIVE_RUNTIME ? new ClaudeAgentSdkRuntime(deps) : MockRuntime.fromRecord(mockScripts);
}
