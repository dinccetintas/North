import type { SignalCandidate } from "@north/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DbError } from "../src/errors";
import { getSignal, insertSignals, knownSourceRefs, listSignals, SignalCapError, signalByRef, updateSignal } from "../src/signals";
import { createCompanyFor, createOwnerWithCompany, createTestUser, deleteTestUser, raw, service, type OwnedCompany, type TestUser } from "./fixtures";

const candidate = (sourceRef: string, overrides: Partial<SignalCandidate> = {}): SignalCandidate =>
  Object.freeze({
    source: "reddit",
    sourceRef,
    title: `Post ${sourceRef}`,
    excerpt: "Looking for a tool that does <b>this</b>",
    url: `https://www.reddit.com/r/startups/comments/${sourceRef}/`,
    observedAt: "2026-10-19T10:00:00.000Z",
    baseline: false,
    ...overrides,
  });

describe("signals repository (PRO-1, PRO-3-CAP)", () => {
  let owned: OwnedCompany;
  let stranger: TestUser;

  beforeAll(async () => {
    owned = await createOwnerWithCompany("signals");
    stranger = await createTestUser("signals-stranger");
  });

  afterAll(async () => {
    await deleteTestUser(owned.owner);
    await deleteTestUser(stranger);
  });

  it("insertSignals stores candidates as new rows and a rescan inserts nothing (dedupe on company, source, source_ref)", async () => {
    const first = await insertSignals(service, owned.companyId, [candidate("r-a-1"), candidate("r-a-2")], { kind: "opportunity" });
    expect(first.length).toBe(2);
    const again = await insertSignals(service, owned.companyId, [candidate("r-a-1"), candidate("r-a-2"), candidate("r-a-3")], { kind: "opportunity" });
    expect(again.length).toBe(1);
    expect(await insertSignals(service, owned.companyId, [], { kind: "opportunity" })).toEqual([]);
    const rows = await listSignals(owned.owner.client, owned.companyId, { status: ["new"] });
    expect(rows.map((s) => s.sourceRef).sort()).toEqual(["r-a-1", "r-a-2", "r-a-3"]);
    expect(rows[0]).toMatchObject({ companyId: owned.companyId, kind: "opportunity", source: "reddit", status: "new", score: 0, summary: "", rationale: "", cardWeek: null, convertedCardId: null, convertedTaskId: null, scoredAt: null });
    expect(rows[0]?.excerpt).toBe("Looking for a tool that does <b>this</b>");
    expect(new Date(rows[0]!.observedAt).toISOString()).toBe("2026-10-19T10:00:00.000Z");
    expect(Object.isFrozen(rows)).toBe(true);
    expect(Object.isFrozen(rows[0])).toBe(true);
  });

  it("a baseline candidate lands below_threshold; kind, score and status options are honoured", async () => {
    const [baseline] = await insertSignals(service, owned.companyId, [candidate("https://rival.example/#abc", { source: "competitor_sites", baseline: true, url: "https://rival.example/" })], { kind: "opportunity" });
    expect((await getSignal(service, owned.companyId, baseline!))?.status).toBe("below_threshold");
    const [drop] = await insertSignals(service, owned.companyId, [candidate("metrics:site_visitors:2026-10-24", { source: "metrics", url: null })], { kind: "metric_drop", score: 0.75, status: "scored" });
    expect(await getSignal(owned.owner.client, owned.companyId, drop!)).toMatchObject({ kind: "metric_drop", source: "metrics", score: 0.75, status: "scored", url: null });
    const [error] = await insertSignals(service, owned.companyId, [candidate("12345", { source: "sentry", title: "TypeError: x is undefined", url: "https://sentry.io/issues/12345/" })], { kind: "error", score: 1 });
    expect(await getSignal(service, owned.companyId, error!)).toMatchObject({ kind: "error", score: 1, status: "new" });
  });

  it("M5 review L4: a candidate may carry its payload so the row is written once; rows without one keep {}", async () => {
    const issue = { id: "77001", shortId: "NORTH-7", title: "TypeError: y is undefined", level: "error" };
    const [withPayload] = await insertSignals(service, owned.companyId, [{ ...candidate("77001", { source: "sentry", url: "https://sentry.io/issues/77001/" }), payload: { issue } }], { kind: "error", score: 1 });
    expect((await getSignal(service, owned.companyId, withPayload!))?.payload).toEqual({ issue });
    expect((await signalByRef(service, owned.companyId, "reddit", "r-a-2"))?.payload).toEqual({});
    await expect(insertSignals(service, owned.companyId, [{ ...candidate("77002"), payload: ["not", "an", "object"] as never }], { kind: "error" })).rejects.toThrow();
  });

  it("getSignal and signalByRef are company-scoped; knownSourceRefs lists one source's refs", async () => {
    const found = await signalByRef(owned.owner.client, owned.companyId, "reddit", "r-a-1");
    expect(found?.sourceRef).toBe("r-a-1");
    expect(await signalByRef(service, owned.companyId, "producthunt", "r-a-1")).toBeNull();
    const foreign = await createCompanyFor(owned.owner, "signals-foreign");
    expect(await getSignal(service, foreign, found!.id)).toBeNull();
    expect(await signalByRef(service, foreign, "reddit", "r-a-1")).toBeNull();
    expect([...(await knownSourceRefs(service, owned.companyId, "reddit"))].sort()).toEqual(["r-a-1", "r-a-2", "r-a-3"]);
    expect(await knownSourceRefs(service, owned.companyId, "competitor_sites")).toEqual(["https://rival.example/#abc"]);
    expect(await knownSourceRefs(service, foreign, "reddit")).toEqual([]);
  });

  it("updateSignal patches status, score, summary, rationale and links; the row must belong to the company", async () => {
    const row = await signalByRef(service, owned.companyId, "reddit", "r-a-1");
    const scored = await updateSignal(service, owned.companyId, row!.id, { status: "scored", score: 0.85, summary: "A founder wants exactly this", rationale: "Keyword overlap with the thesis" });
    expect(scored).toMatchObject({ id: row!.id, status: "scored", score: 0.85, summary: "A founder wants exactly this", rationale: "Keyword overlap with the thesis" });
    expect(typeof scored.scoredAt).toBe("string");
    expect(scored.updatedAt >= scored.createdAt).toBe(true);
    const foreign = await createCompanyFor(owned.owner, "signals-foreign-2");
    await expect(updateSignal(service, foreign, row!.id, { status: "declined" })).rejects.toBeInstanceOf(DbError);
    expect((await getSignal(service, owned.companyId, row!.id))?.status).toBe("scored");
    await expect(updateSignal(service, owned.companyId, row!.id, { score: 2 })).rejects.toThrow();
    await expect(updateSignal(service, owned.companyId, row!.id, { status: "maybe" as never })).rejects.toThrow();
  });

  it("PRO-3-CAP: the second opportunity card of a week throws SignalCapError and leaves the row untouched; a metric_drop is never capped", async () => {
    const a = await signalByRef(service, owned.companyId, "reddit", "r-a-1");
    const b = await signalByRef(service, owned.companyId, "reddit", "r-a-2");
    const opened = await updateSignal(service, owned.companyId, a!.id, { status: "card_opened", cardWeek: "2026-W43" });
    expect(opened).toMatchObject({ status: "card_opened", cardWeek: "2026-W43" });
    await expect(updateSignal(service, owned.companyId, b!.id, { status: "card_opened", cardWeek: "2026-W43" })).rejects.toBeInstanceOf(SignalCapError);
    expect(await getSignal(service, owned.companyId, b!.id)).toMatchObject({ status: "new", cardWeek: null });
    const capped = await updateSignal(service, owned.companyId, b!.id, { status: "capped" });
    expect(capped.status).toBe("capped");
    const drop = await signalByRef(service, owned.companyId, "metrics", "metrics:site_visitors:2026-10-24");
    expect((await updateSignal(service, owned.companyId, drop!.id, { status: "card_opened", cardWeek: "2026-W43" })).cardWeek).toBe("2026-W43");
    expect((await listSignals(service, owned.companyId, { cardWeek: "2026-W43" })).map((s) => s.sourceRef).sort()).toEqual(["metrics:site_visitors:2026-10-24", "r-a-1"]);
  });

  it("listSignals filters by status, kind, week and age, newest first, with a limit", async () => {
    const all = await listSignals(owned.owner.client, owned.companyId, {});
    expect(all.length).toBe(7);
    expect([...all].every((s, i, arr) => i === 0 || arr[i - 1]!.createdAt >= s.createdAt)).toBe(true);
    expect((await listSignals(owned.owner.client, owned.companyId, { kind: ["error"] })).map((s) => s.source)).toEqual(["sentry", "sentry"]);
    expect((await listSignals(owned.owner.client, owned.companyId, { status: ["capped", "card_opened"] })).length).toBe(3);
    expect((await listSignals(owned.owner.client, owned.companyId, { limit: 2 })).length).toBe(2);
    const old = await raw.from("signals").insert({ company_id: owned.companyId, kind: "opportunity", source: "producthunt", source_ref: "ph-old", title: "Old", created_at: "2020-01-01T00:00:00Z" }).select("id").single();
    expect(old.error).toBeNull();
    expect((await listSignals(owned.owner.client, owned.companyId, { sinceDays: 7 })).some((s) => s.sourceRef === "ph-old")).toBe(false);
    expect((await listSignals(owned.owner.client, owned.companyId, {})).some((s) => s.sourceRef === "ph-old")).toBe(true);
    await expect(listSignals(service, owned.companyId, { limit: 0 })).rejects.toThrow();
  });

  it("owners and strangers never write signals; a stranger sees nothing", async () => {
    await expect(insertSignals(owned.owner.client, owned.companyId, [candidate("forged")], { kind: "opportunity" })).rejects.toBeInstanceOf(DbError);
    const row = await signalByRef(service, owned.companyId, "reddit", "r-a-3");
    await expect(updateSignal(owned.owner.client, owned.companyId, row!.id, { status: "approved" })).rejects.toBeInstanceOf(DbError);
    expect((await getSignal(service, owned.companyId, row!.id))?.status).toBe("new");
    expect(await listSignals(stranger.client, owned.companyId, {})).toEqual([]);
    expect(await getSignal(stranger.client, owned.companyId, row!.id)).toBeNull();
    expect(await knownSourceRefs(stranger.client, owned.companyId, "reddit")).toEqual([]);
    await expect(insertSignals(service, owned.companyId, [{ ...candidate("bad"), url: "javascript:alert(1)" }], { kind: "opportunity" })).rejects.toThrow();
  });
});
