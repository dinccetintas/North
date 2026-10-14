import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { createCompany, getKillSwitch, setKillSwitch } from "../src/companies";
import { createTask } from "../src/tasks";
import { createTestUser, deleteTestUser, raw, type TestUser } from "./fixtures";
import { localSupabaseEnv } from "./env";

/** M1 security review: storage is read-only for owners, roles are enumerated, search is not anonymous. */
describe("M1 hardening", () => {
  let owner: TestUser;
  let companyId: string;

  beforeAll(async () => {
    owner = await createTestUser("hardening");
    companyId = (await createCompany(owner.client, { ownerId: owner.id, name: "Hardening Co", thesis: "A company used to prove the hardening migration." })).id;
  });

  afterAll(async () => {
    await deleteTestUser(owner);
  });

  it("owners cannot upload or delete artifact objects; the service role can", async () => {
    const path = `companies/${companyId}/doc/evidence-v1.md`;
    const ownerUpload = await owner.client.storage.from("artifacts").upload(path, new Blob(["# tampered"], { type: "text/markdown" }));
    expect(ownerUpload.error).not.toBeNull();
    const serviceUpload = await raw.storage.from("artifacts").upload(path, new Blob(["# real"], { type: "text/markdown" }));
    expect(serviceUpload.error).toBeNull();
    const ownerDelete = await owner.client.storage.from("artifacts").remove([path]);
    const stillThere = await raw.storage.from("artifacts").download(path);
    expect(ownerDelete.error ?? (ownerDelete.data?.length === 0 ? new Error("no-op") : null)).not.toBeNull();
    expect(await stillThere.data?.text()).toBe("# real");
  });

  it("tasks only accept the eight staff roles, in Zod and in the database", async () => {
    await expect(createTask(raw, { companyId, role: "hacker" as never, taskType: "prd", title: "x" })).rejects.toThrow();
    const direct = await raw.from("tasks").insert({ company_id: companyId, role: "hacker", task_type: "prd", title: "x" });
    expect(direct.error?.message).toMatch(/tasks_role_check/);
    const badType = await raw.from("tasks").insert({ company_id: companyId, role: "research", task_type: "mine_bitcoin", title: "x" });
    expect(badType.error?.message).toMatch(/tasks_task_type_check/);
  });

  it("anonymous callers cannot run search_memory", async () => {
    const env = localSupabaseEnv();
    const anon = createClient(env.url, env.anonKey, { auth: { persistSession: false } });
    const result = await anon.rpc("search_memory", { p_company_id: companyId, p_query: "anything", p_limit: 5 });
    expect(result.error).not.toBeNull();
  });

  it("getKillSwitch reads the flag and fails closed for unknown companies", async () => {
    expect(await getKillSwitch(raw, companyId)).toBe(false);
    await setKillSwitch(owner.client, companyId, true);
    expect(await getKillSwitch(raw, companyId)).toBe(true);
    expect(await getKillSwitch(raw, "00000000-0000-0000-0000-000000000000")).toBe(true);
  });
});
