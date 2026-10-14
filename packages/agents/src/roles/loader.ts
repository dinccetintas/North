import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { REQUIRED_ROLES, RoleDefinitionSchema, type RoleDefinition } from "./schema.js";

export class RoleConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoleConfigError";
  }
}

/** Parses one YAML document into a validated role definition. */
export function parseRoleYaml(source: string, fileName = "<inline>"): RoleDefinition {
  const parsed = RoleDefinitionSchema.safeParse(parse(source));
  if (!parsed.success) {
    throw new RoleConfigError(`${fileName}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  return Object.freeze(parsed.data);
}

/**
 * Loads every `*.yaml` in a directory and checks that all required roles exist
 * exactly once. Returns a frozen map keyed by role name.
 */
export async function loadRoles(dir: string): Promise<ReadonlyMap<string, RoleDefinition>> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  const entries = await Promise.all(
    files.map(async (file) => parseRoleYaml(await readFile(join(dir, file), "utf8"), file)),
  );
  const roles = new Map<string, RoleDefinition>();
  for (const role of entries) {
    if (roles.has(role.role)) throw new RoleConfigError(`Duplicate role "${role.role}"`);
    roles.set(role.role, role);
  }
  const missing = REQUIRED_ROLES.filter((r) => !roles.has(r));
  if (missing.length > 0) throw new RoleConfigError(`Missing roles: ${missing.join(", ")}`);
  return roles;
}
