import { localDay } from "@north/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cardsOpenedToday, listCardsOpenedOn, openCard, QuotaExceededError } from "../src/decisions";
import { createTask } from "../src/tasks";
import { createCompanyFor, createOwnerWithCompany, deleteTestUser, grantPlan, raw, sampleCardDraft, service, type OwnedCompany, type RawClient } from "./fixtures";

const ref = () => `ref-${Math.random().toString(36).slice(2, 10)}`;

/** Database-level guarantees added by 0010_m5.sql (DEC-3 local day, PRO-3-CAP, BRF-1, PLN-2, OBS-1). */
describe("M5 schema", () => {
  let owned: OwnedCompany;
  let ownerRaw: RawClient;

  beforeAll(async () => {
    owned = await createOwnerWithCompany("schema-m5");
    // 4 companies for one owner: over the Solo trial's limit (M6).
    await grantPlan(owned.owner.id, "scale");
    ownerRaw = owned.owner.client as unknown as RawClient;
  });

  afterAll(async () => {
    await deleteTestUser(owned.owner);
  });

  const signalRow = (overrides: Record<string, unknown> = {}) => ({
    company_id: owned.companyId,
    kind: "opportunity",
    source: "reddit",
    source_ref: ref(),
    title: "Looking for a tool",
    status: "card_opened",
    card_week: "2026-W43",
    ...overrides,
  });

  it("DEC-3: the quota day is the owner's local day: 3 cards at UTC, the 4th refused, then open once the owner's zone is on another date", async () => {
    const companyId = await createCompanyFor(owned.owner, "local-day");
    expect((await service.from("users").update({ timezone: "UTC" }).eq("id", owned.owner.id)).error).toBeNull();
    const now = new Date();
    const utcDay = localDay("UTC", now);
    for (let i = 0; i < 3; i++) {
      const card = await openCard(service, { ...sampleCardDraft(companyId), taskId: null, openedAt: now.toISOString() });
      expect(card.day).toBe(utcDay);
      expect(new Date(card.openedAt).toISOString()).toBe(now.toISOString());
    }
    await expect(openCard(service, { ...sampleCardDraft(companyId), taskId: null, openedAt: now.toISOString() })).rejects.toBeInstanceOf(QuotaExceededError);
    expect(await cardsOpenedToday(service, companyId, utcDay)).toBe(3);

    // UTC+14 and UTC-11 are 25 hours apart: at least one of them is on another date than UTC right now.
    const zone = ["Pacific/Kiritimati", "Pacific/Pago_Pago"].find((tz) => localDay(tz, now) !== utcDay)!;
    expect((await service.from("users").update({ timezone: zone }).eq("id", owned.owner.id)).error).toBeNull();
    const fourth = await openCard(service, { ...sampleCardDraft(companyId), taskId: null, openedAt: now.toISOString() });
    expect(fourth.day).toBe(localDay(zone, now));
    expect(fourth.day).not.toBe(utcDay);
    expect(fourth.seq).toBe(1);
    expect(await cardsOpenedToday(service, companyId, utcDay)).toBe(3);
    expect(await cardsOpenedToday(service, companyId, fourth.day)).toBe(1);
    expect((await listCardsOpenedOn(owned.owner.client, companyId, fourth.day)).map((c) => c.id)).toEqual([fourth.id]);
    expect((await service.from("users").update({ timezone: "UTC" }).eq("id", owned.owner.id)).error).toBeNull();
  });

  it("DEC-3: a card opened in the past lands on its own day and the owner cannot move opened_at", async () => {
    const companyId = await createCompanyFor(owned.owner, "past-day");
    const card = await openCard(service, { ...sampleCardDraft(companyId), taskId: null, openedAt: "2020-02-02T12:00:00.000Z" });
    expect(card.day).toBe("2020-02-02");
    expect(await cardsOpenedToday(service, companyId, localDay("UTC", new Date()))).toBe(0);
    const tamper = await owned.owner.client.from("decision_cards").update({ opened_at: new Date().toISOString() }).eq("id", card.id).select("id");
    expect(tamper.error?.code).toBe("42501");
    const moved = await owned.owner.client.from("decision_cards").update({ day: "2000-01-01" }).eq("id", card.id).select("id");
    expect(moved.error?.code).toBe("42501");
    // A supplied `day` is never trusted: the trigger recomputes it from opened_at.
    const forged = await raw
      .from("decision_cards")
      .insert({ company_id: companyId, action_kind: "ads.start", tier: "K2", question: "Approve?", options: [{ id: "approve", label: "Approve" }], recommended_option_id: "approve", rationale: "r", due_at: new Date().toISOString(), opened_at: "2021-03-03T23:30:00Z", day: "1999-01-01" })
      .select("day, seq")
      .single();
    expect(forged.data).toEqual({ day: "2021-03-03", seq: 1 });
  });

  it("users: a zone Postgres does not know is refused (invalid_parameter_value)", async () => {
    const unknown = await service.from("users").update({ timezone: "Mars/Olympus_Mons" }).eq("id", owned.owner.id);
    expect(unknown.error?.code).toBe("22023");
    const known = await service.from("users").update({ timezone: "Europe/Istanbul" }).eq("id", owned.owner.id).select("timezone").single();
    expect(known.data?.timezone).toBe("Europe/Istanbul");
    expect((await service.from("users").update({ timezone: "UTC" }).eq("id", owned.owner.id)).error).toBeNull();
  });

  it("PRO-3-CAP: a second opportunity signal with the same card_week is refused even through the service role; a metric_drop is not", async () => {
    const first = await raw.from("signals").insert(signalRow()).select("id, status, kind").single();
    expect(first.error).toBeNull();
    expect(first.data).toMatchObject({ status: "card_opened", kind: "opportunity" });
    const second = await raw.from("signals").insert(signalRow());
    expect(second.error?.code).toBe("23505");
    expect(second.error?.message).toMatch(/signals_opportunity_week_idx/);
    const drop = await raw.from("signals").insert(signalRow({ kind: "metric_drop", source: "metrics" })).select("id").single();
    expect(drop.error).toBeNull();
    const err = await raw.from("signals").insert(signalRow({ kind: "error", source: "sentry" })).select("id").single();
    expect(err.error).toBeNull();
    const nextWeek = await raw.from("signals").insert(signalRow({ card_week: "2026-W44" })).select("id").single();
    expect(nextWeek.error).toBeNull();
    const held = await raw.from("signals").insert(signalRow({ card_week: null, status: "capped" })).select("id").single();
    expect(held.error).toBeNull();
    const heldAgain = await raw.from("signals").insert(signalRow({ card_week: null, status: "capped" })).select("id").single();
    expect(heldAgain.error).toBeNull();
  });

  it("signals: one row per company, source and source_ref; unknown kinds, statuses, sources and weeks are refused", async () => {
    const sourceRef = ref();
    const one = await raw.from("signals").insert(signalRow({ source_ref: sourceRef, card_week: null, status: "new" }));
    expect(one.error).toBeNull();
    const twice = await raw.from("signals").insert(signalRow({ source_ref: sourceRef, card_week: null, status: "new" }));
    expect(twice.error?.code).toBe("23505");
    expect(twice.error?.message).toMatch(/signals_company_source_ref_key/);
    const badKind = await raw.from("signals").insert(signalRow({ kind: "rumour", card_week: null }));
    expect(badKind.error?.message).toMatch(/signals_kind_check/);
    const badStatus = await raw.from("signals").insert(signalRow({ status: "maybe", card_week: null }));
    expect(badStatus.error?.message).toMatch(/signals_status_check/);
    const badSource = await raw.from("signals").insert(signalRow({ source: "usenet", card_week: null }));
    expect(badSource.error?.message).toMatch(/signals_source_check/);
    const badWeek = await raw.from("signals").insert(signalRow({ card_week: "week 43" }));
    expect(badWeek.error?.message).toMatch(/signals_card_week_check/);
    const badScore = await raw.from("signals").insert(signalRow({ score: 1.5, card_week: null }));
    expect(badScore.error?.message).toMatch(/signals_score_check/);
  });

  it("owners read signals, briefs and agent_runs but cannot write them", async () => {
    const visible = await ownerRaw.from("signals").select("id").eq("company_id", owned.companyId);
    expect(visible.error).toBeNull();
    expect((visible.data ?? []).length).toBeGreaterThan(0);
    const signal = await ownerRaw.from("signals").insert(signalRow({ card_week: null }));
    expect(signal.error?.code).toBe("42501");
    const patched = await ownerRaw.from("signals").update({ status: "approved" }).eq("company_id", owned.companyId);
    expect(patched.error?.code).toBe("42501");
    const brief = await ownerRaw.from("briefs").insert({ company_id: owned.companyId, brief_date: "2026-10-19", content: {}, word_count: 1 });
    expect(brief.error?.code).toBe("42501");
    const run = await ownerRaw.from("agent_runs").insert({ company_id: owned.companyId, role: "research", model: "m", runtime: "mock", status: "succeeded" });
    expect(run.error?.code).toBe("42501");
    const stored = await raw.from("briefs").insert({ company_id: owned.companyId, brief_date: "2026-10-19", content: { day: "2026-10-19" }, word_count: 42 }).select("id").single();
    expect(stored.error).toBeNull();
    const read = await ownerRaw.from("briefs").select("word_count").eq("id", stored.data!.id).single();
    expect(read.data).toEqual({ word_count: 42 });
    const negative = await raw.from("briefs").insert({ company_id: owned.companyId, brief_date: "2026-10-20", content: {}, word_count: -1 });
    expect(negative.error?.message).toMatch(/briefs_word_count_check/);
  });

  it("tasks accept signal_research and fix_error; artifacts accept signal_report and incident_report", async () => {
    const research = await createTask(service, { companyId: owned.companyId, role: "research", taskType: "signal_research", title: "Look into it" });
    expect(research.taskType).toBe("signal_research");
    const fix = await createTask(service, { companyId: owned.companyId, role: "engineering", taskType: "fix_error", title: "Fix NPE" });
    expect(fix.taskType).toBe("fix_error");
    for (const kind of ["signal_report", "incident_report"]) {
      const ok = await service.from("artifacts").insert({ company_id: owned.companyId, kind, title: kind, storage_path: `companies/${owned.companyId}/${kind}/x-v1.md`, created_by_role: "research" });
      expect(ok.error).toBeNull();
    }
    const bad = await service.from("artifacts").insert({ company_id: owned.companyId, kind: "rumour", title: "x", storage_path: "companies/x/rumour/x-v1.md", created_by_role: "research" });
    expect(bad.error?.message).toMatch(/artifacts_kind_check/);
  });

  it("PLN-2: plans.revisions round-trips and must be an array", async () => {
    const revisions = [{ taskType: "outreach_batch", change: "dropped", reason: "0 replies from 5 sends" }];
    const plan = await raw.from("plans").insert({ company_id: owned.companyId, week_start: "2026-10-26", summary: "Week 2", revisions }).select("id, revisions").single();
    expect(plan.error).toBeNull();
    expect(plan.data?.revisions).toEqual(revisions);
    const bare = await raw.from("plans").insert({ company_id: owned.companyId, week_start: "2026-11-02", summary: "Week 3" }).select("revisions").single();
    expect(bare.data?.revisions).toEqual([]);
    const object = await raw.from("plans").insert({ company_id: owned.companyId, week_start: "2026-11-09", summary: "Week 4", revisions: { taskType: "prd" } });
    expect(object.error?.message).toMatch(/plans_revisions_is_array/);
  });

  it("companies.sentry_project_slug (M5 review M4, 0011): the owner's PATCH is refused, the service role sets it, it is unique, and a bad slug is refused", async () => {
    const slug = `acme-${Math.random().toString(36).slice(2, 8)}`;
    const squat = await ownerRaw.from("companies").update({ sentry_project_slug: slug }).eq("id", owned.companyId).select("sentry_project_slug");
    expect(squat.error?.code).toBe("42501");
    const set = await raw.from("companies").update({ sentry_project_slug: slug }).eq("id", owned.companyId).select("sentry_project_slug").single();
    expect(set.data).toEqual({ sentry_project_slug: slug });
    const other = await createCompanyFor(owned.owner, "sentry-other");
    const dupe = await raw.from("companies").update({ sentry_project_slug: slug }).eq("id", other);
    expect(dupe.error?.code).toBe("23505");
    const bad = await raw.from("companies").update({ sentry_project_slug: "Not A Slug" }).eq("id", other);
    expect(bad.error?.message).toMatch(/companies_sentry_project_slug_check/);
    const unclaim = await ownerRaw.from("companies").update({ sentry_project_slug: null }).eq("id", owned.companyId).select("sentry_project_slug");
    expect(unclaim.error?.code).toBe("42501");
    const cleared = await raw.from("companies").update({ sentry_project_slug: null }).eq("id", owned.companyId).select("sentry_project_slug").single();
    expect(cleared.data).toEqual({ sentry_project_slug: null });
    // The owner still updates the columns that are theirs (the kill switch, the name, onboarding).
    const theirs = await ownerRaw.from("companies").update({ name: "Renamed Co", kill_switch_active: true, status: "paused" }).eq("id", owned.companyId).select("name, kill_switch_active, status").single();
    expect(theirs.data).toEqual({ name: "Renamed Co", kill_switch_active: true, status: "paused" });
    expect((await ownerRaw.from("companies").update({ kill_switch_active: false, status: "active" }).eq("id", owned.companyId)).error).toBeNull();
    expect((await ownerRaw.from("companies").update({ owner_id: owned.owner.id }).eq("id", owned.companyId).select("id")).error?.code).toBe("42501");
  });
});
