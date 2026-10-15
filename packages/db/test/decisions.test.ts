import { localDay } from "@north/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordAction } from "../src/actions";
import { AlreadyAnsweredError, answerCard, cardsOpenedToday, getCard, listAnsweredCards, listCards, listCardsOpenedOn, listPendingCards, openCard, QuotaExceededError } from "../src/decisions";
import { DbError } from "../src/errors";
import { createTask } from "../src/tasks";
import { createCompanyFor, createOwnerWithCompany, createTestUser, deleteTestUser, sampleCardDraft, service, type OwnedCompany, type TestUser } from "./fixtures";

/** Test owners stay at the default zone, so their quota day is the UTC day. */
const today = (): string => localDay("UTC", new Date());

describe("decisions repository (DEC-2, DEC-3)", () => {
  let owned: OwnedCompany;
  let stranger: TestUser;

  beforeAll(async () => {
    owned = await createOwnerWithCompany("decisions");
    stranger = await createTestUser("decisions-stranger");
  });

  afterAll(async () => {
    await deleteTestUser(owned.owner);
    await deleteTestUser(stranger);
  });

  it("DEC-3: openCard assigns seq 1..3 and the fourth card of the day throws QuotaExceededError", async () => {
    const companyId = await createCompanyFor(owned.owner, "quota");
    expect(await cardsOpenedToday(owned.owner.client, companyId, today())).toBe(0);
    const seqs: number[] = [];
    for (let i = 0; i < 3; i++) {
      seqs.push((await openCard(service, { ...sampleCardDraft(companyId), taskId: null })).seq);
    }
    expect(seqs).toEqual([1, 2, 3]);
    expect(await cardsOpenedToday(owned.owner.client, companyId, today())).toBe(3);
    await expect(openCard(service, { ...sampleCardDraft(companyId), taskId: null })).rejects.toBeInstanceOf(QuotaExceededError);
    expect(await cardsOpenedToday(service, companyId, today())).toBe(3);
    expect(await cardsOpenedToday(service, companyId, "2000-01-01")).toBe(0);
    await expect(cardsOpenedToday(service, companyId, "today")).rejects.toThrow();
  });

  it("DEC-3: a card opened with openedAt yesterday lands on yesterday and does not count today", async () => {
    const companyId = await createCompanyFor(owned.owner, "yesterday");
    const yesterday = new Date(Date.now() - 86_400_000);
    const card = await openCard(service, { ...sampleCardDraft(companyId), taskId: null, openedAt: yesterday.toISOString() });
    expect(card.day).toBe(localDay("UTC", yesterday));
    expect(new Date(card.openedAt).toISOString()).toBe(yesterday.toISOString());
    expect(await cardsOpenedToday(service, companyId, today())).toBe(0);
    expect(await cardsOpenedToday(service, companyId, card.day)).toBe(1);
    expect((await listCardsOpenedOn(owned.owner.client, companyId, card.day)).map((c) => c.id)).toEqual([card.id]);
    expect(await listCardsOpenedOn(owned.owner.client, companyId, today())).toEqual([]);
    expect(await listCardsOpenedOn(stranger.client, companyId, card.day)).toEqual([]);
    const now = await openCard(service, { ...sampleCardDraft(companyId), taskId: null });
    expect(now.day).toBe(today());
    expect(typeof now.openedAt).toBe("string");
    await expect(openCard(service, { ...sampleCardDraft(companyId), taskId: null, openedAt: "yesterday" })).rejects.toThrow();
  });

  it("openCard stores the draft with its task and action links; getCard returns the frozen record", async () => {
    const task = await createTask(service, { companyId: owned.companyId, role: "growth", taskType: "campaign_spec", title: "Ad test" });
    const actionId = await recordAction(service, { companyId: owned.companyId, taskId: task.id, agentRole: "growth", kind: "ads.start", tier: "K2", description: "Start ads", status: "blocked" });
    const draft = sampleCardDraft(owned.companyId, { costUsd: 12.5, expectedImpact: "+20 signups" });
    const card = await openCard(service, { ...draft, taskId: task.id, actionId });
    expect(card).toMatchObject({
      companyId: owned.companyId,
      taskId: task.id,
      actionId,
      actionKind: "ads.start",
      tier: "K2",
      question: draft.question,
      options: draft.options,
      recommendedOptionId: "approve",
      defaultOptionId: "decline",
      rationale: draft.rationale,
      expectedImpact: "+20 signups",
      costUsd: 12.5,
      mergeKey: "ads.start:ads",
      seq: 1,
      answeredOptionId: null,
      answeredAt: null,
      answeredBy: null,
    });
    expect(Object.isFrozen(card)).toBe(true);
    expect(Object.isFrozen(card.options)).toBe(true);
    expect(await getCard(owned.owner.client, card.id)).toEqual(card);
    expect(await getCard(stranger.client, card.id)).toBeNull();
  });

  it("rejects drafts with unknown recommended/default options, K0/K1 tiers, and K3 with a default", async () => {
    const draft = sampleCardDraft(owned.companyId);
    await expect(openCard(service, { ...draft, recommendedOptionId: "nope", taskId: null })).rejects.toThrow();
    await expect(openCard(service, { ...draft, defaultOptionId: "nope", taskId: null })).rejects.toThrow();
    await expect(openCard(service, { ...draft, tier: "K1", taskId: null })).rejects.toThrow();
    await expect(openCard(service, { ...draft, tier: "K3", taskId: null })).rejects.toThrow();
    expect(await cardsOpenedToday(service, owned.companyId, today())).toBe(1);
  });

  it("answerCard rejects unknown options, records the answer once, then throws AlreadyAnsweredError", async () => {
    const companyId = await createCompanyFor(owned.owner, "answer");
    const card = await openCard(service, { ...sampleCardDraft(companyId), taskId: null });
    const unknown = answerCard(owned.owner.client, card.id, { optionId: "maybe", answeredBy: "user" });
    await expect(unknown).rejects.toBeInstanceOf(DbError);
    await expect(unknown).rejects.not.toBeInstanceOf(AlreadyAnsweredError);
    const answered = await answerCard(owned.owner.client, card.id, { optionId: "approve", answeredBy: "user" });
    expect(answered).toMatchObject({ id: card.id, answeredOptionId: "approve", answeredBy: "user" });
    expect(answered.answeredAt).toEqual(expect.any(String));
    await expect(answerCard(owned.owner.client, card.id, { optionId: "decline", answeredBy: "user" })).rejects.toBeInstanceOf(AlreadyAnsweredError);
    expect((await getCard(service, card.id))?.answeredOptionId).toBe("approve");
    expect(await listPendingCards(owned.owner.client, companyId)).toEqual([]);
  });

  it("DEC-2: a default answer must be the card's safe default, and K3 never has one", async () => {
    const companyId = await createCompanyFor(owned.owner, "defaults");
    const k2 = await openCard(service, { ...sampleCardDraft(companyId), taskId: null });
    await expect(answerCard(service, k2.id, { optionId: "approve", answeredBy: "default" })).rejects.toBeInstanceOf(DbError);
    expect((await answerCard(service, k2.id, { optionId: "decline", answeredBy: "default" })).answeredBy).toBe("default");
    const k3Draft = sampleCardDraft(companyId, { tier: "K3", actionKind: "contract.sign", defaultOptionId: null, mergeKey: "contract.sign:none" });
    const k3 = await openCard(service, { ...k3Draft, taskId: null });
    expect(k3).toMatchObject({ tier: "K3", defaultOptionId: null });
    await expect(answerCard(service, k3.id, { optionId: "decline", answeredBy: "default" })).rejects.toBeInstanceOf(DbError);
    expect((await getCard(service, k3.id))?.answeredAt).toBeNull();
    expect((await answerCard(service, k3.id, { optionId: "approve", answeredBy: "user" })).answeredOptionId).toBe("approve");
  });

  it("listPendingCards orders by due time then seq; listCards is newest first and honours the limit", async () => {
    const companyId = await createCompanyFor(owned.owner, "pending");
    const later = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const sooner = new Date(Date.now() + 3_600_000).toISOString();
    const a = await openCard(service, { ...sampleCardDraft(companyId, { dueAt: later }), taskId: null });
    const b = await openCard(service, { ...sampleCardDraft(companyId, { dueAt: sooner }), taskId: null });
    const c = await openCard(service, { ...sampleCardDraft(companyId, { dueAt: later }), taskId: null });
    expect((await listPendingCards(owned.owner.client, companyId)).map((x) => x.id)).toEqual([b.id, a.id, c.id]);
    await answerCard(service, a.id, { optionId: "approve", answeredBy: "user" });
    expect((await listPendingCards(owned.owner.client, companyId)).map((x) => x.id)).toEqual([b.id, c.id]);
    expect((await listCards(owned.owner.client, companyId)).map((x) => x.id)).toEqual([c.id, b.id, a.id]);
    expect((await listCards(owned.owner.client, companyId, { limit: 2 })).map((x) => x.id)).toEqual([c.id, b.id]);
    expect(await listPendingCards(stranger.client, companyId)).toEqual([]);
    expect(await listCards(stranger.client, companyId)).toEqual([]);
  });

  it("listAnsweredCards returns one kind's answered cards newest first as core AnsweredCard", async () => {
    const companyId = await createCompanyFor(owned.owner, "history");
    const ads = sampleCardDraft(companyId);
    const first = await openCard(service, { ...ads, costUsd: 10, taskId: null });
    const second = await openCard(service, { ...ads, costUsd: 25, taskId: null });
    const mail = sampleCardDraft(companyId, { actionKind: "email.send.first_contact", mergeKey: "email.send.first_contact:none", costUsd: 0 });
    const other = await openCard(service, { ...mail, taskId: null });
    await answerCard(service, first.id, { optionId: "approve", answeredBy: "user" });
    await answerCard(service, other.id, { optionId: "approve", answeredBy: "user" });
    await answerCard(service, second.id, { optionId: "approve", answeredBy: "auto_rule" });
    const history = await listAnsweredCards(owned.owner.client, companyId, "ads.start");
    expect(history.map((h) => h.costUsd)).toEqual([25, 10]);
    expect(history[0]).toEqual({ actionKind: "ads.start", mergeKey: "ads.start:ads", answeredOptionId: "approve", answeredAt: expect.any(String), costUsd: 25 });
    expect(Object.isFrozen(history)).toBe(true);
    expect(await listAnsweredCards(owned.owner.client, companyId, "ads.start", 1)).toHaveLength(1);
    expect(await listAnsweredCards(owned.owner.client, companyId, "contract.sign")).toEqual([]);
    expect(await listAnsweredCards(stranger.client, companyId, "ads.start")).toEqual([]);
  });

  it("only the worker opens cards: owners and strangers cannot insert, and a stranger cannot answer", async () => {
    await expect(openCard(stranger.client, { ...sampleCardDraft(owned.companyId), taskId: null })).rejects.toBeInstanceOf(DbError);
    await expect(openCard(owned.owner.client, { ...sampleCardDraft(owned.companyId), taskId: null })).rejects.toBeInstanceOf(DbError);
    const [card] = await listCards(service, owned.companyId);
    await expect(answerCard(stranger.client, card!.id, { optionId: "approve", answeredBy: "user" })).rejects.toBeInstanceOf(DbError);
    expect((await getCard(service, card!.id))?.answeredAt).toBeNull();
  });

  it("an owner's only write on a card is the answer: tier, default, options and day are the worker's", async () => {
    const companyId = await createCompanyFor(owned.owner, "owner-write");
    const card = await openCard(service, { ...sampleCardDraft(companyId), taskId: null });
    const tamper = await owned.owner.client.from("decision_cards").update({ default_option_id: "approve" }).eq("id", card.id).select("id");
    expect(tamper.error?.code).toBe("42501");
    const day = await owned.owner.client.from("decision_cards").update({ day: "2000-01-01" }).eq("id", card.id).select("id");
    expect(day.error?.code).toBe("42501");
    expect((await getCard(service, card.id))?.defaultOptionId).toBe("decline");
    expect((await answerCard(owned.owner.client, card.id, { optionId: "approve", answeredBy: "user" })).answeredOptionId).toBe("approve");
    const again = await owned.owner.client.from("decision_cards").update({ answered_option_id: "decline" }).eq("id", card.id).select("id");
    expect(again.data ?? []).toEqual([]);
    expect((await getCard(service, card.id))?.answeredOptionId).toBe("approve");
  });
});
