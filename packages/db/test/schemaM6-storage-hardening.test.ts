import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ArtifactPathError, artifactPathBelongs, createArtifact, getArtifactMarkdown } from "../src/artifacts";
import { createAutoRule, deactivateAutoRule } from "../src/autoRules";
import type { DbClient } from "../src/client";
import { EXPORT_TEXT_MAX_CHARS } from "../src/exports";
import { createGoal } from "../src/goals";
import { saveClarifications } from "../src/theses";
import { createOwnerWithCompany, deleteTestUser, raw, type OwnedCompany, type RawClient, type TestUser } from "./fixtures";

/**
 * M6 security review M2, M4 (length checks) and the note on the 0001
 * `owner_all` policies (0015_m6_storage_hardening.sql): an artifact row names
 * an object under its own company's folder only, and the owner writes only
 * what apps/web writes: the v1 thesis and its clarifications, a goal, an auto
 * rule and its deactivation. Agents, plans, tasks, memory, the tool-call
 * audit and artifacts are the worker's.
 */
const asRaw = (user: TestUser): RawClient => user.client as unknown as RawClient;
const DENIED = "42501";
const CHECK = "23514";

describe("M6 review M2 and the owner write lockdown (EXP-1, RET-1)", () => {
  let owned: OwnedCompany;
  let victim: OwnedCompany;
  let victimPath = "";

  beforeAll(async () => {
    owned = await createOwnerWithCompany("storage-hardening");
    victim = await createOwnerWithCompany("storage-hardening-victim");
    victimPath = (await createArtifact(raw, { companyId: victim.companyId, kind: "business_plan", title: "Business plan", markdown: "# Victim plan", createdByRole: "strategy_product" })).storagePath;
  });

  afterAll(async () => {
    await deleteTestUser(owned.owner);
    await deleteTestUser(victim.owner);
  });

  it("M2: an owner's forged artifact row naming the victim's object is refused, and owners cannot change or delete artifact rows", async () => {
    const mine = asRaw(owned.owner);
    const forged = await mine.from("artifacts").insert({ company_id: owned.companyId, kind: "business_plan", title: "Stolen", version: 1, storage_path: victimPath, created_by_role: "research" });
    expect(forged.error?.code).toBe(DENIED);
    const own = await createArtifact(raw, { companyId: owned.companyId, kind: "prd", title: "Own PRD", markdown: "# Mine", createdByRole: "strategy_product" });
    expect((await mine.from("artifacts").update({ storage_path: victimPath }).eq("id", own.id)).error?.code).toBe(DENIED);
    expect((await mine.from("artifacts").delete().eq("id", own.id)).error?.code).toBe(DENIED);
    expect((await mine.from("artifacts").select("id, storage_path").eq("id", own.id)).data).toEqual([{ id: own.id, storage_path: own.storagePath }]);
  });

  it("M2: the service role cannot record a path outside companies/<company_id>/<kind>/<slug>-v<version>.md either", async () => {
    const row = (storage_path: string, extra: Record<string, unknown> = {}) => raw.from("artifacts").insert({ company_id: owned.companyId, kind: "doc", title: `t-${Math.random()}`, version: 1, storage_path, created_by_role: "research", ...extra });
    for (const path of [
      victimPath,
      `companies/${victim.companyId}/doc/x-v1.md`,
      `companies/${owned.companyId}/doc/../../${victim.companyId}/business_plan/business-plan-v1.md`,
      `companies/${owned.companyId}/prd/x-v1.md`,
      `companies/${owned.companyId}/doc/x-v2.md`,
      `companies/${owned.companyId}/doc/x-v1.md.exe`,
      `users/${owned.owner.id}/exports/x.zip`,
    ]) {
      const { error } = await row(path);
      expect(error?.code, path).toBe(CHECK);
      expect(error?.message, path).toMatch(/artifacts_storage_path_pinned/);
    }
    expect((await row(`companies/${owned.companyId}/doc/notes-v1.md`)).error).toBeNull();
  });

  it("M2: getArtifactMarkdown refuses a row whose path is not under its own company and never downloads it", async () => {
    expect(artifactPathBelongs(owned.companyId, `companies/${owned.companyId}/doc/notes-v1.md`)).toBe(true);
    expect(artifactPathBelongs(owned.companyId, victimPath)).toBe(false);
    expect(artifactPathBelongs(owned.companyId, `companies/${owned.companyId}/doc/../../${victim.companyId}/x-v1.md`)).toBe(false);
    const download = vi.fn();
    const forgedRow = { id: "00000000-0000-4000-8000-000000000001", company_id: owned.companyId, kind: "business_plan", title: "Stolen", version: 1, storage_path: victimPath, created_by_role: "research", created_at: new Date().toISOString() };
    const fake = {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: forgedRow, error: null }) }) }) }),
      storage: { from: () => ({ download }) },
    } as unknown as DbClient;
    await expect(getArtifactMarkdown(fake, forgedRow.id)).rejects.toBeInstanceOf(ArtifactPathError);
    expect(download).not.toHaveBeenCalled();
  });

  it("owner_all lockdown: agents, plans, tasks, memory_items and audit_tool_calls are read-only for the owner; the worker writes them", async () => {
    const mine = asRaw(owned.owner);
    const c = owned.companyId;
    const rows: Record<string, Record<string, unknown>> = {
      agents: { company_id: c, role: "growth", config_ref: "growth.yaml", max_action_tier: "K2" },
      plans: { company_id: c, week_start: "2026-11-02", summary: "Week" },
      tasks: { company_id: c, role: "research", task_type: "market_report", title: "Read the market" },
      memory_items: { company_id: c, kind: "learning", title: "L", content: "C" },
      audit_tool_calls: { company_id: c, tool_name: "Read", decision: "allow" },
    };
    for (const [table, row] of Object.entries(rows)) {
      expect((await mine.from(table).insert(row)).error?.code, `${table} insert`).toBe(DENIED);
      const made = await raw.from(table).insert(row).select("id").single();
      expect(made.error, `${table} service insert`).toBeNull();
      const id = (made.data as { id: string }).id;
      expect((await mine.from(table).select("id").eq("id", id)).data, `${table} select`).toEqual([{ id }]);
      expect((await mine.from(table).update({ company_id: c }).eq("id", id)).error?.code, `${table} update`).toBe(DENIED);
      expect((await mine.from(table).delete().eq("id", id)).error?.code, `${table} delete`).toBe(DENIED);
    }
  });

  it("owner_all lockdown: theses take the v1 insert (company creation) and the clarifications only", async () => {
    const mine = asRaw(owned.owner);
    expect((await mine.from("theses").select("version").eq("company_id", owned.companyId)).data).toEqual([{ version: 1 }]);
    await saveClarifications(owned.owner.client, owned.companyId, [{ id: "q1", question: "Who pays?", answer: "The clinic owner" }]);
    expect((await mine.from("theses").insert({ company_id: owned.companyId, version: 2, text: "A second thesis written by the owner." })).error?.code).toBe(DENIED);
    expect((await mine.from("theses").update({ text: "Rewritten thesis by the owner" }).eq("company_id", owned.companyId)).error?.code).toBe(DENIED);
    expect((await mine.from("theses").delete().eq("company_id", owned.companyId)).error?.code).toBe(DENIED);
    expect((await mine.from("theses").insert({ company_id: victim.companyId, version: 1, text: "A thesis for someone else's company." })).error?.code).toBe(DENIED);
  });

  it("owner_all lockdown: goals take the insert only; auto rules the insert and a deactivation, from the company's own card", async () => {
    const mine = asRaw(owned.owner);
    const goal = await createGoal(owned.owner.client, owned.companyId, { metricKey: "signups", targetValue: 10, dueDate: "2026-12-31" });
    expect((await mine.from("goals").update({ target_value: 1 }).eq("id", goal.id)).error?.code).toBe(DENIED);
    expect((await mine.from("goals").delete().eq("id", goal.id)).error?.code).toBe(DENIED);

    const rule = await createAutoRule(owned.owner.client, { companyId: owned.companyId, kind: "ads.start", maxAmountUsd: 50, category: "ads" });
    expect((await mine.from("auto_rules").update({ max_amount_usd: 5000 }).eq("id", rule.id)).error?.code).toBe(DENIED);
    await deactivateAutoRule(owned.owner.client, owned.companyId, rule.id);
    expect((await mine.from("auto_rules").update({ active: true }).eq("id", rule.id)).error?.code).toBe(DENIED);
    expect((await raw.from("auto_rules").select("active").eq("id", rule.id).single()).data).toEqual({ active: false });
    expect((await mine.from("auto_rules").delete().eq("id", rule.id)).error?.code).toBe(DENIED);
    const due = new Date(Date.now() + 86_400_000).toISOString();
    const card = await raw.from("decision_cards").insert({ company_id: victim.companyId, action_kind: "ads.start", tier: "K2", question: "Start?", options: [{ id: "approve", label: "Approve" }], recommended_option_id: "approve", rationale: "r", due_at: due }).select("id").single();
    expect(card.error).toBeNull();
    expect((await mine.from("auto_rules").insert({ company_id: owned.companyId, kind: "ads.start", created_from_card_id: card.data?.id })).error?.code).toBe(DENIED);
  });

  it("M4: memory, the tool-call audit and the thesis are length-checked in the database (verified against the stack's rows first)", async () => {
    const c = owned.companyId;
    const memory = (content: string, title = "T") => raw.from("memory_items").insert({ company_id: c, kind: "doc", title, content });
    expect((await memory("x".repeat(4000))).error).toBeNull();
    expect((await memory("x".repeat(4001))).error?.message).toMatch(/memory_items_content_length/);
    expect((await memory("x", "t".repeat(121))).error?.message).toMatch(/memory_items_title_length/);
    const audit = (input: unknown) => raw.from("audit_tool_calls").insert({ company_id: c, tool_name: "Read", decision: "allow", input });
    expect((await audit({ value: "x".repeat(4000), truncated: true })).error).toBeNull();
    expect((await audit({ value: "x".repeat(70_000) })).error?.message).toMatch(/audit_tool_calls_input_size/);
    const big = Array.from({ length: 5 }, (_, i) => ({ id: `q${i + 1}`, question: "q".repeat(9000), answer: "a" }));
    expect((await asRaw(owned.owner).from("theses").update({ clarifications: big }).eq("company_id", c)).error?.message).toMatch(/theses_clarifications_size/);
    expect((await raw.from("theses").insert({ company_id: c, version: 3, text: "t".repeat(4001) })).error?.message).toMatch(/theses_text_length/);
  });

  it("M4: export_text cuts a long text column in the select at EXPORT_TEXT_MAX_CHARS (the export's read)", async () => {
    const task = await raw.from("tasks").insert({ company_id: owned.companyId, role: "research", task_type: "market_report", title: "Long", output_summary: "s".repeat(EXPORT_TEXT_MAX_CHARS + 5) }).select("id").single();
    expect(task.error).toBeNull();
    const read = await raw.from("tasks").select("output_summary::export_text, title::export_text").eq("id", task.data?.id).single();
    expect(read.error).toBeNull();
    expect((read.data as { output_summary: string }).output_summary).toHaveLength(EXPORT_TEXT_MAX_CHARS);
    expect((read.data as { title: string }).title).toBe("Long");
  });
});
