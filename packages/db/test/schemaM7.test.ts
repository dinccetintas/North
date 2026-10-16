import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordAction } from "../src/actions";
import { purgeOwner } from "../src/purge";
import { createOwnerWithCompany, deleteTestUser, endEntitlement, anon, raw, service, type OwnedCompany, type RawClient } from "./fixtures";

/**
 * 0019_m7_outreach_compliance.sql (CMP-1): the suppression list is an
 * append-only, owner-readable, worker-written table; the sender identity is
 * two owner-writable columns on `companies`.
 */
describe("M7 schema: suppressions and sender identity (CMP-1)", () => {
  let owned: OwnedCompany;
  let other: OwnedCompany;
  let ownerRaw: RawClient;
  let otherRaw: RawClient;

  beforeAll(async () => {
    owned = await createOwnerWithCompany("schema-m7");
    other = await createOwnerWithCompany("schema-m7-other");
    ownerRaw = owned.owner.client as unknown as RawClient;
    otherRaw = other.owner.client as unknown as RawClient;
  });

  afterAll(async () => {
    await deleteTestUser(owned.owner);
    await deleteTestUser(other.owner);
  });

  const row = (companyId: string, email: string, overrides: Record<string, unknown> = {}) => ({ company_id: companyId, email, reason: "opt_out", ...overrides });
  const suppress = async (companyId: string, email: string, overrides: Record<string, unknown> = {}): Promise<string> => {
    const { data, error } = await raw.from("suppressions").insert(row(companyId, email, overrides)).select("id").single();
    if (error) throw new Error(error.message);
    return (data as { id: string }).id;
  };

  it("CMP-1 suppressions: an address or a bare domain in lower case, one of five reasons, 3 to 254 characters, and the domain is generated", async () => {
    const id = await suppress(owned.companyId, "ada@example.com");
    const stored = await raw.from("suppressions").select("email, domain, reason, source_action_id, created_at").eq("id", id).single();
    expect(stored.data).toMatchObject({ email: "ada@example.com", domain: "example.com", reason: "opt_out", source_action_id: null });
    expect(Number.isNaN(Date.parse((stored.data as { created_at: string }).created_at))).toBe(false);

    for (const reason of ["opt_out", "bounce", "complaint", "manual", "legal_block"]) {
      expect((await raw.from("suppressions").insert(row(owned.companyId, `${reason}@reasons.test`, { reason }))).error).toBeNull();
    }
    expect((await raw.from("suppressions").insert(row(owned.companyId, "blocked.io"))).error).toBeNull();

    expect((await raw.from("suppressions").insert(row(owned.companyId, "Ada@Example.com"))).error?.message).toMatch(/suppressions_email_check/);
    expect((await raw.from("suppressions").insert(row(owned.companyId, "ab"))).error?.message).toMatch(/suppressions_email_check/);
    expect((await raw.from("suppressions").insert(row(owned.companyId, `${"a".repeat(244)}@example.com`))).error?.message).toMatch(/suppressions_email_check/);
    expect((await raw.from("suppressions").insert(row(owned.companyId, "reason@invalid.test", { reason: "because" }))).error?.message).toMatch(/suppressions_reason_check/);
    expect((await raw.from("suppressions").insert(row(owned.companyId, "domain@forced.test", { domain: "other.test" }))).error?.message).toMatch(/domain/);
  });

  it("CMP-1 suppressions: the same address twice is two rows (history), and a source action must exist", async () => {
    await suppress(owned.companyId, "twice@example.com", { reason: "bounce" });
    await suppress(owned.companyId, "twice@example.com", { reason: "complaint" });
    const rows = await raw.from("suppressions").select("reason").eq("company_id", owned.companyId).eq("email", "twice@example.com");
    expect((rows.data as { reason: string }[]).map((r) => r.reason).sort()).toEqual(["bounce", "complaint"]);

    const actionId = await recordAction(service, { companyId: owned.companyId, taskId: null, agentRole: "research", kind: "research", tier: "K0", description: "Read about Ada", status: "executed" });
    const linked = await raw.from("suppressions").insert(row(owned.companyId, "linked@example.com", { source_action_id: actionId })).select("source_action_id").single();
    expect(linked.data).toEqual({ source_action_id: actionId });
    const dangling = await raw.from("suppressions").insert(row(owned.companyId, "dangling@example.com", { source_action_id: "00000000-0000-4000-8000-000000000000" }));
    expect(dangling.error?.code).toBe("23503");
  });

  it("CMP-1 suppressions are append-only: an update and a delete raise, for the service role too", async () => {
    const id = await suppress(owned.companyId, "forever@example.com");
    const update = await raw.from("suppressions").update({ reason: "manual" }).eq("id", id);
    expect(update.error?.message).toMatch(/append-only/);
    const del = await raw.from("suppressions").delete().eq("id", id);
    expect(del.error?.message).toMatch(/append-only/);
    expect((await raw.from("suppressions").select("reason").eq("id", id).single()).data).toEqual({ reason: "opt_out" });
  });

  it("CMP-1 suppressions RLS: the owner reads their rows and not another owner's; a signed-out client reads none", async () => {
    await suppress(owned.companyId, "mine@rls.test");
    await suppress(other.companyId, "theirs@rls.test");
    const mine = await ownerRaw.from("suppressions").select("email, company_id").like("email", "%@rls.test");
    expect(mine.error).toBeNull();
    expect(mine.data).toEqual([{ email: "mine@rls.test", company_id: owned.companyId }]);
    const theirs = await ownerRaw.from("suppressions").select("email").eq("company_id", other.companyId);
    expect(theirs.data).toEqual([]);
    const theirOwn = await otherRaw.from("suppressions").select("email").like("email", "%@rls.test");
    expect(theirOwn.data).toEqual([{ email: "theirs@rls.test" }]);
    const signedOut = await (anon as unknown as RawClient).from("suppressions").select("email").like("email", "%@rls.test");
    expect(signedOut.data ?? []).toEqual([]);
  });

  it("CMP-1 suppressions: an owner cannot insert, update or delete (the worker writes with the service role)", async () => {
    const id = await suppress(owned.companyId, "readonly@rls.test");
    expect((await ownerRaw.from("suppressions").insert(row(owned.companyId, "sneaky@rls.test"))).error?.code).toBe("42501");
    expect((await ownerRaw.from("suppressions").update({ reason: "manual" }).eq("id", id)).error?.code).toBe("42501");
    expect((await ownerRaw.from("suppressions").delete().eq("id", id)).error?.code).toBe("42501");
    expect((await (anon as unknown as RawClient).from("suppressions").insert(row(owned.companyId, "anon@rls.test"))).error?.code).toBe("42501");
  });

  it("CMP-1 companies.legal_name and postal_address: the owner sets them as themselves, another owner cannot, and the lengths are bounded", async () => {
    const identity = { legal_name: "North Test Ltd", postal_address: "1 Example Street, 10115 Berlin, Germany" };
    const set = await ownerRaw.from("companies").update(identity).eq("id", owned.companyId).select("legal_name, postal_address").single();
    expect(set.data).toEqual(identity);

    const foreign = await otherRaw.from("companies").update({ postal_address: "6 Elsewhere Road, Nowhere" }).eq("id", owned.companyId).select("id");
    expect(foreign.error).toBeNull();
    expect(foreign.data).toEqual([]);
    expect((await raw.from("companies").select("legal_name, postal_address").eq("id", owned.companyId).single()).data).toEqual(identity);

    expect((await ownerRaw.from("companies").update({ legal_name: "x".repeat(121) }).eq("id", owned.companyId)).error?.message).toMatch(/companies_legal_name_check/);
    expect((await ownerRaw.from("companies").update({ postal_address: "x".repeat(301) }).eq("id", owned.companyId)).error?.message).toMatch(/companies_postal_address_check/);
    expect((await ownerRaw.from("companies").update({ legal_name: "x".repeat(120), postal_address: "y".repeat(300) }).eq("id", owned.companyId)).error).toBeNull();
    expect((await ownerRaw.from("companies").update({ legal_name: null, postal_address: null }).eq("id", owned.companyId)).error).toBeNull();
  });

  it("CMP-1 companies: the two new columns are the only ones the grant opens (the Sentry slug and the owner stay worker-only)", async () => {
    expect((await ownerRaw.from("companies").update({ sentry_project_slug: "squatted" }).eq("id", owned.companyId).select("id")).error?.code).toBe("42501");
    expect((await ownerRaw.from("companies").update({ owner_id: other.owner.id }).eq("id", owned.companyId).select("id")).error?.code).toBe("42501");
  });

  it("CMP-1 purge_owner still purges an owner who has suppressions (one pointing at an action) and re-enables the append-only trigger", async () => {
    const victim = await createOwnerWithCompany("schema-m7-victim");
    const actionId = await recordAction(service, { companyId: victim.companyId, taskId: null, agentRole: "research", kind: "research", tier: "K0", description: "Read about Bob", status: "executed" });
    await suppress(victim.companyId, "bob@example.com", { source_action_id: actionId });
    await suppress(victim.companyId, "blocked.example", { reason: "legal_block" });
    const witnessRow = await suppress(other.companyId, "witness@purge.test");

    await endEntitlement(victim.owner.id, { retentionPassed: true });
    const counts = await purgeOwner(service, victim.owner.id, "test");
    expect(counts).toMatchObject({ suppressions: 2, actions: 1, companies: 1, users: 1 });
    expect((await raw.from("suppressions").select("id", { count: "exact", head: true }).eq("company_id", victim.companyId)).count).toBe(0);
    expect((await raw.auth.admin.deleteUser(victim.owner.id)).error).toBeNull();

    expect((await raw.from("suppressions").update({ reason: "manual" }).eq("id", witnessRow)).error?.message).toMatch(/append-only/);
    expect((await raw.from("suppressions").delete().eq("id", witnessRow)).error?.message).toMatch(/append-only/);
  });
});
