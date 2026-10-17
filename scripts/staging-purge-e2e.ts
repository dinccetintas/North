/**
 * STG-1: the staging e2e purge. The live journey (Task 20) signs up a fresh
 * user per run as `e2e-<stamp>-<project>@<E2E_MAIL_DOMAIN>`; this script lists
 * the auth users whose address has that shape and who were created at least
 * `--older-than-minutes` ago (default 120, so a run still going keeps its
 * user), and with `--yes` purges each through the one delete path (ADR
 * 0016's smoke cleanup: the entitlement is ended with the service role, then
 * the worker's `purgeOwner`, reason `e2e`). Without `--yes` it only prints the
 * users it would purge and the younger ones it skips.
 *
 * It refuses to read anything unless `NORTH_ENV=staging` and
 * `E2E_MAIL_DOMAIN=staging.<domain>` are in its env and the Supabase host
 * is not the production project's (no label of it equals
 * `NORTH_PRODUCTION_SUPABASE_REF`); with no production ref set it refuses
 * unless `--i-know-this-is-not-production` is passed (fail closed). Service
 * role only: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` of the staging
 * project, from the shell or the CI environment, never a flag.
 * `WORKSPACE_ROOT` also removes the users' task workspaces when it runs where
 * they live.
 *
 * Usage: NORTH_ENV=staging NORTH_PRODUCTION_SUPABASE_REF=<prod ref> E2E_MAIL_DOMAIN=staging.<domain> \
 *          SUPABASE_URL=<staging url> SUPABASE_SERVICE_ROLE_KEY=<staging key> \
 *          pnpm staging:purge-e2e [-- --yes] [--older-than-minutes <n>] [--i-know-this-is-not-production]
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
/** A user younger than this many minutes may belong to a run that is still going: it is listed, never purged. */
export const DEFAULT_OLDER_THAN_MINUTES = 120;

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

/** `E2E_MAIL_DOMAIN` trimmed and lowercased when it is `staging.<domain>`; null otherwise (unset, blank or anything else). */
const stagingDomain = (value: string | undefined): string | null => {
  const domain = blankToNull(value)?.toLowerCase() ?? null;
  return domain !== null && STAGING_HOST.test(domain) ? domain : null;
};

/**
 * True for an e2e user's address at `domain` (`E2E_MAIL_DOMAIN`): the local
 * part starts with `e2e-` (so the inbox `e2e@staging.<domain>` never
 * matches) and the host is exactly `domain`. One address only, compared in
 * lowercase after trimming; a domain that is not `staging.<domain>` (blank
 * included) matches nothing.
 */
export function isE2eEmail(email: string, domain: string): boolean {
  const wanted = stagingDomain(domain);
  const parts = email.trim().toLowerCase().split("@");
  if (wanted === null || parts.length !== 2) return false;
  const [local = "", host = ""] = parts;
  return E2E_LOCAL.test(local) && host === wanted;
}

export interface AuthUserRow {
  readonly id: string;
  readonly email: string | null;
  /** GoTrue's `created_at`; null when the user carries none. */
  readonly createdAt: string | null;
}

export interface E2eUsers {
  /** Created at least the floor ago: purged with `--yes`. */
  readonly old: readonly AuthUserRow[];
  /** Younger than the floor, or with no readable creation time: listed, never purged. */
  readonly young: readonly AuthUserRow[];
}

/** The e2e users among `users` at `domain`, split by the age floor as of `now` (a user exactly on the floor is old); new frozen lists. */
export function partitionE2eUsers(users: readonly AuthUserRow[], domain: string, now: Date, olderThanMinutes: number): E2eUsers {
  const cutoff = now.getTime() - olderThanMinutes * 60_000;
  const e2e = users.filter((u) => u.email !== null && isE2eEmail(u.email, domain)).map((u) => Object.freeze({ ...u }));
  const isOld = (u: AuthUserRow): boolean => {
    const created = u.createdAt === null ? Number.NaN : Date.parse(u.createdAt);
    return Number.isFinite(created) && created <= cutoff;
  };
  return Object.freeze({ old: Object.freeze(e2e.filter(isOld)), young: Object.freeze(e2e.filter((u) => !isOld(u))) });
}

export interface PurgeFlags {
  readonly yes: boolean;
  readonly notProduction: boolean;
  readonly olderThanMinutes: number;
}

export interface GuardVerdict {
  readonly ok: boolean;
  readonly problems: readonly string[];
}

/** The production rule: a host with the ref as one of its labels is refused; no ref at all is refused unless the operator passed the flag. */
function productionProblems(host: string | null, rawRef: string | undefined, flags: Pick<PurgeFlags, "notProduction">): readonly string[] {
  const ref = blankToNull(rawRef);
  if (ref === null) return flags.notProduction ? [] : [`NORTH_PRODUCTION_SUPABASE_REF is not set, so the script cannot tell this project from production: set it, or pass ${NOT_PRODUCTION_FLAG}`];
  if (!PROJECT_REF.test(ref)) return ["NORTH_PRODUCTION_SUPABASE_REF does not look like a Supabase project ref (letters and digits only, as in <ref>.supabase.co)"];
  return host !== null && host.split(".").includes(ref.toLowerCase()) ? ["SUPABASE_URL's host is the production project (it names NORTH_PRODUCTION_SUPABASE_REF)"] : [];
}

/**
 * Pure: whether the purge may run with this env and these flags. Every
 * problem is listed at once; `ok` only with none. `NORTH_ENV` must be exactly
 * `staging`; `E2E_MAIL_DOMAIN` must be `staging.<domain>`; `SUPABASE_URL` an
 * http(s) URL whose host (lowercase) is not the production project's.
 */
export function purgeGuard(env: Env, flags: Pick<PurgeFlags, "notProduction">): GuardVerdict {
  const problems: string[] = [];
  if (env.NORTH_ENV !== "staging") problems.push(`NORTH_ENV must be staging (it is ${env.NORTH_ENV === undefined ? "unset" : JSON.stringify(env.NORTH_ENV)})`);
  if (stagingDomain(env.E2E_MAIL_DOMAIN) === null) problems.push("E2E_MAIL_DOMAIN must be set to staging.<domain>, the live journey's sign-up host (the purge matches e2e-*@ exactly that host)");
  const url = z.url({ protocol: /^https?$/ }).safeParse(env.SUPABASE_URL);
  if (!url.success) problems.push("SUPABASE_URL must be the staging project's http(s) URL");
  problems.push(...productionProblems(url.success ? new URL(url.data).hostname.toLowerCase() : null, env.NORTH_PRODUCTION_SUPABASE_REF, flags));
  return Object.freeze({ ok: problems.length === 0, problems: Object.freeze(problems) });
}

const MinutesSchema = z
  .string()
  .regex(/^\d{1,6}$/, "--older-than-minutes must be a whole number of minutes, 0 or more")
  .transform(Number);

/** `--yes` purges, `--older-than-minutes <n>` sets the age floor, `--i-know-this-is-not-production` (see the guard); pnpm's bare `--` is dropped; anything else is a usage error. */
export function parsePurgeArgs(argv: readonly string[]): PurgeFlags {
  const { values } = parseArgs({
    args: argv.filter((a) => a !== "--"),
    options: { yes: { type: "boolean" }, [NOT_PRODUCTION_OPTION]: { type: "boolean" }, "older-than-minutes": { type: "string" } },
    strict: true,
    allowPositionals: false,
  });
  const minutes = MinutesSchema.safeParse(values["older-than-minutes"] ?? String(DEFAULT_OLDER_THAN_MINUTES));
  if (!minutes.success) throw new Error(minutes.error.issues[0]?.message ?? "--older-than-minutes is invalid");
  return Object.freeze({ yes: values.yes === true, notProduction: values[NOT_PRODUCTION_OPTION] === true, olderThanMinutes: minutes.data });
}

const ConfigSchema = z.object({
  SUPABASE_URL: z.url({ protocol: /^https?$/ }),
  SUPABASE_SERVICE_ROLE_KEY: z.string().trim().min(10),
  E2E_MAIL_DOMAIN: z.preprocess((v) => blankToNull(typeof v === "string" ? v : undefined)?.toLowerCase(), z.string("is required").regex(STAGING_HOST, "must be staging.<domain>")),
  WORKSPACE_ROOT: z.preprocess((v) => blankToNull(typeof v === "string" ? v : undefined), z.string().nullable()),
});

export interface PurgeConfig {
  readonly supabaseUrl: string;
  readonly serviceRoleKey: string;
  readonly mailDomain: string;
  readonly workspaceRoot: string | null;
}

/** The env boundary: the service client, the mail domain and the workspace root; a bad value is an error naming the variable (never its value). */
export function purgeConfigFrom(env: Env): PurgeConfig {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) throw new Error(`invalid environment: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  const c = parsed.data;
  return Object.freeze({ supabaseUrl: c.SUPABASE_URL, serviceRoleKey: c.SUPABASE_SERVICE_ROLE_KEY, mailDomain: c.E2E_MAIL_DOMAIN, workspaceRoot: c.WORKSPACE_ROOT });
}

const AuthUserSchema = z.object({ id: z.uuid(), email: z.string().nullish(), created_at: z.string().nullish() });
const PER_PAGE = 100;
const MAX_PAGES = 1000;

/** Every auth user (id, address, creation time), page by page until an empty page: GoTrue may cap the page size, so a short page is not the end. */
export async function listAuthUsers(db: DbClient): Promise<readonly AuthUserRow[]> {
  const users: AuthUserRow[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: PER_PAGE });
    if (error) throw new Error(`could not list the auth users (page ${page}): ${error.message}`);
    const rows = z.array(AuthUserSchema).parse(data.users);
    if (rows.length === 0) return Object.freeze(users);
    users.push(...rows.map((r) => Object.freeze({ id: r.id, email: r.email ?? null, createdAt: r.created_at ?? null })));
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

/** Prints what the run found: the users it would purge, then the younger ones it skips. */
function printUsers(host: string, config: PurgeConfig, flags: PurgeFlags, users: E2eUsers): void {
  console.log(`[staging-purge-e2e] ${users.old.length} e2e user(s) on ${host} (e2e-*@${config.mailDomain}) created ${flags.olderThanMinutes} minutes ago or earlier`);
  for (const u of users.old) console.log(`  ${u.id}  ${u.email ?? ""}  ${u.createdAt ?? ""}`);
  if (users.young.length === 0) return;
  console.log(`[staging-purge-e2e] skipped ${users.young.length} younger e2e user(s) (a run may still be going; --older-than-minutes ${flags.olderThanMinutes}):`);
  for (const u of users.young) console.log(`  ${u.id}  ${u.email ?? ""}  ${u.createdAt ?? "no creation time"}`);
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
  const users = partitionE2eUsers(await listAuthUsers(db), config.mailDomain, new Date(), flags.olderThanMinutes);
  printUsers(new URL(config.supabaseUrl).host, config, flags, users);
  if (!flags.yes) {
    console.log("[staging-purge-e2e] dry run: nothing was deleted. Pass --yes to purge the users above.");
    return 0;
  }
  const { purged, failed } = await purgeEach(db, users.old, config.workspaceRoot);
  console.log(`[staging-purge-e2e] purged ${purged} of ${users.old.length} e2e user(s)${config.workspaceRoot ? "" : " (task workspaces left: no WORKSPACE_ROOT)"}`);
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
