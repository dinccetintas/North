import { describe, expect, it } from "vitest";
import { exportAccess, exportRows, expiresLabel, formatBytes, latestRepoRef, repoLinks } from "./export-view";

const NOW = new Date("2026-10-15T10:00:00.000Z");
const C1 = "00000000-0000-4000-8000-0000000000c1";

describe("EXP-1 export sizes, expiry and status words", () => {
  it("formats bytes in binary steps with one decimal", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(3_565_158)).toBe("3.4 MB");
    expect(formatBytes(2 * 1024 ** 3)).toBe("2.0 GB");
  });

  it("names the time left before the zip is removed", () => {
    expect(expiresLabel("2026-10-22T10:00:00.000Z", NOW)).toBe("expires in 7 d");
    expect(expiresLabel("2026-10-15T15:00:00.000Z", NOW)).toBe("expires in 5 h");
    expect(expiresLabel("2026-10-15T10:20:00.000Z", NOW)).toBe("expires within the hour");
    expect(expiresLabel("2026-10-14T10:00:00.000Z", NOW)).toBe("expired");
    expect(expiresLabel(null, NOW)).toBe("");
  });

  it("builds rows with the scope, the status word and whether the download is offered", () => {
    const rows = exportRows(
      [
        { id: "x1", kind: "full", companyId: null, status: "ready", bytes: 20_480, expiresAt: "2026-10-22T10:00:00.000Z", createdAt: "2026-10-15T09:00:00.000Z" },
        { id: "x2", kind: "artifacts", companyId: C1, status: "running", bytes: null, expiresAt: null, createdAt: "2026-10-15T09:30:00.000Z" },
        { id: "x3", kind: "data", companyId: C1, status: "ready", bytes: 100, expiresAt: "2026-10-14T00:00:00.000Z", createdAt: "2026-10-07T00:00:00.000Z" },
        { id: "x4", kind: "data", companyId: C1, status: "failed", bytes: null, expiresAt: null, createdAt: "2026-10-07T00:00:00.000Z" },
      ],
      new Map([[C1, "Acme"]]),
      NOW,
    );
    expect(rows.map((r) => [r.id, r.statusWord, r.scope, r.kindLabel, r.downloadable])).toEqual([
      ["x1", "ready", "All companies", "Everything", true],
      ["x2", "building", "Acme", "Artifacts (MD, PDF, PPTX)", false],
      ["x3", "expired", "Acme", "Data (JSON and CSV)", false],
      ["x4", "failed", "Acme", "Data (JSON and CSV)", false],
    ]);
    expect(rows[0]?.bytes).toBe("20.0 KB");
    expect(rows[0]?.expires).toBe("expires in 7 d");
    expect(rows[2]?.status).toBe("expired");
  });
});

describe("RET-1 export access", () => {
  it("stays open while ended inside the retention window and closes after it", () => {
    expect(exportAccess({ status: "active", retentionUntil: null, purgeDue: false }, NOW)).toBe("open");
    expect(exportAccess({ status: "ended", retentionUntil: "2027-01-12T00:00:00.000Z", purgeDue: false }, NOW)).toBe("open");
    expect(exportAccess({ status: "ended", retentionUntil: "2026-10-01T00:00:00.000Z", purgeDue: false }, NOW)).toBe("archived");
    expect(exportAccess({ status: "ended", retentionUntil: null, purgeDue: true }, NOW)).toBe("archived");
    expect(exportAccess(null, NOW)).toBe("open");
  });
});

describe("EXP-1 the code is already in your GitHub", () => {
  it("links https repositories and keeps every other reference as text", () => {
    expect(
      repoLinks([
        { companyId: "a", name: "Acme", ref: "https://github.com/founder/acme" },
        { companyId: "b", name: "Beta", ref: "sandbox://repos/founder/beta" },
        { companyId: "c", name: "Gamma", ref: "javascript:alert(1)" },
        { companyId: "d", name: "Delta", ref: null },
      ]),
    ).toEqual([
      { companyId: "a", name: "Acme", ref: "https://github.com/founder/acme", href: "https://github.com/founder/acme" },
      { companyId: "b", name: "Beta", ref: "sandbox://repos/founder/beta", href: null },
      { companyId: "c", name: "Gamma", ref: "javascript:alert(1)", href: null },
      { companyId: "d", name: "Delta", ref: null, href: null },
    ]);
  });
});

describe("EXP-1 the repository reference of a company", () => {
  const row = (status: string, externalRef: string | null) => ({ status, externalRef });

  it("takes repo.create as recorded: K1 rows are notified, not executed", () => {
    expect(latestRepoRef([row("notified", "sandbox://repos/sandbox/acme-site")])).toBe("sandbox://repos/sandbox/acme-site");
    expect(latestRepoRef([row("executed", "https://github.com/acme/site")])).toBe("https://github.com/acme/site");
  });

  it("skips rows without a reference or that never reached the provider, newest first", () => {
    expect(latestRepoRef([row("pending", null), row("failed", "x"), row("notified", "sandbox://repos/sandbox/old")])).toBe("sandbox://repos/sandbox/old");
    expect(latestRepoRef([row("notified", null)])).toBeNull();
    expect(latestRepoRef([])).toBeNull();
  });
});
