import { describe, expect, it } from "vitest";
import { AgentOutputSchema, MAX_OUTPUT_FILES, OutputFilesSchema, TASK_OWNER, WorkspacePathSchema } from "../src/tasks/types";
import { providerForAction, CONNECTION_PROVIDERS, PROVIDER_TITLES } from "../src/connections";
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
    expect(evidenceKindFor("email.send.reply")).toBe("message_id");
    expect(evidenceKindFor("repo.push")).toBeNull();
  });

  it("task/escalated carries the reason", () => {
    expect(EVENT.taskEscalated).toBe("task/escalated");
    expect(TaskEscalatedSchema.safeParse({ companyId: "11111111-1111-4111-8111-111111111111", taskId: "11111111-1111-4111-8111-111111111112", taskType: "build_site", reason: "x" }).success).toBe(true);
    expect(TaskEscalatedSchema.safeParse({ companyId: "nope", taskId: "x", taskType: "build_site", reason: "" }).success).toBe(false);
  });
});
