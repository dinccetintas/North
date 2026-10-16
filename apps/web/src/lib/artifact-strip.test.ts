import { describe, expect, it } from "vitest";
import { ARTIFACT_STRIP_LIMIT, INCIDENT_PIN_DAYS, stripArtifacts } from "./artifact-strip";

const NOW = new Date("2026-10-16T12:00:00Z");
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();
const art = (id: string, kind: string, hoursAgo: number) => ({ id, kind, title: `${kind} ${id}`, version: 1, createdAt: ago(hoursAgo) });

describe("M5 error-to-fix: the home strip keeps a recent incident report in view", () => {
  it("pins an incident report from the last week ahead of newer artifacts", () => {
    const newest = ["a", "b", "c", "d", "e", "f"].map((id, i) => art(id, "prd", i));
    const incident = art("inc", "incident_report", 10);
    const strip = stripArtifacts([...newest, incident], NOW);
    expect(strip).toHaveLength(ARTIFACT_STRIP_LIMIT);
    expect(strip[0]?.id).toBe("inc");
    expect(strip.slice(1).map((a) => a.id)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("lets an incident report older than the pin window age out like any artifact", () => {
    const newest = ["a", "b", "c", "d", "e", "f"].map((id, i) => art(id, "prd", i));
    const old = art("old", "incident_report", INCIDENT_PIN_DAYS * 24 + 1);
    expect(stripArtifacts([...newest, old], NOW).map((a) => a.id)).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("keeps the newest-first order when nothing is pinned and never mutates its input", () => {
    const input = Object.freeze([art("x", "prd", 1), art("y", "market_report", 2)]);
    expect(stripArtifacts(input, NOW).map((a) => a.id)).toEqual(["x", "y"]);
    expect(input.map((a) => a.id)).toEqual(["x", "y"]);
  });

  it("never fills the strip with incidents alone: at most two are pinned", () => {
    const incidents = ["i1", "i2", "i3"].map((id, i) => art(id, "incident_report", 20 + i));
    const newest = ["a", "b", "c", "d", "e", "f"].map((id, i) => art(id, "prd", i));
    expect(stripArtifacts([...newest, ...incidents], NOW).map((a) => a.id)).toEqual(["i1", "i2", "a", "b", "c", "d"]);
  });
});
