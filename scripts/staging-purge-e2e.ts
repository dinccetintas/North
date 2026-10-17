/**
 * STG-1: the staging e2e purge. The live journey (Task 20) signs up a fresh
 * user per run as `e2e-<stamp>-<project>@staging.<domain>`; this script lists
 * the auth users whose address has that shape and, with `--yes`, purges each
 * through the one delete path (ADR 0016's smoke cleanup: the entitlement is
 * ended with the service role, then the worker's `purgeOwner`, reason `e2e`).
 * Without `--yes` it only prints the list.
 *
 * It refuses to read anything unless `NORTH_ENV=staging` is in its env and
 * the Supabase URL does not contain `NORTH_PRODUCTION_SUPABASE_REF`; with no
 * production ref set it refuses unless `--i-know-this-is-not-production` is
 * passed (fail closed). Service role only: `SUPABASE_URL` and
 * `SUPABASE_SERVICE_ROLE_KEY` of the staging project, from the shell or the
 * CI environment, never a flag. `E2E_MAIL_DOMAIN` (`staging.<domain>`)
 * narrows the match to that host; `WORKSPACE_ROOT` also removes the users'
 * task workspaces when it runs on the worker (`fly ssh console`).
 *
 * Usage: NORTH_ENV=staging NORTH_PRODUCTION_SUPABASE_REF=<prod ref> SUPABASE_URL=<staging url> \
 *          SUPABASE_SERVICE_ROLE_KEY=<staging key> [E2E_MAIL_DOMAIN=staging.<domain>] \
 *          pnpm staging:purge-e2e [-- --yes] [--i-know-this-is-not-production]
 */
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { createServiceClient, type DbClient } from "@north/db";
import { purgeSummary, purgeTestUser } from "./lib/purge-smoke-user";

/** The `purge_log` reason label of every e2e purge. */
export const E2E_PURGE_REASON = "e2e";
/** The operator's explicit word when no production ref is configured to compare with. */
const NOT_PRODUCTION_OPTION = "i-know-this-is-not-production";
export const NOT_PRODUCTION_FLAG = `--${NOT_PRODUCTION_OPTION}`;

type Env = Readonly<Record<string, string | undefined>>;

/** `staging.` and then a domain of two labels or more (`staging.example.com`; never `staging.com`, which is somebody else's). */
const STAGING_HOST = /^staging\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
/** The local part of a per-run address: `e2e-` and then anything but `@` and white space (possibly nothing, as `^e2e-.*@` allows). */
const E2E_LOCAL = /^e2e-[^@\s]*$/;
/** A Supabase project ref (20 lowercase letters today); anything else is refused rather than compared. */
const PROJECT_REF = /^[a-z0-9]{6,64}$/i;

const blankToNull = (value: string | undefined): string | null => {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
};

/**
 * True for an e2e user's address. With `domain` (`E2E_MAIL_DOMAIN`, itself
 * `staging.<domain>`), the host must be exactly that domain; without one
 * (blank counts as unset), any `staging.<domain>` host. The local part starts
 * with `e2e-` (so the inbox `e2e@staging.<domain>` is never a match). One
 * address only, compared in lowercase after trimming; a domain that is not
 * `staging.<domain>` matches nothing.
 */
export function isE2eEmail(email: string, domain?: string): boolean {
  const parts = email.trim().toLowerCase().split("@");
  if (parts.length !== 2) return false;
  const [local = "", host = ""] = parts;
  if (!E2E_LOCAL.test(local) || !STAGING_HOST.test(host)) return false;
  const wanted = blankToNull(domain)?.toLowerCase() ?? null;
  if (wanted === null) return true;
  return STAGING_HOST.test(wanted) && host === wanted;
}

export interface AuthUserRow {
  readonly id: string;
  readonly email: string | null;
}

/** The e2e users among `users` (those with an address `isE2eEmail` accepts), as a new frozen list. */
export function selectE2eUsers(users: readonly AuthUserRow[], domain: string | null | undefined): readonly AuthUserRow[] {
  return Object.freeze(users.filter((u) => u.email !== null && isE2eEmail(u.email, domain ?? undefined)).map((u) => Object.freeze({ ...u })));
}

export interface PurgeFlags {
  readonly yes: boolean;
  readonly notProduction: boolean;
}

export interface GuardVerdict {
  readonly ok: boolean;
  readonly problems: readonly string[];
}

/** The production ref rule: a URL that contains it is refused; no ref at all is refused unless the operator passed the flag. */
function productionProblems(url: string | null, rawRef: string | undefined, flags: Pick<PurgeFlags, "notProduction">): readonly string[] {
  const ref = blankToNull(rawRef);
  if (ref === null) return flags.notProduction ? [] : [`NORTH_PRODUCTION_SUPABASE_REF is not set, so the script cannot tell this project from production: set it, or pass ${NOT_PRODUCTION_FLAG}`];
  if (!PROJECT_REF.test(ref)) return ["NORTH_PRODUCTION_SUPABASE_REF does not look like a Supabase project ref (letters and digits only, as in <ref>.supabase.co)"];
  return url !== null && url.toLowerCase().includes(ref.toLowerCase()) ? ["SUPABASE_URL contains NORTH_PRODUCTION_SUPABASE_REF: this is the production project"] : [];
}

/**
 * Pure: whether the purge may run with this env and these flags. Every
 * problem is listed at once; `ok` only with none. `NORTH_ENV` must be exactly
 * `staging`; `SUPABASE_URL` an http(s) URL; the production ref rule above.
 */
export function purgeGuard(env: Env, flags: Pick<PurgeFlags, "notProduction">): GuardVerdict {
  const problems: string[] = [];
  if (env.NORTH_ENV !== "staging") problems.push(`NORTH_ENV must be staging (it is ${env.NORTH_ENV === undefined ? "unset" : JSON.stringify(env.NORTH_ENV)})`);
  const url = z.url({ protocol: /^https?$/ }).safeParse(env.SUPABASE_URL);
  if (!url.success) problems.push("SUPABASE_URL must be the staging project's http(s) URL");
  problems.push(...productionProblems(url.success ? url.data : null, env.NORTH_PRODUCTION_SUPABASE_REF, flags));
  return Object.freeze({ ok: problems.length === 0, problems: Object.freeze(problems) });
}

/** `--yes` purges, `--i-know-this-is-not-production` (see the guard); pnpm's bare `--` is dropped; anything else is a usage error. */
export function parsePurgeArgs(argv: readonly string[]): PurgeFlags {
  const { values } = parseArgs({
    args: argv.filter((a) => a !== "--"),
    options: { yes: { type: "boolean" }, [NOT_PRODUCTION_OPTION]: { type: "boolean" } },
    strict: true,
    allowPositionals: false,
  });
  return Object.freeze({ yes: values.yes === true, notProduction: values[NOT_PRODUCTION_OPTION] === true });
}

const ConfigSchema = z.object({
  SUPABASE_URL: z.url({ protocol: /^https?$/ }),
  SUPABASE_SERVICE_ROLE_KEY: z.string().trim().min(10),
  E2E_MAIL_DOMAIN: z.preprocess((v) => blankToNull(typeof v === "string" ? v : undefined)?.toLowerCase() ?? null, z.string().regex(STAGING_HOST, "must be staging.<domain>").nullable()),
  WORKSPACE_ROOT: z.preprocess((v) => blankToNull(typeof v === "string" ? v : undefined), z.string().nullable()),
});

export interface PurgeConfig {
  readonly supabaseUrl: string;
  readonly serviceRoleKey: string;
  readonly mailDomain: string | null;
  readonly workspaceRoot: string | null;
}

/** The env boundary: the service client, the mail domain and the workspace root; a bad value is an error naming the variable (never its value). */
export function purgeConfigFrom(env: Env): PurgeConfig {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) throw new Error(`invalid environment: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  const c = parsed.data;
  return Object.freeze({ supabaseUrl: c.SUPABASE_URL, serviceRoleKey: c.SUPABASE_SERVICE_ROLE_KEY, mailDomain: c.E2E_MAIL_DOMAIN, workspaceRoot: c.WORKSPACE_ROOT });
}

const AuthUserSchema = z.object({ id: z.uuid(), email: z.string().nullish() });
const PER_PAGE = 100;
const MAX_PAGES = 1000;

/** Every auth user (id and address), page by page until an empty page: GoTrue may cap the page size, so a short page is not the end. */
export async function listAuthUsers(db: DbClient): Promise<readonly AuthUserRow[]> {
  const users: AuthUserRow[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: PER_PAGE });
    if (error) throw new Error(`could not list the auth users (page ${page}): ${error.message}`);
    const rows = z.array(AuthUserSchema).parse(data.users);
    if (rows.length === 0) return Object.freeze(users);
    users.push(...rows.map((r) => Object.freeze({ id: r.id, email: r.email ?? null })));
  }
  throw new Error(`more than ${MAX_PAGES} pages of auth users: stopping rather than guessing`);
}

/** Purges each user in turn; one failure is printed and counted, the rest still run. */
async function purgeEach(db: DbClient, users: readonly AuthUserRow[], workspaceRoot: string | null): Promise<{ readonly purged: number; readonly failed: number }> {
  let purged = 0;
  for (const u of users) {
    try {
      const result = await purgeTestUser(db, u.id, E2E_PURGE_REASON, workspaceRoot ? { workspaceRoot } : {});
      purged += 1;
      console.log(`[staging-purge-e2e] purged ${u.id}: ${purgeSummary(result)}`);
    } catch (error) {
      console.error(`[staging-purge-e2e] FAILED ${u.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return Object.freeze({ purged, failed: users.length - purged });
}

async function main(): Promise<number> {
  const flags = parsePurgeArgs(process.argv.slice(2));
  const verdict = purgeGuard(process.env, flags);
  if (!verdict.ok) {
    console.error(`[staging-purge-e2e] refused; nothing was read or deleted:\n- ${verdict.problems.join("\n- ")}`);
    return 1;
  }
  const config = purgeConfigFrom(process.env);
  const db = createServiceClient({ url: config.supabaseUrl, serviceRoleKey: config.serviceRoleKey });
  const users = selectE2eUsers(await listAuthUsers(db), config.mailDomain);
  console.log(`[staging-purge-e2e] ${users.length} e2e user(s) on ${new URL(config.supabaseUrl).host} (e2e-*@${config.mailDomain ?? "staging.<domain>"})`);
  for (const u of users) console.log(`  ${u.id}  ${u.email ?? ""}`);
  if (!flags.yes) {
    console.log("[staging-purge-e2e] dry run: nothing was deleted. Pass --yes to purge the users above.");
    return 0;
  }
  const { purged, failed } = await purgeEach(db, users, config.workspaceRoot);
  console.log(`[staging-purge-e2e] purged ${purged} of ${users.length} e2e user(s)${config.workspaceRoot ? "" : " (task workspaces left: no WORKSPACE_ROOT)"}`);
  return failed > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(`[staging-purge-e2e] ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    },
  );
}
