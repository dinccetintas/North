import type { RoleDefinition } from "../roles/schema";

/** In-process MCP tool every role may call (server "north", tool "memory_search"). */
export const MEMORY_SEARCH_TOOL = "mcp__north__memory_search";

/** Built-in Agent SDK tools that write or execute; denied for every role except engineering. */
export const MUTATING_BUILTIN_TOOLS: readonly string[] = Object.freeze(["Bash", "Write", "Edit", "MultiEdit", "NotebookEdit"]);

/** Role YAML tool names mapped to the Agent SDK built-in tools they unlock. */
const BUILTIN_BY_ROLE_TOOL: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "web.search": ["WebSearch"],
  "web.fetch": ["WebFetch"],
  "fs.read": ["Read", "Glob", "Grep"],
  "fs.write": ["Write"],
  "fs.edit": ["Edit", "MultiEdit"],
  bash: ["Bash"],
  "tests.run": ["Bash"],
});

const ENGINEERING_ROLE = "engineering";

const unique = (values: readonly string[]): readonly string[] => Object.freeze([...new Set(values)]);

/**
 * Tools the Agent SDK may auto-approve for this role: memory search for all,
 * plus the built-ins its YAML tool list unlocks. Mutating built-ins are only
 * unlocked for engineering, whatever the YAML says.
 */
export function allowedToolsFor(role: RoleDefinition): readonly string[] {
  const unlocked = role.tools.flatMap((name) => BUILTIN_BY_ROLE_TOOL[name] ?? []);
  const permitted = role.role === ENGINEERING_ROLE ? unlocked : unlocked.filter((t) => !MUTATING_BUILTIN_TOOLS.includes(t));
  return unique([MEMORY_SEARCH_TOOL, ...permitted]);
}

/** Tools blocked outright; empty for engineering, the mutating built-ins for everyone else. */
export function disallowedToolsFor(role: RoleDefinition): readonly string[] {
  return role.role === ENGINEERING_ROLE ? Object.freeze([]) : MUTATING_BUILTIN_TOOLS;
}
