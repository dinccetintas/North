import { describe, expect, it } from "vitest";
import { SUBPROCESS_ENV_ALLOWLIST, companyConfigDir, defaultConfigRoot, minimalSubprocessEnv, npmCacheDir, subprocessEnvFor } from "../src/runtime/subprocess-env";

const COMPANY = "0b9f2c1e-7a34-4d58-9e61-2f5c8a1d3b70";
const GATEWAY = "http://127.0.0.1:4310";

describe("SEC-2 subprocess env", () => {
  it("never passes the real key, pins HOME and CLAUDE_CONFIG_DIR per company, points at the gateway", () => {
    const env = subprocessEnvFor({ PATH: "/bin", ANTHROPIC_API_KEY: "sk-ant-real" }, { companyId: "c1", configRoot: "/data/agent-config", gatewayBaseUrl: GATEWAY });
    expect(env.ANTHROPIC_API_KEY).toBe("north-gateway");
    expect(env.ANTHROPIC_BASE_URL).toBe(GATEWAY);
    expect(env.HOME).toBe("/data/agent-config/c1");
    expect(env.CLAUDE_CONFIG_DIR).toBe("/data/agent-config/c1");
    expect(env.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe("1");
    expect(JSON.stringify(env)).not.toContain("sk-ant-real");
  });

  it("the allow-list no longer carries the key, the oauth token or HOME", () => {
    expect(SUBPROCESS_ENV_ALLOWLIST).not.toContain("ANTHROPIC_API_KEY");
    expect(SUBPROCESS_ENV_ALLOWLIST).not.toContain("CLAUDE_CODE_OAUTH_TOKEN");
    expect(SUBPROCESS_ENV_ALLOWLIST).not.toContain("HOME");
  });

  it("minimalSubprocessEnv keeps only the allow-listed, non-empty variables", () => {
    const env = minimalSubprocessEnv({ PATH: "/bin", HOME: "/root", LANG: "", ANTHROPIC_API_KEY: "sk-ant-real", CLAUDE_CODE_OAUTH_TOKEN: "oauth", SUPABASE_SERVICE_ROLE_KEY: "srv", TMPDIR: "/tmp" });
    expect(env).toEqual({ PATH: "/bin", TMPDIR: "/tmp" });
    expect(Object.isFrozen(env)).toBe(true);
  });

  it("caps subagent depth, drops the oauth token and overrides a HOME the base carried", () => {
    const env = subprocessEnvFor({ PATH: "/bin", HOME: "/root", CLAUDE_CODE_OAUTH_TOKEN: "oauth-real" }, { companyId: COMPANY, configRoot: "/data/agent-config", gatewayBaseUrl: GATEWAY });
    expect(env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH).toBe("1");
    expect(env.HOME).toBe(`/data/agent-config/${COMPANY}`);
    expect(env.PATH).toBe("/bin");
    expect(JSON.stringify(env)).not.toContain("oauth-real");
  });

  it("returns a frozen copy and leaves the base untouched", () => {
    const base = Object.freeze({ PATH: "/bin" });
    const env = subprocessEnvFor(base, { companyId: "c1", configRoot: "/r", gatewayBaseUrl: GATEWAY });
    expect(Object.isFrozen(env)).toBe(true);
    expect(base).toEqual({ PATH: "/bin" });
  });

  it("without a gateway the host key passes through and the exposure is warned once", () => {
    const warnings: string[] = [];
    const env = subprocessEnvFor({ PATH: "/bin" }, { companyId: "c1", configRoot: "/r", hostKey: "sk-ant-host", warn: (m) => warnings.push(m) });
    expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-host");
    expect(env).not.toHaveProperty("ANTHROPIC_BASE_URL");
    expect(env.HOME).toBe("/r/c1");
    expect(warnings).toEqual(["no model gateway configured: the model key is exposed to the agent subprocess"]);
  });

  it("without a gateway and without a key there is nothing to expose and nothing to warn about", () => {
    const warnings: string[] = [];
    const env = subprocessEnvFor({ PATH: "/bin" }, { companyId: "c1", configRoot: "/r", hostKey: "", warn: (m) => warnings.push(m) });
    expect(env).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(warnings).toEqual([]);
  });

  it("refuses a gateway that is not a URL instead of handing the subprocess a broken base", () => {
    expect(() => subprocessEnvFor({ PATH: "/bin" }, { companyId: "c1", configRoot: "/r", gatewayBaseUrl: "not a url" })).toThrow(/gateway URL/);
  });

  it("a key the base already carries counts as the host key when no gateway is set", () => {
    const warnings: string[] = [];
    const env = subprocessEnvFor({ PATH: "/bin", ANTHROPIC_API_KEY: "sk-ant-base" }, { companyId: "c1", configRoot: "/r", warn: (m) => warnings.push(m) });
    expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-base");
    expect(warnings).toHaveLength(1);
  });

  it("never warns when a gateway is configured", () => {
    const warnings: string[] = [];
    subprocessEnvFor({ PATH: "/bin" }, { companyId: "c1", configRoot: "/r", gatewayBaseUrl: GATEWAY, hostKey: "sk-ant-host", warn: (m) => warnings.push(m) });
    expect(warnings).toEqual([]);
  });
});

describe("SEC-1 subprocess env: npm cache, gateway mode and the empty gateway", () => {
  it("pins npm_config_cache into the company's own dir, whatever the base carried", () => {
    const env = subprocessEnvFor({ PATH: "/bin", npm_config_cache: "/root/.npm" }, { companyId: "c1", configRoot: "/data/agent-config", gatewayBaseUrl: GATEWAY });
    expect(env.npm_config_cache).toBe("/data/agent-config/c1/npm-cache");
    expect(npmCacheDir("/data/agent-config/c1")).toBe("/data/agent-config/c1/npm-cache");
    const noGateway = subprocessEnvFor({ PATH: "/bin" }, { companyId: "c1", configRoot: "/data/agent-config", hostKey: "", warn: () => undefined });
    expect(noGateway.npm_config_cache).toBe("/data/agent-config/c1/npm-cache");
  });

  it("F3 an empty gateway URL reaches the URL check and throws, instead of falling back to the host key", () => {
    const warnings: string[] = [];
    expect(() => subprocessEnvFor({ PATH: "/bin" }, { companyId: "c1", configRoot: "/r", gatewayBaseUrl: "", hostKey: "sk-ant-host", warn: (m) => warnings.push(m) })).toThrow(/gateway URL/);
    expect(warnings).toEqual([]);
  });

  it("F4 in gateway mode the base is cut down to the allow-list, so a caller-supplied provider switch or secret never reaches the subprocess", () => {
    const base = {
      PATH: "/bin",
      LANG: "en_US.UTF-8",
      CLAUDE_CODE_USE_BEDROCK: "1",
      ANTHROPIC_CUSTOM_HEADERS: "x-api-key: sk-ant-real",
      AWS_SECRET_ACCESS_KEY: "aws-secret",
      HTTPS_PROXY: "http://proxy:3128",
    };
    const env = subprocessEnvFor(base, { companyId: "c1", configRoot: "/r", gatewayBaseUrl: GATEWAY });
    for (const name of ["CLAUDE_CODE_USE_BEDROCK", "ANTHROPIC_CUSTOM_HEADERS", "AWS_SECRET_ACCESS_KEY", "HTTPS_PROXY"]) expect(env, name).not.toHaveProperty(name);
    expect(JSON.stringify(env)).not.toMatch(/sk-ant-real|aws-secret/);
    expect(env).toMatchObject({ PATH: "/bin", LANG: "en_US.UTF-8", ANTHROPIC_BASE_URL: GATEWAY, ANTHROPIC_API_KEY: "north-gateway", HOME: "/r/c1" });
    expect(Object.keys(base)).toHaveLength(6);
  });

  it("F4 in gateway mode an allow-listed variable with an empty value stays out, as in minimalSubprocessEnv", () => {
    const env = subprocessEnvFor({ PATH: "/bin", LANG: "" }, { companyId: "c1", configRoot: "/r", gatewayBaseUrl: GATEWAY });
    expect(env).not.toHaveProperty("LANG");
  });

  it("F4 without a gateway the base still passes through unchanged (the pre-gateway fallback)", () => {
    const env = subprocessEnvFor({ PATH: "/bin", CUSTOM: "kept" }, { companyId: "c1", configRoot: "/r", hostKey: "", warn: () => undefined });
    expect(env.CUSTOM).toBe("kept");
  });
});

describe("SEC-2 companyConfigDir", () => {
  it("joins the root and a uuid or a short slug", () => {
    expect(companyConfigDir("/data/agent-config", COMPANY)).toBe(`/data/agent-config/${COMPANY}`);
    expect(companyConfigDir("/data/agent-config", "company-1")).toBe("/data/agent-config/company-1");
    expect(companyConfigDir("/data/agent-config", "a".repeat(64))).toBe(`/data/agent-config/${"a".repeat(64)}`);
  });

  it.each(["", "..", "../etc", "a/b", "a\\b", "/abs", "c1/../../x", "has space", "dot.dot", "a".repeat(65), "c1\0"])("refuses the crafted id %j", (id) => {
    expect(() => companyConfigDir("/data/agent-config", id)).toThrow(/company id/);
  });
});

describe("SEC-2 defaultConfigRoot", () => {
  it("is agent-config next to the workspace root", () => {
    expect(defaultConfigRoot("/data/workspaces")).toBe("/data/agent-config");
  });
});
