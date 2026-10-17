import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { buildQueryOptions, GATEWAY_PLACEHOLDER_KEY, loadRoles, selectLlm, selectRuntime, type AnthropicClientOptions, type ClaudeAgentSdkDeps } from "@north/agents";
import type { DbClient } from "@north/db";
import { z } from "zod";
import { workerEnv } from "../src/env";
import type { Gateway, GatewayOptions } from "../src/gateway/server";
import { NO_TRACER } from "../src/observability";
import { nullEmbedder } from "../src/services/embedder";
import { buildRuntimeDeps, type RuntimeDepsOptions } from "../src/services/runtime-deps";
import { completion, fakeUpstream } from "./gateway-helpers";

/**
 * SEC-1 / TST-1: the worker starts the model gateway when it runs the Agent
 * SDK and points every model call of the process at it: the agent subprocess
 * (gateway URL, placeholder key) and the single-call LLM client. The real key
 * goes to the gateway and nowhere else. The mock runtime starts nothing.
 */

const KEY = "sk-ant-api03-the-real-key-for-tests";
const AGENTS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../agents");
const base = { SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: "service-role-key-xyz", AGENTS_DIR };
const sdkEnv = (extra: Record<string, string | undefined> = {}) =>
  workerEnv({
    ...base,
    AGENT_RUNTIME: "claude-agent-sdk",
    ANTHROPIC_API_KEY: KEY,
    NORTH_ENV: "staging",
    NORTH_MODEL_PROFILE: "smoke",
    NORTH_CASSETTE_MODE: "record",
    NORTH_CASSETTE_DIR: "/tmp/north-cassettes",
    NORTH_DAILY_CAP_USD: "0.5",
    AGENT_CONFIG_ROOT: "/tmp/north-agent-config",
    WORKSPACE_ROOT: "/tmp/north-workspaces",
    ...extra,
  } as NodeJS.ProcessEnv);

const db = {} as DbClient;
const silent = (): void => undefined;
const HOST_ENV = { PATH: "/usr/bin", ANTHROPIC_API_KEY: KEY, SUPABASE_SERVICE_ROLE_KEY: "service-role-key-xyz", ANTHROPIC_BASE_URL: "https://elsewhere.example" };
const roles = await loadRoles(AGENTS_DIR);

/** Seams that record what `buildRuntimeDeps` hands to the gateway, the runtime and the LLM client, without starting a server. */
function recordingSeams(extra: Partial<RuntimeDepsOptions> = {}) {
  const gatewayOptions: GatewayOptions[] = [];
  const spendReads: string[] = [];
  const runtimeDeps: ClaudeAgentSdkDeps[] = [];
  const llmClients: AnthropicClientOptions[] = [];
  const llmCalls: Array<Parameters<typeof selectLlm>> = [];
  const fakeGateway: Gateway = { baseUrl: "http://127.0.0.1:4999", close: vi.fn(async () => undefined), stats: () => ({ requests: 0, spentUsd: 0, misses: 0, unpriced: 0, capUsd: 0.5, exhausted: false, seededUsd: 0 }) };
  const options: RuntimeDepsOptions = {
    roles,
    clock: () => new Date("2026-03-01T10:00:00Z"),
    embedder: nullEmbedder,
    hostEnv: HOST_ENV,
    startGateway: async (opts) => (gatewayOptions.push(opts), fakeGateway),
    readSpentSince: async (since) => (spendReads.push(since), 0),
    selectRuntime: (deps, env) => (runtimeDeps.push(deps), selectRuntime(deps, env)),
    selectLlm: (env, mock, opts) => {
      llmCalls.push([env, mock, opts]);
      return selectLlm(env, mock, { ...opts, createApi: (client) => (llmClients.push(client), { create: async () => Promise.reject(new Error("not called")) }) });
    },
    ...extra,
  };
  return { options, gatewayOptions, spendReads, runtimeDeps, llmClients, llmCalls, fakeGateway };
}

describe("SEC-1 buildRuntimeDeps with the Agent SDK runtime", () => {
  it("SEC-1 starts the gateway with the real key, the mapped mode, the cassette dir and the day's cap on the worker clock", async () => {
    const seams = recordingSeams();
    const result = await buildRuntimeDeps(sdkEnv(), db, NO_TRACER, silent, seams.options);
    expect(seams.gatewayOptions).toHaveLength(1);
    const [opts] = seams.gatewayOptions as [GatewayOptions];
    expect(opts).toMatchObject({ apiKey: KEY, upstream: "https://api.anthropic.com", mode: "record", cassetteDir: "/tmp/north-cassettes", log: silent });
    expect(opts.budget.stats()).toMatchObject({ capUsd: 0.5, spentUsd: 0, day: "2026-03-01" });
    expect(result.gateway).toMatchObject({ baseUrl: "http://127.0.0.1:4999", mode: "record" });
    expect(result.runtime.name).toBe("claude-agent-sdk");
  });

  it("TST-2 maps NORTH_CASSETTE_MODE off to the gateway's live mode, and takes ANTHROPIC_BASE_URL as the upstream", async () => {
    const seams = recordingSeams();
    await buildRuntimeDeps(sdkEnv({ NORTH_CASSETTE_MODE: "off", ANTHROPIC_BASE_URL: "http://127.0.0.1:9" }), db, NO_TRACER, silent, seams.options);
    expect(seams.gatewayOptions[0]).toMatchObject({ mode: "live", upstream: "http://127.0.0.1:9" });
  });

  it("SEC-1 the runtime deps carry the gateway, profile, config root, deny-read paths and a session port; the subprocess env holds no real key", async () => {
    const seams = recordingSeams();
    const env = sdkEnv();
    await buildRuntimeDeps(env, db, NO_TRACER, silent, seams.options);
    const [deps] = seams.runtimeDeps as [ClaudeAgentSdkDeps];
    expect(deps).toMatchObject({ gatewayBaseUrl: "http://127.0.0.1:4999", profile: "smoke", configRoot: "/tmp/north-agent-config", workspaceRoot: "/tmp/north-workspaces", warn: silent });
    expect(deps.sandboxDenyRead).toEqual([process.cwd(), resolve(AGENTS_DIR, "..")]);
    expect(typeof deps.sessionEntries?.append).toBe("function");
    expect(typeof deps.sessionEntries?.read).toBe("function");
    expect(typeof deps.sessionEntries?.companyOf).toBe("function");
    expect(deps.subprocessEnv).toEqual({ PATH: "/usr/bin" });

    const role = roles.get("engineering");
    if (!role) throw new Error("engineering role missing");
    const input = { companyId: "company-1", taskId: "task-1", role: "engineering", taskType: "build_site", instructions: "Build it.", memoryDigest: "", workspaceDir: "/tmp/north-workspaces/task-1", outputSchema: {} };
    const options = buildQueryOptions(input, role, deps);
    expect(options.env).toMatchObject({ ANTHROPIC_BASE_URL: "http://127.0.0.1:4999", ANTHROPIC_API_KEY: GATEWAY_PLACEHOLDER_KEY, PATH: "/usr/bin" });
    expect(JSON.stringify(options.env)).not.toContain(KEY);
    expect(JSON.stringify(options.env)).not.toContain("elsewhere.example");
    expect(options.sandbox?.filesystem?.denyRead).toEqual(expect.arrayContaining([process.cwd(), resolve(AGENTS_DIR, "..")]));
  });

  it("TST-1 the single-call LLM client goes through the gateway with the placeholder key and the profile", async () => {
    const seams = recordingSeams();
    const result = await buildRuntimeDeps(sdkEnv(), db, NO_TRACER, silent, seams.options);
    expect(result.llm.name).toBe("anthropic");
    expect(seams.llmClients).toEqual([{ baseURL: "http://127.0.0.1:4999", apiKey: GATEWAY_PLACEHOLDER_KEY }]);
    const [env, , opts] = seams.llmCalls[0] ?? [];
    expect(env).toEqual({ AGENT_RUNTIME: "claude-agent-sdk", ANTHROPIC_API_KEY: GATEWAY_PLACEHOLDER_KEY });
    expect(opts).toMatchObject({ baseURL: "http://127.0.0.1:4999", apiKey: GATEWAY_PLACEHOLDER_KEY, profile: "smoke" });
    expect(JSON.stringify(seams.llmCalls)).not.toContain(KEY);
  });

  it("SEC-1 replay never hands the gateway the key, even when the env has one (least privilege)", async () => {
    const seams = recordingSeams();
    await buildRuntimeDeps(sdkEnv({ NORTH_CASSETTE_MODE: "replay" }), db, NO_TRACER, silent, seams.options);
    expect(seams.gatewayOptions[0]).toMatchObject({ mode: "replay", apiKey: null });
    expect(JSON.stringify(seams.gatewayOptions[0])).not.toContain(KEY);
  });

  it("TST-2 replay starts without a key (a real gateway on loopback), and closes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "north-runtime-deps-"));
    try {
      const env = sdkEnv({ ANTHROPIC_API_KEY: undefined, NORTH_CASSETTE_MODE: "replay", NORTH_CASSETTE_DIR: dir });
      const result = await buildRuntimeDeps(env, db, NO_TRACER, silent, { roles, clock: () => new Date(), embedder: nullEmbedder, hostEnv: HOST_ENV, readSpentSince: async () => 0 });
      expect(result.gateway?.mode).toBe("replay");
      expect(result.gateway?.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(result.gateway?.stats()).toMatchObject({ requests: 0, capUsd: 0.5, exhausted: false });
      await result.gateway?.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("TST-1 end to end: a structured call reaches the upstream through the gateway, which injects the real key and prices it", async () => {
    const upstream = await fakeUpstream();
    upstream.handler = (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(completion("claude-haiku-5-5", { input_tokens: 1000, output_tokens: 200 }, '{"answer":4}'));
    };
    const env = sdkEnv({ NORTH_CASSETTE_MODE: "off", ANTHROPIC_BASE_URL: upstream.url, NORTH_DAILY_CAP_USD: "1" });
    const result = await buildRuntimeDeps(env, db, NO_TRACER, silent, { roles, clock: () => new Date(), embedder: nullEmbedder, hostEnv: HOST_ENV, readSpentSince: async () => 0 });
    try {
      expect(await result.llm.structured({ schema: z.object({ answer: z.number() }), system: "s", user: "2+2?", model: "classifier" })).toEqual({ answer: 4 });
      expect(upstream.seen).toHaveLength(1);
      expect(upstream.seen[0]?.headers["x-api-key"]).toBe(KEY);
      expect(result.gateway?.stats()).toMatchObject({ requests: 1, capUsd: 1, unpriced: 0 });
      expect(result.gateway?.stats().spentUsd).toBeGreaterThan(0);
    } finally {
      await result.gateway?.close();
      await upstream.close();
    }
  });
});

describe("STG-1 the gateway's day cap survives a restart: the budget is seeded at boot", () => {
  const BOOT = "2026-03-01T00:00:00.000Z";

  it("STG-1 seeds the budget with the ledger's spend since the start of the worker clock's UTC day", async () => {
    const seams = recordingSeams({ readSpentSince: async (since) => (seams.spendReads.push(since), 0.2) });
    const logs: string[] = [];
    await buildRuntimeDeps(sdkEnv(), db, NO_TRACER, (m) => logs.push(m), seams.options);
    expect(seams.spendReads).toEqual([BOOT]);
    expect(logs).toEqual([`gateway: $0.2000 spent since ${BOOT} (agent_runs) counts against today's $0.5 cap`]);
    expect(seams.gatewayOptions[0]?.budget.stats()).toMatchObject({ capUsd: 0.5, spentUsd: 0.2, seededUsd: 0.2, day: "2026-03-01" });
  });

  it("STG-1 a failed read (or an answer that is not a cost) fails closed: the day counts as spent (the full cap), nothing is admitted, and it is logged", async () => {
    const seams = recordingSeams({ readSpentSince: async () => Promise.reject(new Error("db unreachable")) });
    const logs: string[] = [];
    await buildRuntimeDeps(sdkEnv(), db, NO_TRACER, (m) => logs.push(m), seams.options);
    const budget = seams.gatewayOptions[0]?.budget;
    expect(budget?.stats()).toMatchObject({ capUsd: 0.5, spentUsd: 0.5, seededUsd: 0.5 });
    expect(budget?.reserve(0)).toBe(false);
    expect(logs.join("\n")).toMatch(/could not read today's spend.*db unreachable.*full cap/);
    for (const answer of [Number.NaN, -1]) {
      const odd = recordingSeams({ readSpentSince: async () => answer });
      await buildRuntimeDeps(sdkEnv(), db, NO_TRACER, silent, odd.options);
      expect(odd.gatewayOptions[0]?.budget.stats()).toMatchObject({ spentUsd: 0.5, seededUsd: 0.5 });
    }
  });

  it("STG-1 with no cap (0) nothing is read and nothing is seeded", async () => {
    const seams = recordingSeams();
    await buildRuntimeDeps(sdkEnv({ NORTH_DAILY_CAP_USD: "0" }), db, NO_TRACER, silent, seams.options);
    expect(seams.spendReads).toEqual([]);
    expect(seams.gatewayOptions[0]?.budget.stats()).toMatchObject({ capUsd: 0, spentUsd: 0, seededUsd: 0 });
  });

  it("STG-1 by default the seed is read from agent_runs since the day's start, through the db", async () => {
    const queries: Array<{ table: string; gte: [string, string] }> = [];
    const pages = [[{ id: "a", cost_usd: "0.125" }, { id: "b", cost_usd: 0.25 }], []];
    const fakeDb = {
      from: (table: string) => ({
        select: () => ({
          gte: (column: string, value: string) => ({
            order: () => ({ range: async () => (queries.push({ table, gte: [column, value] }), { data: pages.shift() ?? [], error: null }) }),
          }),
        }),
      }),
    } as unknown as DbClient;
    const seams = recordingSeams();
    await buildRuntimeDeps(sdkEnv(), fakeDb, NO_TRACER, silent, { roles, clock: () => new Date("2026-03-01T10:00:00Z"), embedder: nullEmbedder, hostEnv: HOST_ENV, startGateway: async (opts) => (seams.gatewayOptions.push(opts), seams.fakeGateway) });
    expect(queries[0]).toEqual({ table: "agent_runs", gte: ["created_at", BOOT] });
    expect(seams.gatewayOptions[0]?.budget.stats()).toMatchObject({ spentUsd: 0.375, seededUsd: 0.375 });
  });
});

describe("LRN-7 the runtime's memory search embeds the query", () => {
  const COMPANY = "11111111-1111-4111-8111-111111111111";
  const vector = Array.from({ length: 384 }, () => 0.5);
  const rpcDb = () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const fake = { rpc: async (name: string, args: Record<string, unknown>) => (calls.push({ name, args }), { data: [], error: null }) } as unknown as DbClient;
    return { fake, calls };
  };

  it("LRN-7 searches hybrid with the embedder's vector, and by words when the embedder has none", async () => {
    for (const [embedder, rpc] of [[{ embed: async () => vector }, "search_memory_hybrid"], [nullEmbedder, "search_memory"]] as const) {
      const { fake, calls } = rpcDb();
      const seams = recordingSeams({ embedder });
      await buildRuntimeDeps(sdkEnv(), fake, NO_TRACER, silent, seams.options);
      expect(await seams.runtimeDeps[0]?.memorySearch(COMPANY, "pricing interviews")).toEqual([]);
      expect(calls.map((c) => c.name)).toEqual([rpc]);
      expect(calls[0]?.args).toMatchObject({ p_company_id: COMPANY, p_query: "pricing interviews" });
    }
  });
});

describe("SEC-1 buildRuntimeDeps with the mock runtime", () => {
  it("SEC-1 starts no gateway; the runtime and the LLM client are the mocks", async () => {
    const seams = recordingSeams();
    const result = await buildRuntimeDeps(workerEnv(base as NodeJS.ProcessEnv), db, NO_TRACER, silent, seams.options);
    expect(seams.gatewayOptions).toEqual([]);
    expect(seams.spendReads).toEqual([]);
    expect(result.gateway).toBeNull();
    expect(result.runtime.name).toBe("mock");
    expect(result.llm.name).toBe("mock");
    expect(seams.llmClients).toEqual([]);
  });

  it("SEC-1 a gateway that started is closed again when the rest of the assembly fails", async () => {
    const seams = recordingSeams({
      selectRuntime: () => {
        throw new Error("runtime refused");
      },
    });
    await expect(buildRuntimeDeps(sdkEnv(), db, NO_TRACER, silent, seams.options)).rejects.toThrow("runtime refused");
    expect(seams.fakeGateway.close).toHaveBeenCalledTimes(1);
  });

  it("SEC-1 a close that fails during that clean-up is logged, and the original error is the one thrown", async () => {
    const seams = recordingSeams({
      selectRuntime: () => {
        throw new Error("runtime refused");
      },
    });
    vi.mocked(seams.fakeGateway.close).mockRejectedValueOnce(new Error("close failed"));
    const logs: string[] = [];
    await expect(buildRuntimeDeps(sdkEnv(), db, NO_TRACER, (m) => logs.push(m), seams.options)).rejects.toThrow("runtime refused");
    expect(seams.fakeGateway.close).toHaveBeenCalledTimes(1);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/gateway.*close.*close failed/i);
  });
});
