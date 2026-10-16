// The in-process MCP tool every role may call: `memory_search` (server "north").
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { stripDelimiters } from "../prompts/build";
import type { AgentRunInput } from "./types";

/** Most characters of one hit's content a run receives (the cut is marked with a closing ellipsis). */
export const MEMORY_HIT_MAX_CHARS = 1200;
/** Most characters of the joined hits inside `<memory_results>`; the wrapper tags come on top. */
export const MEMORY_RESULT_MAX_CHARS = 6000;
/** Last thing in the results body when the cap cut off hits or part of one. */
export const MEMORY_RESULTS_TRUNCATION_MARKER = "…[memory results truncated]";

const HIT_ELLIPSIS = "…";
const NO_MATCH = "No matching memory.";

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

/** Cuts `text` to at most `max` characters, ending in `ending` when it had to cut; never leaves half a surrogate pair. */
function clip(text: string, max: number, ending: string): string {
  if (text.length <= max) return text;
  let end = Math.max(0, max - ending.length);
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return text.slice(0, end) + ending;
}

function renderHit(hit: MemoryHit): string {
  const kind = stripDelimiters(hit.kind);
  const department = stripDelimiters(hit.department ?? "").trim() || "company";
  const content = clip(stripDelimiters(hit.content), MEMORY_HIT_MAX_CHARS, HIT_ELLIPSIS);
  return `## ${stripDelimiters(hit.title)} (${kind}, ${department})\n${content}`;
}

/**
 * Renders search hits as one bounded data block (LRN-6): `<memory_results>` ... `</memory_results>`, each hit as
 * `## title (kind, department)` plus its content. Every field passes through `stripDelimiters`, so memory text
 * cannot close the block or a `<company_memory>` section; a hit's content is cut at `MEMORY_HIT_MAX_CHARS`, the
 * joined body at `MEMORY_RESULT_MAX_CHARS` (ending in `MEMORY_RESULTS_TRUNCATION_MARKER`). The body is cut,
 * never the wrapped string, so the closing tag is always present.
 */
export function renderMemoryHits(hits: readonly MemoryHit[]): string {
  const joined = hits.length === 0 ? NO_MATCH : hits.map(renderHit).join("\n\n");
  const body = clip(joined, MEMORY_RESULT_MAX_CHARS, MEMORY_RESULTS_TRUNCATION_MARKER);
  return `<memory_results>\n${body}\n</memory_results>`;
}

/** In-process MCP tool: searches company memory through the host callback; errors come back as tool errors, never throws. */
export function memorySearchTool(input: AgentRunInput, deps: MemoryToolDeps) {
  return tool(
    "memory_search",
    "Search this company's memory (thesis, personas, decisions, learnings, docs). Returns the best matching items as text.",
    { query: z.string().min(1).max(500) },
    async ({ query: text }) => {
      try {
        const hits = await deps.memorySearch(input.companyId, text);
        return { content: [{ type: "text" as const, text: renderMemoryHits(hits) }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text" as const, text: `memory_search failed: ${message}` }], isError: true };
      }
    },
    { annotations: { readOnlyHint: true, openWorldHint: false } },
  );
}
