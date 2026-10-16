import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureAgentsForCompany, listAgents } from "../src/agents";
import { createOwnerWithCompany, createTestUser, deleteTestUser, service, type OwnedCompany, type TestUser } from "./fixtures";

describe("agents repository", () => {
  let owned: OwnedCompany;
  let stranger: TestUser;
  const roles = [
    { role: "chief_of_staff", configRef: "agents/chief_of_staff.yaml", maxActionTier: "K1" as const },
    { role: "research", configRef: "agents/research.yaml", maxActionTier: "K0" as const },
  ];

  beforeAll(async () => {
    owned = await createOwnerWithCompany("agents");
    stranger = await createTestUser("agents-stranger");
  });

  afterAll(async () => {
    await deleteTestUser(owned.owner);
    await deleteTestUser(stranger);
  });

  it("ensureAgentsForCompany creates one enabled agent per role", async () => {
    await ensureAgentsForCompany(service, owned.companyId, roles);
    const agents = await listAgents(owned.owner.client, owned.companyId);
    expect(agents.map(({ role, configRef, maxActionTier, enabled }) => ({ role, configRef, maxActionTier, enabled }))).toEqual([
      { role: "chief_of_staff", configRef: "agents/chief_of_staff.yaml", maxActionTier: "K1", enabled: true },
      { role: "research", configRef: "agents/research.yaml", maxActionTier: "K0", enabled: true },
    ]);
  });

  it("is idempotent and updates config/tier on a second run without duplicating rows", async () => {
    const before = await listAgents(owned.owner.client, owned.companyId);
    await ensureAgentsForCompany(service, owned.companyId, [{ role: "research", configRef: "agents/research-v2.yaml", maxActionTier: "K1" }]);
    const after = await listAgents(owned.owner.client, owned.companyId);
    expect(after.length).toBe(2);
    expect(after.map((a) => a.id).sort()).toEqual(before.map((a) => a.id).sort());
    expect(after.find((a) => a.role === "research")).toMatchObject({ configRef: "agents/research-v2.yaml", maxActionTier: "K1" });
  });

  it("an empty role list is a no-op and an invalid tier is rejected", async () => {
    await expect(ensureAgentsForCompany(service, owned.companyId, [])).resolves.toBeUndefined();
    await expect(ensureAgentsForCompany(service, owned.companyId, [{ role: "x", configRef: "y", maxActionTier: "K9" as never }])).rejects.toThrow();
  });

  it("only the worker seeds agents: neither the owner (0015, M6 review) nor another owner can", async () => {
    await expect(ensureAgentsForCompany(owned.owner.client, owned.companyId, roles)).rejects.toThrow();
    await expect(ensureAgentsForCompany(stranger.client, owned.companyId, roles)).rejects.toThrow();
    expect(await listAgents(stranger.client, owned.companyId)).toEqual([]);
  });
});
