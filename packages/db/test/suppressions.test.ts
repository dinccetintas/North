// CMP-1 (0019): the suppression list and the sender identity through the repositories, against the real database.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordAction } from "../src/actions";
import { getSenderIdentity, setSenderIdentity } from "../src/companies";
import { DbError } from "../src/errors";
import { addSuppression, countSuppressions, listSuppressed } from "../src/suppressions";
import { createOwnerWithCompany, createTestUser, deleteTestUser, raw, service, type OwnedCompany, type TestUser } from "./fixtures";
import { maxRowsServiceClient, POSTGREST_MAX_ROWS } from "./max-rows";

describe("CMP-1 suppressions repository", () => {
  let owned: OwnedCompany;
  let rival: OwnedCompany;
  let stranger: TestUser;

  beforeAll(async () => {
    owned = await createOwnerWithCompany("suppressions");
    rival = await createOwnerWithCompany("suppressions-rival");
    stranger = await createTestUser("suppressions-stranger");
  });

  afterAll(async () => {
    await deleteTestUser(owned.owner);
    await deleteTestUser(rival.owner);
    await deleteTestUser(stranger);
  });

  const stored = async (companyId: string, email: string) => (await raw.from("suppressions").select("id, email, reason, source_action_id").eq("company_id", companyId).eq("email", email)).data as { id: string; email: string; reason: string; source_action_id: string | null }[];

  it("CMP-1 addSuppression lower-cases and trims the address, returns the row id, and a duplicate inserts a second row", async () => {
    const first = await addSuppression(service, { companyId: owned.companyId, email: "  Dup@Example.COM ", reason: "opt_out" });
    const second = await addSuppression(service, { companyId: owned.companyId, email: "dup@example.com", reason: "complaint" });
    expect(first).not.toBe(second);
    const rows = await stored(owned.companyId, "dup@example.com");
    expect(rows.map((r) => r.id).sort()).toEqual([first, second].sort());
    expect(rows.map((r) => r.reason).sort()).toEqual(["complaint", "opt_out"]);
  });

  it("CMP-1 addSuppression takes a bare domain and the action that caused it", async () => {
    const actionId = await recordAction(service, { companyId: owned.companyId, taskId: null, agentRole: "research", kind: "research", tier: "K0", description: "Read the bounce", status: "executed" });
    const id = await addSuppression(service, { companyId: owned.companyId, email: "Bounced.Test", reason: "bounce", sourceActionId: actionId });
    expect(await stored(owned.companyId, "bounced.test")).toEqual([{ id, email: "bounced.test", reason: "bounce", source_action_id: actionId }]);
  });

  it("CMP-1 addSuppression refuses what is not an address or a domain, an unknown reason, a bad id, and an action that does not exist", async () => {
    const ok = { companyId: owned.companyId, email: "refused@example.com", reason: "manual" } as const;
    for (const email of ["", "  ", "a b@example.com", "a@b@example.com", "@example.com", "nodot", "x".repeat(255)]) {
      await expect(addSuppression(service, { ...ok, email })).rejects.toThrow();
    }
    await expect(addSuppression(service, { ...ok, reason: "because" as never })).rejects.toThrow();
    await expect(addSuppression(service, { ...ok, companyId: "not-a-uuid" })).rejects.toThrow();
    await expect(addSuppression(service, { ...ok, sourceActionId: "nope" })).rejects.toThrow();
    await expect(addSuppression(service, { ...ok, sourceActionId: "00000000-0000-4000-8000-000000000000" })).rejects.toBeInstanceOf(DbError);
    await expect(addSuppression(stranger.client, { ...ok, companyId: owned.companyId })).rejects.toBeInstanceOf(DbError);
    expect(await stored(owned.companyId, "refused@example.com")).toEqual([]);
  });

  it("CMP-1 listSuppressed finds ADA@Example.com and b@blocked.io given the rows ada@example.com and blocked.io, but not a subdomain", async () => {
    await addSuppression(service, { companyId: owned.companyId, email: "ada@example.com", reason: "opt_out" });
    await addSuppression(service, { companyId: owned.companyId, email: "blocked.io", reason: "legal_block" });
    const found = await listSuppressed(service, owned.companyId, ["ADA@Example.com", " b@blocked.io ", "c@other.io", "d@sub.blocked.io", "ada@example.org"]);
    expect(found).toEqual(["ada@example.com", "b@blocked.io"]);
    expect(Object.isFrozen(found)).toBe(true);
  });

  it("CMP-1 listSuppressed answers in input order without repeats, and nothing for an empty list or clean addresses", async () => {
    expect(await listSuppressed(service, owned.companyId, [])).toEqual([]);
    expect(await listSuppressed(service, owned.companyId, ["clean@example.net"])).toEqual([]);
    expect(await listSuppressed(service, owned.companyId, ["z@blocked.io", "ADA@example.com", "z@blocked.io", "ada@example.com"])).toEqual(["z@blocked.io", "ada@example.com"]);
  });

  it("CMP-1 listSuppressed reads one company only: another company's suppression of the same address does not count", async () => {
    await addSuppression(service, { companyId: rival.companyId, email: "only-rival@example.com", reason: "manual" });
    await addSuppression(service, { companyId: rival.companyId, email: "rival-domain.test", reason: "manual" });
    expect(await listSuppressed(service, owned.companyId, ["only-rival@example.com", "x@rival-domain.test"])).toEqual([]);
    expect(await listSuppressed(service, rival.companyId, ["only-rival@example.com", "x@rival-domain.test"])).toEqual(["only-rival@example.com", "x@rival-domain.test"]);
  });

  it("CMP-1 listSuppressed covers a list longer than one query carries, at both ends and by domain", async () => {
    await addSuppression(service, { companyId: owned.companyId, email: "u0@bulk.test", reason: "opt_out" });
    await addSuppression(service, { companyId: owned.companyId, email: "u149@bulk.test", reason: "opt_out" });
    await addSuppression(service, { companyId: owned.companyId, email: "late-domain.test", reason: "manual" });
    const inputs = [...Array.from({ length: 150 }, (_, i) => `U${i}@bulk.test`), "last@late-domain.test"];
    expect(await listSuppressed(service, owned.companyId, inputs)).toEqual(["u0@bulk.test", "u149@bulk.test", "last@late-domain.test"]);
  });

  it("CMP-1 listSuppressed refuses an input that is not a list of strings (the recipients are validated at the boundary)", async () => {
    await expect(listSuppressed(service, "not-a-uuid", ["a@example.com"])).rejects.toThrow();
    await expect(listSuppressed(service, owned.companyId, [42 as never])).rejects.toThrow();
  });

  it("CMP-1 countSuppressions counts the company's rows, history included; the owner sees the same count and a stranger sees none", async () => {
    const total = (await raw.from("suppressions").select("id", { count: "exact", head: true }).eq("company_id", owned.companyId)).count;
    expect(total).toBeGreaterThan(5);
    expect(await countSuppressions(service, owned.companyId)).toBe(total);
    expect(await countSuppressions(owned.owner.client, owned.companyId)).toBe(total);
    expect(await countSuppressions(stranger.client, owned.companyId)).toBe(0);
    expect(await countSuppressions(service, rival.companyId)).toBe(2);
  });
});

describe("CMP-1 suppressions read past PostgREST's row cap", () => {
  let bulk: OwnedCompany;

  beforeAll(async () => {
    bulk = await createOwnerWithCompany("suppressions-bulk");
  });

  afterAll(async () => {
    await deleteTestUser(bulk.owner);
  });

  it("CMP-1 listSuppressed pages: a history of more than 1000 repeats for one address cannot hide another suppressed address", async () => {
    const repeats = Array.from({ length: POSTGREST_MAX_ROWS + 1 }, (_, i) => ({ id: `00000000-0000-4000-8000-${i.toString(16).padStart(12, "0")}`, company_id: bulk.companyId, email: "repeat@bulk.test", reason: "opt_out" }));
    // The last row by id: an unpaged read cut at 1000 rows would lose exactly this one.
    const last = { id: "ffffffff-ffff-4fff-8fff-ffffffffffff", company_id: bulk.companyId, email: "late@bulk.test", reason: "bounce" };
    expect((await raw.from("suppressions").insert([...repeats, last])).error).toBeNull();
    const capped = maxRowsServiceClient();
    expect(await listSuppressed(capped.client, bulk.companyId, ["repeat@bulk.test", "late@bulk.test", "clean@bulk.test"])).toEqual(["repeat@bulk.test", "late@bulk.test"]);
    expect(capped.cut).toEqual([]);
    expect(Math.max(...capped.limits)).toBeLessThanOrEqual(POSTGREST_MAX_ROWS);
    expect(await countSuppressions(capped.client, bulk.companyId)).toBe(POSTGREST_MAX_ROWS + 2);
  });
});

describe("CMP-1 sender identity repository", () => {
  let owned: OwnedCompany;
  let stranger: TestUser;

  beforeAll(async () => {
    owned = await createOwnerWithCompany("sender-identity");
    stranger = await createTestUser("sender-identity-stranger");
  });

  afterAll(async () => {
    await deleteTestUser(owned.owner);
    await deleteTestUser(stranger);
  });

  it("CMP-1 getSenderIdentity is null until the identity is set; setSenderIdentity then getSenderIdentity round-trips (the owner sets it as themselves)", async () => {
    expect(await getSenderIdentity(owned.owner.client, owned.companyId)).toBeNull();
    await setSenderIdentity(owned.owner.client, owned.companyId, { legalName: "  North Test Ltd ", postalAddress: " 1 Example Street, 10115 Berlin " });
    const identity = await getSenderIdentity(owned.owner.client, owned.companyId);
    expect(identity).toEqual({ legalName: "North Test Ltd", postalAddress: "1 Example Street, 10115 Berlin" });
    expect(Object.isFrozen(identity)).toBe(true);
    expect(await getSenderIdentity(service, owned.companyId)).toEqual(identity);
    await setSenderIdentity(owned.owner.client, owned.companyId, { legalName: "North Test GmbH", postalAddress: "2 Example Street, 10115 Berlin" });
    expect(await getSenderIdentity(service, owned.companyId)).toEqual({ legalName: "North Test GmbH", postalAddress: "2 Example Street, 10115 Berlin" });
  });

  it("CMP-1 getSenderIdentity is null unless both columns are set and readable as an identity", async () => {
    const column = (patch: Record<string, unknown>) => raw.from("companies").update(patch).eq("id", owned.companyId);
    expect((await column({ postal_address: null })).error).toBeNull();
    expect(await getSenderIdentity(service, owned.companyId)).toBeNull();
    expect((await column({ legal_name: null, postal_address: "2 Example Street, 10115 Berlin" })).error).toBeNull();
    expect(await getSenderIdentity(service, owned.companyId)).toBeNull();
    expect((await column({ legal_name: "North Test GmbH", postal_address: "short" })).error).toBeNull();
    expect(await getSenderIdentity(service, owned.companyId)).toBeNull();
  });

  it("CMP-1 getSenderIdentity is null for a company that is not yours or does not exist", async () => {
    await setSenderIdentity(service, owned.companyId, { legalName: "North Test GmbH", postalAddress: "2 Example Street, 10115 Berlin" });
    expect(await getSenderIdentity(stranger.client, owned.companyId)).toBeNull();
    expect(await getSenderIdentity(service, "00000000-0000-4000-8000-000000000000")).toBeNull();
    await expect(getSenderIdentity(service, "not-a-uuid")).rejects.toThrow();
  });

  it("CMP-1 setSenderIdentity refuses an identity the rules would not print, and a company that is not yours", async () => {
    const good = { legalName: "North Test GmbH", postalAddress: "3 Example Street, 10115 Berlin" };
    await expect(setSenderIdentity(owned.owner.client, owned.companyId, { ...good, legalName: "  " })).rejects.toThrow();
    await expect(setSenderIdentity(owned.owner.client, owned.companyId, { ...good, postalAddress: "short" })).rejects.toThrow();
    await expect(setSenderIdentity(owned.owner.client, owned.companyId, { ...good, legalName: "x".repeat(121) })).rejects.toThrow();
    await expect(setSenderIdentity(stranger.client, owned.companyId, good)).rejects.toBeInstanceOf(DbError);
    await expect(setSenderIdentity(service, "00000000-0000-4000-8000-000000000000", good)).rejects.toBeInstanceOf(DbError);
    expect(await getSenderIdentity(service, owned.companyId)).toEqual({ legalName: "North Test GmbH", postalAddress: "2 Example Street, 10115 Berlin" });
  });
});
