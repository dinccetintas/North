/**
 * The ended state and the end of the M6 smoke (docs/plans/M6.md "Acceptance
 * test" 6, 9 and 10): what still runs while agents are paused for the
 * subscription (the brief, nothing else), the retention sweep 91 days on,
 * the whole-run tally, and the cleanup through the one delete path
 * (`purge_owner`, ADR 0016) instead of a pause.
 */
import { createHash } from "node:crypto";
import { briefMarkdown, EVENT } from "@north/core";
import { EXPORTS_BUCKET, getBrief, getCompanyById, getExport, getProfile, listCards, listCompaniesByOwner, listUserStoragePaths, setKillSwitch, type BriefRecord, type PurgeCounts, type StorageObjectRef } from "@north/db";
import { purgeOwner, type PurgeResult } from "../../apps/worker/src/services/purge";
import { billingEventsOf, creditsOf, entitlementWhere, required, untilApplied } from "./billing";
import { cardsPerDay, check, checkpoint, companiesOf, countRows, DAY_MS, db, loose, observe, outputsText, pressSandboxButton, runsOf, send, setClock, setClockTo, show, simDay, sleep, until, withFacts, type Ctx } from "./harness";

/** Billing events of the run: Pro checkout 3, pack 1, cancel 1, end 1, Solo checkout 3, advance 1, end 1. */
export const EXPECTED_EVENTS = [3, 1, 1, 1, 3, 1, 1] as const;
const TRANSITIONS = "trialing → active → canceled → ended → active → ended";
const GRANTS = [300, 1000, 100, 300, 300] as const;
const COMPANY_TABLES = ["audit_tool_calls", "ledger_entries", "campaigns", "actions", "notifications", "signals", "auto_rules", "decision_cards", "agent_runs", "metrics", "memory_items", "artifacts", "briefs", "leads", "public_pages", "exports", "budgets", "theses", "tasks", "plans", "goals", "agents"] as const;
const USER_TABLES = ["connections", "push_subscriptions", "notifications", "usage", "credit_entries", "billing_sessions", "billing_events", "exports", "entitlements"] as const;

/* ---------- phase 6, the paused side ---------- */

/** While ended: `company/resume` is refused, the next morning's briefs say why, and a scan returns skipped and inserts nothing. */
export async function phase6Paused(ctx: Ctx): Promise<Ctx> {
  const companies = companiesOf(ctx);
  const resume = outputsText(await runsOf("company/resume while ended", await send(EVENT.companyResume, { companyId: ctx.c1.id })));
  check(resume.includes("skipped") && resume.includes("subscription_ended"), "company/resume while ended", "skipped: subscription_ended", resume);
  const c1 = await getCompanyById(db, ctx.c1.id);
  check(c1?.killSwitchActive === true && c1.pausedReason === "subscription_ended", "company 1 after the refused resume", "still paused for the subscription", c1);
  await setClock(3, "09:00");
  await send(EVENT.briefTick, {});
  const briefs = await until(`both ${simDay(3)} briefs`, async () => {
    const rows = await Promise.all(companies.map((c) => getBrief(db, c.id, simDay(3))));
    return rows.every((b) => b !== null) ? (rows as BriefRecord[]) : null;
  }, { timeoutMs: 60_000 });
  const lines = briefs.map((b) => briefMarkdown(b.content).toLowerCase());
  check(lines.every((md) => md.includes("subscription ended")), `${simDay(3)} briefs`, 'each says "paused: subscription ended"', lines.map((md) => md.slice(0, 160)));
  const scan = outputsText(await runsOf("signal/scan while ended", await send(EVENT.signalScan, { companyId: ctx.c1.id, reason: "manual" })));
  check(scan.includes("skipped") && scan.includes("subscription_ended"), "signal/scan while ended", "skipped: subscription_ended", scan);
  return checkpoint(ctx, 6);
}

/* ---------- phase 9: retention ---------- */

async function actionIds(companyIds: readonly string[]): Promise<readonly string[]> {
  const { data, error } = await db.from("actions").select("id").in("company_id", [...companyIds]);
  check(!error, "actions read", "no error", error?.message);
  return (data ?? []).map((r) => r.id);
}

async function objectGone(bucket: string, path: string): Promise<boolean> {
  const { data, error } = await db.storage.from(bucket).download(path);
  return data === null || error !== null;
}

/** Ended again, the clock 91 days on, `retention/tick`: both companies archived, `purge_due`, the export expired and its object gone, nothing deleted. */
export async function phase9(ctx: Ctx): Promise<Ctx> {
  const ids = companiesOf(ctx).map((c) => c.id);
  await pressSandboxButton(`${String(ctx.facts.portalUrl)}/end`);
  await untilApplied(ctx.ownerId, EXPECTED_EVENTS.reduce((a, b) => a + b, 0), "second end");
  const ended = await until("ended again", entitlementWhere(ctx.ownerId, (e) => e.status === "ended" && e.endedAt !== null));
  await setClockTo(new Date(Date.parse(required(ended.endedAt, "ended_at")) + 91 * DAY_MS));
  const actions = await actionIds(ids);
  const exportId = String(ctx.facts.exportId);
  const path = required((await getExport(db, exportId))?.storagePath, "the export path");
  const sweep = (await runsOf("retention/tick", await send(EVENT.retentionTick, {}))).find((r) => r.fn.endsWith("retention-sweep"))?.output;
  const swept = (sweep !== null && typeof sweep === "object" ? sweep : {}) as { exportsRemoved?: unknown; purged?: unknown };
  const removed = Array.isArray(swept.exportsRemoved) ? swept.exportsRemoved : [];
  const purgedNow = Array.isArray(swept.purged) ? (swept.purged as { userId?: unknown }[]) : [];
  check(removed.includes(exportId) && !purgedNow.some((p) => p.userId === ctx.ownerId), "retention-sweep output", `exportsRemoved has ${exportId}, purged does not name the owner (RETENTION_PURGE_ENABLED off)`, sweep);
  const archived = await until("both companies archived for retention", async () => {
    const rows = await listCompaniesByOwner(db, ctx.ownerId);
    return rows.length === 2 && rows.every((c) => c.status === "archived" && c.pausedReason === "retention") ? rows : null;
  }, { timeoutMs: 30_000, found: () => listCompaniesByOwner(db, ctx.ownerId) });
  const due = await until("purge_due", entitlementWhere(ctx.ownerId, (e) => e.purgeDue), { timeoutMs: 15_000 });
  const exported = await until("the export expired", async () => ((await getExport(db, exportId))?.status === "expired" ? getExport(db, exportId) : null), { timeoutMs: 15_000, found: () => getExport(db, exportId) });
  check(await objectGone(EXPORTS_BUCKET, path), "the expired export's object", `gone from ${EXPORTS_BUCKET}/${path}`, "still downloadable");
  const still = new Set(await actionIds(ids));
  const gone = actions.filter((id) => !still.has(id));
  check(gone.length === 0 && (await getProfile(db, ctx.ownerId)) !== null, "retention without RETENTION_PURGE_ENABLED", `nothing deleted (all ${actions.length} actions rows, the profile)`, { gone, profile: (await getProfile(db, ctx.ownerId)) !== null });
  const next = withFacts(observe(ctx, "ended"), { archived: archived.length, purgeDue: String(due.purgeDue), exportStatus: exported?.status ?? "?" });
  return checkpoint(next, 9);
}

/* ---------- phase 10: the whole run ---------- */

export async function wholeRun(ctx: Ctx): Promise<string> {
  const cards = (await Promise.all(companiesOf(ctx).map((c) => listCards(db, c.id, { limit: 100 })))).flat();
  const kinds = cards.map((c) => c.actionKind).sort().join(",");
  check(cards.length === 3 && cards.every((c) => c.answeredBy === "user" && c.answeredAt !== null), "whole run cards", "3, each answered by the user, none open", cards.map((c) => `${c.actionKind}:${c.day}:${c.answeredBy ?? "open"}`));
  check(kinds === "ads.resume,budget.cap.raise,deploy.production", "card kinds", "go-live, cap card, resume", kinds);
  const events = await billingEventsOf(ctx.ownerId);
  const total = EXPECTED_EVENTS.reduce((a, b) => a + b, 0);
  check(events.length === total && events.every((e) => e.appliedAt !== null), "whole run billing_events", `${total} (${EXPECTED_EVENTS.join(" + ")}), all applied`, events.map((e) => e.type));
  check(ctx.transitions.join(" → ") === TRANSITIONS, "entitlement transitions", TRANSITIONS, ctx.transitions.join(" → "));
  const credits = await creditsOf(ctx.ownerId);
  const grants = credits.filter((e) => e.kind === "grant_plan" || e.kind === "grant_pack").map((e) => e.amount);
  check(grants.join(",") === GRANTS.join(","), "credit grants", GRANTS.join(" + "), grants);
  const consumes = credits.filter((e) => e.kind === "consume" && e.ref.startsWith("run:")).length;
  const expires = credits.filter((e) => e.kind === "expire");
  const perDay = Math.max(0, ...(await Promise.all(companiesOf(ctx).map(async (c) => Object.values(await cardsPerDay(c.id))))).flat());
  return [
    `events ${total} (${EXPECTED_EVENTS.join(" + ")})`,
    `entitlement ${ctx.transitions.join(" → ")}`,
    `credits: grants ${GRANTS.join(" + ")}, consumes ${consumes}, expire ${expires.length} (${expires.reduce((a, e) => a + e.amount, 0)})`,
    `cards 3 (go-live, cap, resume; all by the user, none open, max ${perDay}/day ≤ 3)`,
    `export ${ctx.facts.exportBytes} bytes (${ctx.facts.exportEntries} entries)`,
    `kill switch ${ctx.facts.killSwitchMs} ms`,
  ].join(", ");
}

/* ---------- the purge: the smoke's cleanup ---------- */

const userHash = (userId: string): string => createHash("sha256").update(userId, "utf8").digest("hex");

/**
 * The worker's own `purgeOwner` (storage objects, then `purge_owner`, then
 * `auth.admin.deleteUser`). The sweep decided on the simulated clock, but the
 * function re-checks `retention_until` on the database's wall clock, so the
 * harness (service role) first puts it behind that clock, as ADR 0016 says.
 */
async function purgeUser(userId: string, reason: string): Promise<{ readonly result: PurgeResult; readonly paths: readonly StorageObjectRef[]; readonly present: number }> {
  const wall = Date.now();
  const { error } = await db.from("entitlements").update({ status: "ended", ended_at: new Date(wall - 91 * DAY_MS).toISOString(), retention_until: new Date(wall - 5 * 60_000).toISOString() }).eq("user_id", userId);
  check(!error, "entitlement before the purge", "ended with retention passed (service role)", error?.message);
  const paths = await listUserStoragePaths(db, userId);
  // An expired export keeps its row but the sweep already removed its object; only the objects still there can be removed.
  const present = (await Promise.all(paths.map(async (p) => !(await objectGone(p.bucket, p.path))))).filter(Boolean).length;
  return { result: await purgeOwner({ db }, userId, reason), paths, present };
}

/** Every table the function names has no row left for the owner, and no company, profile or auth user remains. */
async function nothingLeft(ownerId: string, companyIds: readonly string[]): Promise<void> {
  const left: Record<string, number> = {};
  for (const table of COMPANY_TABLES) left[table] = await countRows(table, "company_id", companyIds);
  for (const table of USER_TABLES) left[`${table} (user)`] = await countRows(table, "user_id", ownerId);
  left.companies = await countRows("companies", "owner_id", ownerId);
  left.users = await countRows("users", "id", ownerId);
  const remaining = Object.entries(left).filter(([, n]) => n > 0);
  check(remaining.length === 0, "rows after the purge", "zero in every table", Object.fromEntries(remaining));
}

/** Phase 9's cleanup: `purge_owner`, one `purge_log` row with the counts, every table empty for the owner, the auth user deleted, `actions` append-only again. */
export async function purgeOwnerProof(ctx: Ctx): Promise<PurgeCounts> {
  const ids = companiesOf(ctx).map((c) => c.id);
  const { result, paths, present } = await purgeUser(ctx.ownerId, "smoke");
  const { counts } = result;
  check(present > 0 && result.objectsRemoved === present, "storage objects", `the ${present} still present removed (every artifact version; the expired export's object went in phase 9)`, { removed: result.objectsRemoved, present, listed: paths.length });
  for (const p of paths) check(await objectGone(p.bucket, p.path), "storage after the purge", `${p.bucket}/${p.path} gone`, "still there");
  const { data: logs, error } = await db.from("purge_log").select("reason, counts").eq("user_hash", userHash(ctx.ownerId));
  check(!error && logs?.length === 1 && logs[0]?.reason === "smoke" && show(logs[0].counts) === show(counts), "purge_log", "one row with the returned counts", { logs, counts, error: error?.message });
  check((counts.companies ?? 0) === 2 && (counts.actions ?? 0) > 0 && (counts.users ?? 0) === 1, "purge counts", "2 companies, their actions, 1 profile", counts);
  await nothingLeft(ctx.ownerId, ids);
  const auth = await db.auth.admin.getUserById(ctx.ownerId);
  check(result.authUserDeleted && auth.data.user === null, "auth.admin.deleteUser", "200 (nothing left to cascade), the auth user gone", { deleted: result.authUserDeleted, still: auth.data.user?.id ?? null });
  const update = await loose.from("actions").update({ description: "smoke M6: must be refused" }).eq("company_id", String(ctx.facts.witnessCompanyId));
  check(/append-only/i.test(update.error?.message ?? ""), "update actions after the purge", "append-only table (the triggers are back on)", update.error?.message ?? "no error");
  return counts;
}

/**
 * Cleanup for whatever is left (the stranger on success; everyone after a
 * failure): the same purge, unless `SMOKE_KEEP_ON_FAILURE=1` keeps a failed
 * owner's rows for inspection with the kill switch on.
 */
export async function cleanup(userIds: readonly string[], failed: boolean): Promise<void> {
  for (const userId of userIds) {
    try {
      if ((await countRows("users", "id", userId)) === 0) continue;
      if (failed && process.env.SMOKE_KEEP_ON_FAILURE === "1") {
        for (const c of await listCompaniesByOwner(db, userId)) await setKillSwitch(db, c.id, true);
        console.error(`smoke M6: kept user ${userId} for inspection (SMOKE_KEEP_ON_FAILURE=1)`);
        continue;
      }
      await sleep(failed ? 3000 : 0);
      await purgeUser(userId, "smoke");
    } catch (error) {
      console.error(`smoke M6: cleanup of ${userId} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
