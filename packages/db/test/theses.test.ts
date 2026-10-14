import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addThesisVersion, currentThesis, saveClarifications } from "../src/theses";
import { DbError } from "../src/errors";
import { createOwnerWithCompany, createTestUser, deleteTestUser, service, type OwnedCompany, type TestUser } from "./fixtures";

describe("theses repository (ONB-1)", () => {
  let owned: OwnedCompany;
  let stranger: TestUser;
  const answers = [
    { id: "q1", question: "Who pays?", answer: "Clinic managers" },
    { id: "q2", question: "Smallest version?", answer: "A waitlist form" },
  ];

  beforeAll(async () => {
    owned = await createOwnerWithCompany("theses", "Clinics need a queue app that patients actually use.");
    stranger = await createTestUser("theses-stranger");
  });

  afterAll(async () => {
    await deleteTestUser(owned.owner);
    await deleteTestUser(stranger);
  });

  it("currentThesis returns v1 created with the company and empty clarifications", async () => {
    const thesis = await currentThesis(owned.owner.client, owned.companyId);
    expect(thesis).toMatchObject({ version: 1, text: "Clinics need a queue app that patients actually use.", clarifications: [] });
  });

  it("saveClarifications stores the answers on the current version", async () => {
    await saveClarifications(owned.owner.client, owned.companyId, answers);
    const thesis = await currentThesis(owned.owner.client, owned.companyId);
    expect(thesis?.clarifications).toEqual(answers);
  });

  it("saveClarifications rejects malformed answers before touching the database", async () => {
    await expect(saveClarifications(owned.owner.client, owned.companyId, [{ id: "bad", question: "x", answer: "y" }])).rejects.toThrow();
  });

  it("addThesisVersion appends v2 and carries the clarifications forward", async () => {
    const created = await addThesisVersion(owned.owner.client, owned.companyId, {
      text: "Clinics need a queue app patients use; clinic managers pay for it.",
      targetCustomer: "Clinic managers",
      whyNow: "Post-pandemic staffing gaps",
    });
    expect(created.version).toBe(2);
    const thesis = await currentThesis(service, owned.companyId);
    expect(thesis).toMatchObject({ id: created.id, version: 2, targetCustomer: "Clinic managers", whyNow: "Post-pandemic staffing gaps", clarifications: answers });
  });

  it("another owner sees no thesis and cannot attach clarifications", async () => {
    expect(await currentThesis(stranger.client, owned.companyId)).toBeNull();
    await expect(saveClarifications(stranger.client, owned.companyId, answers)).rejects.toBeInstanceOf(DbError);
  });
});
