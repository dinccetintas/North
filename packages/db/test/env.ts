import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface LocalSupabaseEnv {
  readonly url: string;
  readonly anonKey: string;
  readonly serviceRoleKey: string;
}

/**
 * Resolves the local stack's URL and keys from the environment, falling back to
 * `supabase status -o env` so tests run with zero configuration after `pnpm db:start`.
 */
export function localSupabaseEnv(): LocalSupabaseEnv {
  const fromEnv = {
    url: process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  if (fromEnv.url && fromEnv.anonKey && fromEnv.serviceRoleKey) {
    return { url: fromEnv.url, anonKey: fromEnv.anonKey, serviceRoleKey: fromEnv.serviceRoleKey };
  }

  const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const output = execFileSync("npx", ["supabase", "status", "-o", "env"], { cwd: pkgDir, encoding: "utf8" });
  const vars = Object.fromEntries(
    output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.includes("="))
      .map((line) => {
        const [key, ...rest] = line.split("=");
        return [key, rest.join("=").replace(/^"|"$/g, "")];
      }),
  ) as Record<string, string>;

  const url = vars.API_URL;
  const anonKey = vars.ANON_KEY ?? vars.PUBLISHABLE_KEY;
  const serviceRoleKey = vars.SERVICE_ROLE_KEY ?? vars.SECRET_KEY;
  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error(`Could not read local Supabase keys from status output: ${Object.keys(vars).join(", ")}`);
  }
  return { url, anonKey, serviceRoleKey };
}
