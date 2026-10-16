// The in-process MCP tool every role may call: `memory_search` (server "north").
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { AgentRunInput } from "./types";

/** One memory item returned by the host's search. */
export interface MemoryHit {
  readonly title: string;
  readonly content: string;
  readonly kind: string;
  /** The staff department the item belongs to; null for company-wide memory (the shape `@north/db` returns). */
  readonly department?: string | null;
}

/** What the tool needs from the host: the memory search callback. */
export interface MemoryToolDeps {
  readonly memorySearch: (companyId: string, query: string) => Promise<readonly MemoryHit[]>;
}

const renderHits = (hits: readonly MemoryHit[]): string =>
  hits.length === 0 ? "No matching memory." : hits.map((h) => `## ${h.title} (${h.kind})\n${h.content}`).join("\n\n");

/** In-process MCP tool: searches company memory through the host callback; errors come back as tool errors, never throws. */
export function memorySearchTool(input: AgentRunInput, deps: MemoryToolDeps) {
  return tool(
    "memory_search",
    "Search this company's memory (thesis, personas, decisions, learnings, docs). Returns the best matching items as text.",
    { query: z.string().min(1).max(500) },
    async ({ query: text }) => {
      try {
        const hits = await deps.memorySearch(input.companyId, text);
        return { content: [{ type: "text" as const, text: renderHits(hits) }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text" as const, text: `memory_search failed: ${message}` }], isError: true };
      }
    },
    { annotations: { readOnlyHint: true, openWorldHint: false } },
  );
}
