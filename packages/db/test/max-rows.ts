import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/types";
import type { Client } from "./fixtures";
import { localSupabaseEnv } from "./env";

/**
 * PostgREST's `max_rows` (1000 in `supabase/config.toml`, the hosted default)
 * as a fetch wrapper: a GET on `/rest/v1/` that returns more rows is cut to
 * the first 1000, as hosted Supabase cuts it. The Docker-free stack runs
 * PostgREST without `db-max-rows`, so an unpaged read passes there and loses
 * rows in production; tests that prove paging read through this client.
 */
export const POSTGREST_MAX_ROWS = 1000;

export interface MaxRowsClient {
  readonly client: Client;
  /** The `/rest/v1/<table>` paths whose response was cut (an unpaged read). */
  readonly cut: string[];
  /** Every `limit` a GET asked for (`.range()` sends one), so a test can assert no page exceeds the cap. */
  readonly limits: number[];
}

export function maxRowsServiceClient(): MaxRowsClient {
  const env = localSupabaseEnv();
  const cut: string[] = [];
  const limits: number[] = [];
  const capped: typeof fetch = async (input, init) => {
    const response = await fetch(input, init);
    const url = new URL(input instanceof Request ? input.url : String(input));
    if ((init?.method ?? "GET").toUpperCase() !== "GET" || !url.pathname.startsWith("/rest/v1/")) return response;
    const limit = url.searchParams.get("limit");
    if (limit !== null) limits.push(Number(limit));
    const text = await response.text();
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    let rows: unknown;
    try {
      rows = JSON.parse(text);
    } catch {
      return new Response(text, { status: response.status, headers });
    }
    if (!Array.isArray(rows) || rows.length <= POSTGREST_MAX_ROWS) return new Response(text, { status: response.status, headers });
    cut.push(url.pathname);
    return new Response(JSON.stringify(rows.slice(0, POSTGREST_MAX_ROWS)), { status: response.status, headers });
  };
  const client = createClient<Database>(env.url, env.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: capped } });
  return { client, cut, limits };
}
