import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadRoles, parseRoleYaml, RoleConfigError } from "../src/roles/loader.js";
import { REQUIRED_ROLES } from "../src/roles/schema.js";
import { tierWithin } from "@north/core";

const here = dirname(fileURLToPath(import.meta.url));
const AGENTS_DIR = resolve(here, "../../../agents");

describe("agents/*.yaml role definitions", () => {
  it("loads all eight required roles from the repo", async () => {
    const roles = await loadRoles(AGENTS_DIR);
    for (const name of REQUIRED_ROLES) expect(roles.has(name)).toBe(true);
    expect(roles.size).toBe(REQUIRED_ROLES.length);
  });

  it("caps tiers as the spec table says", async () => {
    const roles = await loadRoles(AGENTS_DIR);
    expect(roles.get("chief_of_staff")?.max_action_tier).toBe("K1");
    expect(roles.get("research")?.max_action_tier).toBe("K0");
    expect(roles.get("engineering")?.max_action_tier).toBe("K2");
    expect(roles.get("ops_finance")?.max_action_tier).toBe("K1");
    for (const role of roles.values()) expect(tierWithin(role.max_action_tier, "K2")).toBe(true);
  });

  it("rejects invalid definitions with a readable error", () => {
    expect(() => parseRoleYaml("role: Bad Name\n", "bad.yaml")).toThrow(RoleConfigError);
    expect(() => parseRoleYaml("role: x\n", "bad.yaml")).toThrow(/title/);
  });
});
