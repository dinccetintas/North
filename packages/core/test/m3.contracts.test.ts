import { describe, expect, it } from "vitest";
import { AgentOutputSchema, MAX_OUTPUT_FILES, OutputFilesSchema, TASK_OWNER, WorkspacePathSchema } from "../src/tasks/types";
import { providerForAction, CONNECTION_PROVIDERS, CONNECT_CARD_OPTIONS, isConnectCard, PROVIDER_TITLES } from "../src/connections";
import { ConnectionOauthCodeSchema, ConnectionRevokedSchema } from "../src/events";
import { isHttpUrl } from "../src/url";
import { evidenceKindFor } from "../src/evidence";
import { TaskEscalatedSchema, EVENT } from "../src/events";

describe("M3 contracts: engineering output files", () => {
  it("accepts relative paths only; rejects traversal, absolute and hidden segments", () => {
    for (const ok of ["index.html", "styles/site.css", "src/app/page.tsx", "README.md"]) expect(WorkspacePathSchema.safeParse(ok).success, ok).toBe(true);
    for (const bad of ["/etc/passwd", "../secrets", "a/../b", ".env", "src/.git/config", "a//b", ""]) expect(WorkspacePathSchema.safeParse(bad).success, bad).toBe(false);
  });

  it("bounds the file list: count, duplicates and total size", () => {
    const many = Array.from({ length: MAX_OUTPUT_FILES + 1 }, (_, i) => ({ path: `f${i}.txt`, content: "x" }));
    expect(OutputFilesSchema.safeParse(many).success).toBe(false);
    expect(OutputFilesSchema.safeParse([{ path: "a.txt", content: "1" }, { path: "a.txt", content: "2" }]).success).toBe(false);
    const big = Array.from({ length: 5 }, (_, i) => ({ path: `big${i}.txt`, content: "x".repeat(500 * 1024) }));
    expect(OutputFilesSchema.safeParse(big).success).toBe(false);
    expect(OutputFilesSchema.safeParse([{ path: "index.html", content: "<h1>hi</h1>" }]).success).toBe(true);
  });

  it("agent output carries files optionally and build_site/screen_designs have owners", () => {
    const out = AgentOutputSchema.parse({ summary: "built", artifacts: [{ kind: "build_report", title: "Build", markdown: "# ok" }], memory: [], files: [{ path: "index.html", content: "<h1/>" }] });
    expect(out.files?.[0]?.path).toBe("index.html");
    expect(AgentOutputSchema.parse({ summary: "s", artifacts: [], memory: [] }).files).toBeUndefined();
    expect(TASK_OWNER.build_site).toBe("engineering");
    expect(TASK_OWNER.screen_designs).toBe("design");
  });
});

describe("M3 contracts: connections and evidence", () => {
  it("maps external actions to the connection they need and nothing for internal ones", () => {
    expect(providerForAction("repo.push")).toBe("github");
    expect(providerForAction("deploy.production")).toBe("vercel");
    expect(providerForAction("ads.start")).toBe("meta_ads");
    expect(providerForAction("email.send.first_contact")).toBe("gmail");
    expect(providerForAction("research")).toBeNull();
    expect(providerForAction("contract.sign")).toBeNull();
    for (const p of CONNECTION_PROVIDERS) expect(PROVIDER_TITLES[p]).toBeTruthy();
  });

  it("names the evidence kind an action produces", () => {
    expect(evidenceKindFor("deploy.preview")).toBe("url");
    expect(evidenceKindFor("deploy.production")).toBe("url");
    expect(evidenceKindFor("email.send.reply")).toBe("message_id");
    expect(evidenceKindFor("support.reply.custom")).toBe("message_id");
    expect(evidenceKindFor("artifact.write")).toBe("artifact_id");
    expect(evidenceKindFor("repo.push")).toBeNull();
  });

  it("isHttpUrl accepts http(s) without credentials and nothing else (links in the UI, verifier input)", () => {
    expect(isHttpUrl("http://127.0.0.1:3101/sandbox/sites/x/")).toBe(true);
    expect(isHttpUrl("https://north-site.vercel.app")).toBe(true);
    for (const bad of ["javascript:alert(1)", "data:text/html,hi", "sandbox://repos/x", "http://user:pw@host/", "not a url", "", null, undefined, "ftp://x/"]) expect(isHttpUrl(bad)).toBe(false);
  });

  it("ONB-3: a connect card is recognised by both option ids, never by one alone", () => {
    expect(CONNECT_CARD_OPTIONS).toEqual({ connected: "connected", skip: "skip" });
    expect(isConnectCard({ options: [{ id: "connected" }, { id: "skip" }] })).toBe(true);
    expect(isConnectCard({ options: [{ id: "skip" }, { id: "connected" }, { id: "other" }] })).toBe(true);
    expect(isConnectCard({ options: [{ id: "approve" }, { id: "decline" }] })).toBe(false);
    expect(isConnectCard({ options: [{ id: "connected" }] })).toBe(false);
    expect(isConnectCard({ options: [] })).toBe(false);
  });

  it("connection events: the OAuth code event names a supported provider and a valid redirect; revoked covers every provider", () => {
    expect(EVENT.connectionOauthCode).toBe("connection/oauth_code");
    expect(EVENT.connectionRevoked).toBe("connection/revoked");
    const userId = "11111111-1111-4111-8111-111111111111";
    expect(ConnectionOauthCodeSchema.safeParse({ userId, provider: "github", code: "abc", redirectUri: "http://localhost:3100/api/connections/github/callback" }).success).toBe(true);
    expect(ConnectionOauthCodeSchema.safeParse({ userId, provider: "gmail", code: "abc", redirectUri: "http://x/cb" }).success).toBe(false);
    expect(ConnectionOauthCodeSchema.safeParse({ userId, provider: "github", code: "", redirectUri: "http://x/cb" }).success).toBe(false);
    expect(ConnectionOauthCodeSchema.safeParse({ userId, provider: "github", code: "a".repeat(2049), redirectUri: "http://x/cb" }).success).toBe(false);
    expect(ConnectionOauthCodeSchema.safeParse({ userId, provider: "vercel", code: "abc", redirectUri: "not a url" }).success).toBe(false);
    for (const provider of CONNECTION_PROVIDERS) expect(ConnectionRevokedSchema.safeParse({ userId, provider }).success).toBe(true);
    expect(ConnectionRevokedSchema.safeParse({ userId: "nope", provider: "github" }).success).toBe(false);
  });

  it("task/escalated carries the reason", () => {
    expect(EVENT.taskEscalated).toBe("task/escalated");
    expect(TaskEscalatedSchema.safeParse({ companyId: "11111111-1111-4111-8111-111111111111", taskId: "11111111-1111-4111-8111-111111111112", taskType: "build_site", reason: "x" }).success).toBe(true);
    expect(TaskEscalatedSchema.safeParse({ companyId: "nope", taskId: "x", taskType: "build_site", reason: "" }).success).toBe(false);
  });
});
