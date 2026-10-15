import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConnectionSecretError, dropConnectionSecret, getConnection, listConnections, readConnectionSecret, revokeConnection, storeConnectionSecret, upsertConnection } from "../src/connections";
import { DbError } from "../src/errors";
import { generateEncryptionKey, openSecret, sealSecret, encryptionKey } from "../src/secrets";
import { createTestUser, deleteTestUser, service, type TestUser } from "./fixtures";

const KEY = generateEncryptionKey();
const OTHER_KEY = generateEncryptionKey();

describe("secrets: AES-256-GCM sealing (ADR 0008)", () => {
  it("round-trips and fails closed on the wrong key or a tampered record", () => {
    const sealed = sealSecret("gho_token_123", encryptionKey(KEY));
    expect(sealed.ciphertext).not.toContain("gho_token");
    expect(openSecret(sealed, encryptionKey(KEY))).toBe("gho_token_123");
    expect(() => openSecret(sealed, encryptionKey(OTHER_KEY))).toThrow(ConnectionSecretError);
    const flipped = `${sealed.tag[0] === "A" ? "B" : "A"}${sealed.tag.slice(1)}`;
    expect(() => openSecret({ ...sealed, tag: flipped }, encryptionKey(KEY))).toThrow(ConnectionSecretError);
    expect(() => openSecret({ ...sealed, ciphertext: `${sealed.ciphertext.slice(0, -4)}AAAA` }, encryptionKey(KEY))).toThrow(ConnectionSecretError);
    expect(() => encryptionKey(undefined)).toThrow(/not set/);
    expect(() => encryptionKey("c2hvcnQ=")).toThrow(/32 bytes/);
    expect(() => sealSecret("", encryptionKey(KEY))).toThrow(/empty/);
  });
});

describe("connections repository (ONB-3, EXP-1)", () => {
  let alice: TestUser;
  let bob: TestUser;

  beforeAll(async () => {
    alice = await createTestUser("conn-alice");
    bob = await createTestUser("conn-bob");
  });

  afterAll(async () => {
    await deleteTestUser(alice);
    await deleteTestUser(bob);
  });

  it("upsertConnection creates one row per provider and getConnection/listConnections expose metadata only", async () => {
    const created = await upsertConnection(alice.client, { userId: alice.id, provider: "github", scopes: ["repo"], accountLabel: "alice-gh" });
    expect(created).toMatchObject({ userId: alice.id, provider: "github", status: "connected", scopes: ["repo"], accountLabel: "alice-gh" });
    expect(Object.isFrozen(created)).toBe(true);
    const again = await upsertConnection(alice.client, { userId: alice.id, provider: "github", scopes: ["repo", "workflow"], accountLabel: "alice-gh2" });
    expect(again.id).toBe(created.id);
    expect(again.scopes).toEqual(["repo", "workflow"]);
    expect(await getConnection(alice.client, alice.id, "github")).toEqual(again);
    expect(await getConnection(alice.client, alice.id, "vercel")).toBeNull();
    expect((await listConnections(alice.client, alice.id)).map((c) => c.provider)).toEqual(["github"]);
    expect(JSON.stringify(again)).not.toMatch(/ciphertext|token/);
  });

  it("secrets: the service role stores and reads back; owners and strangers see no secret row at all", async () => {
    const connection = await getConnection(service, alice.id, "github");
    await storeConnectionSecret(service, connection!.id, "gho_live_token", KEY);
    expect(await readConnectionSecret(service, connection!.id, KEY)).toBe("gho_live_token");
    await storeConnectionSecret(service, connection!.id, "gho_rotated", KEY);
    expect(await readConnectionSecret(service, connection!.id, KEY)).toBe("gho_rotated");

    await expect(readConnectionSecret(service, connection!.id, OTHER_KEY)).rejects.toBeInstanceOf(ConnectionSecretError);
    await expect(readConnectionSecret(alice.client, connection!.id, KEY)).rejects.toBeInstanceOf(DbError);
    await expect(storeConnectionSecret(alice.client, connection!.id, "forged", KEY)).rejects.toBeInstanceOf(DbError);
    const direct = await alice.client.from("connection_secrets").select("connection_id");
    expect(direct.data ?? []).toEqual([]);
    expect(await bob.client.from("connection_secrets").select("connection_id").then((r) => r.data ?? [])).toEqual([]);
  });

  it("a stranger cannot see, create for, or revoke another user's connection", async () => {
    expect(await listConnections(bob.client, alice.id)).toEqual([]);
    expect(await getConnection(bob.client, alice.id, "github")).toBeNull();
    await expect(upsertConnection(bob.client, { userId: alice.id, provider: "vercel" })).rejects.toBeInstanceOf(DbError);
    await expect(revokeConnection(bob.client, alice.id, "github")).rejects.toBeInstanceOf(DbError);
    expect((await getConnection(service, alice.id, "github"))?.status).toBe("connected");
  });

  it("revokeConnection keeps the row as revoked; dropConnectionSecret (service) removes the token", async () => {
    const before = await getConnection(service, alice.id, "github");
    const revokedId = await revokeConnection(alice.client, alice.id, "github");
    expect(revokedId).toBe(before!.id);
    expect((await getConnection(service, alice.id, "github"))?.status).toBe("revoked");
    expect(await readConnectionSecret(service, before!.id, KEY)).toBe("gho_rotated");
    await dropConnectionSecret(service, before!.id);
    await expect(readConnectionSecret(service, before!.id, KEY)).rejects.toBeInstanceOf(DbError);
    await dropConnectionSecret(service, before!.id);
    await expect(revokeConnection(service, alice.id, "stripe")).rejects.toBeInstanceOf(DbError);
  });

  it("rejects unknown providers in code and in the database", async () => {
    await expect(upsertConnection(service, { userId: alice.id, provider: "dropbox" as never })).rejects.toThrow();
    const direct = await service.from("connections").insert({ user_id: alice.id, provider: "dropbox" });
    expect(direct.error?.message).toMatch(/connections_provider_check/);
  });
});
