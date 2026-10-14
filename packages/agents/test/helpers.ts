import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRoles } from "../src/roles/loader";
import type { RoleDefinition } from "../src/roles/schema";
import type { ClaudeAgentSdkDeps, ToolAuditEntry } from "../src/runtime/claude-agent-sdk";
import type { AgentRunInput } from "../src/runtime/types";

const here = dirname(fileURLToPath(import.meta.url));

/** Repository `agents/` directory holding the role YAML files. */
export const AGENTS_DIR = resolve(here, "../../../agents");

export const SAMPLE_DIGEST = `Company: Lumen Ledger
Thesis: Bookkeeping for solo consultants that closes the month in one click.
Target customer: solo consultants billing $5k-$20k a month`;

/** Task input with realistic memory digest; override any field. */
export function makeInput(overrides: Partial<AgentRunInput> = {}): AgentRunInput {
  return {
    companyId: "company-1",
    taskId: "task-1",
    role: "research",
    taskType: "market_report",
    instructions: "Write the market report for the thesis in memory.",
    memoryDigest: SAMPLE_DIGEST,
    workspaceDir: "/tmp/north-test",
    outputSchema: {},
    ...overrides,
  };
}

export async function loadTestRoles(): Promise<ReadonlyMap<string, RoleDefinition>> {
  return loadRoles(AGENTS_DIR);
}

export function requireRole(roles: ReadonlyMap<string, RoleDefinition>, name: string): RoleDefinition {
  const role = roles.get(name);
  if (!role) throw new Error(`Test setup: role ${name} missing`);
  return role;
}

/** Recording deps: captures audit entries and answers memory searches with one hit. */
export function makeDeps(roles: ReadonlyMap<string, RoleDefinition>, auditLog: ToolAuditEntry[] = []): ClaudeAgentSdkDeps {
  return {
    roles,
    memorySearch: async (_companyId, query) => [{ title: `Hit for ${query}`, content: "content", kind: "learning" }],
    audit: async (entry) => {
      auditLog.push(entry);
    },
    workspaceRoot: "/tmp/north-workspaces",
  };
}
