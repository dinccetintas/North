/**
 * TST-2: the cassette check (`scripts/cassette-check.ts`). Cassettes are written
 * by the gateway's own `writeCassette` into a temp directory (so the writer and
 * the checker are tested against each other); a file is then broken the way a
 * hand edit, a rename or a stale recording would. No stack, no network, no key.
 */
import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkDirectory, readPin, sdkVersionOf, secretFindings, summaryLine, verdictFor } from "./cassette-check";
import { PIN, SDK_AGENT, b64, edited, makeDir, makeSubdir, parsed, putIn, recordIn, removeDir, requestBody, type Recorded } from "./cassette-check-fixtures";

let dir: string;
beforeEach(async () => {
  dir = await makeDir();
});
afterEach(async () => {
  await removeDir(dir);
});

const record = (body?: Record<string, unknown>, userAgent?: string) => recordIn(dir, body, userAgent);
const put = (file: Recorded) => putIn(dir, file);

describe("TST-2 secretFindings", () => {
  it("finds an Anthropic key, a bearer token and a @north.test address, and nothing in clean text", () => {
    expect(secretFindings("key sk-ant-api03-AbC_dEf-123")).toEqual([expect.stringMatching(/Anthropic key/)]);
    expect(secretFindings("Authorization: Bearer abcdefghijklmnop1234")).toEqual([expect.stringMatching(/bearer token/i)]);
    expect(secretFindings("mail bob.o+tag@north.test")).toEqual([expect.stringMatching(/@north\.test/)]);
    expect(secretFindings("Draft a market report for Acme, mail ana@example.com, the bearer of this note, Bearer shortword, sk-ant-")).toEqual([]);
  });

  it("accepts what the scrubber leaves: sk-ant-REDACTED, Bearer REDACTED and redacted@north.test, and nothing that only starts like them", () => {
    expect(secretFindings("sk-ant-REDACTED Bearer REDACTED redacted@north.test")).toEqual([]);
    expect(secretFindings("sk-ant-REDACTEDabc")).toHaveLength(1);
    expect(secretFindings("sk-ant-REDACTED-2")).toHaveLength(1);
    expect(secretFindings("xredacted@north.test")).toHaveLength(1);
    expect(secretFindings("redacted@north.test and bob@north.test")).toHaveLength(1);
  });

  it("reads a long unbroken run (a base64 body, a minified blob) in linear time: a megabyte of one character is not a hang", () => {
    const started = Date.now();
    expect(secretFindings("a".repeat(1_000_000))).toEqual([]);
    expect(secretFindings(`${"Zm9v".repeat(250_000)}@north.test`)).toHaveLength(1);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("names each kind once, and never echoes the secret", () => {
    const found = secretFindings("sk-ant-api03-ONE sk-ant-api03-TWO Bearer abcdefghijklmnop1234 a@north.test b@north.test");
    expect(found).toHaveLength(3);
    expect(found.join("\n")).not.toMatch(/ONE|TWO|abcdefghijklmnop1234|a@north/);
  });
});

describe("TST-2 sdkVersionOf (the gateway's reading of the user agent)", () => {
  it("is the one the cassette check uses", () => {
    expect(sdkVersionOf(SDK_AGENT)).toBe(PIN);
    expect(sdkVersionOf("claude-cli/2.1.301 (external, cli)")).toBeNull();
  });
});

describe("TST-2 verdictFor", () => {
  it("a clean recording passes with no warning", async () => {
    const file = await record();
    expect(verdictFor(file, PIN)).toEqual({ name: file.name, failures: [], warnings: [] });
  });

  it("sk-ant-abc in the response body fails, says where, and does not repeat the key", async () => {
    const file = edited(await record(), (j) => {
      j.response.body = b64('{"text":"my key is sk-ant-abc"}');
    });
    const verdict = verdictFor(file, PIN);
    expect(verdict.failures).toEqual([expect.stringMatching(/response body.*Anthropic key/)]);
    expect(verdict.failures.join("\n")).not.toContain("sk-ant-abc");
  });

  it("a secret in the request body, a header or the path fails too", async () => {
    const base = await record();
    const inBody = edited(base, (j) => {
      j.request.body = b64(JSON.stringify(requestBody({ note: "mail bob@north.test" })));
    });
    expect(verdictFor(inBody, PIN).failures.join("\n")).toMatch(/request body.*@north\.test/);
    const inHeader = edited(base, (j) => {
      j.response.headers["x-echo"] = "Bearer abcdefghijklmnop1234";
    });
    expect(verdictFor(inHeader, PIN).failures.join("\n")).toMatch(/headers.*bearer token/i);
    const inPath = edited(base, (j) => {
      j.request.path = "/v1/messages?k=sk-ant-api03-LEAK";
    });
    expect(verdictFor(inPath, PIN).failures.join("\n")).toMatch(/Anthropic key/);
  });

  it("a request that the gateway scrubbed passes: redacted values are what a committed cassette holds", async () => {
    const file = await record(requestBody({ note: "key sk-ant-api03-LEAK, Bearer LEAKTOKENLEAKTOKEN1234, mail bob@north.test" }));
    expect(Buffer.from(parsed(file).request.body, "base64").toString()).not.toContain("LEAK");
    expect(parsed(file).meta?.requestScrubbed).toBe(true);
    expect(verdictFor(file, PIN)).toEqual({ name: file.name, failures: [], warnings: [] });
  });

  it("a file whose name is not its key fails, whatever its content", async () => {
    const file = await record();
    const other = "0".repeat(64);
    expect(verdictFor({ ...file, name: `${other}.json` }, PIN).failures).toEqual([expect.stringMatching(/name.*does not match its key/)]);
    expect(verdictFor({ ...file, name: "copy of cassette.json" }, PIN).failures).toEqual([expect.stringMatching(/name.*does not match its key/)]);
  });

  it("a recording from another Agent SDK than the pin fails, naming both versions", async () => {
    const file = await record();
    const verdict = verdictFor(file, "0.3.302");
    expect(verdict.failures).toEqual([expect.stringMatching(/0\.3\.301.*0\.3\.302/)]);
    expect(verdict.failures[0]).toMatch(/packages\/agents\/package\.json/);
  });

  it("a recording by a client with no Agent SDK in its user agent has no version to compare", async () => {
    const file = await record(requestBody(), "Anthropic/JS 0.134.0");
    expect(parsed(file).meta?.sdkVersion).toBeNull();
    expect(verdictFor(file, "9.9.9")).toEqual({ name: file.name, failures: [], warnings: [] });
  });

  it("an unscrubbed request that no longer hashes to its name fails: the body was edited by hand", async () => {
    const file = edited(await record(), (j) => {
      j.request.body = b64(JSON.stringify(requestBody({ max_tokens: 65 })));
    });
    expect(verdictFor(file, PIN).failures).toEqual([expect.stringMatching(/recomputed from the stored request.*not/)]);
    const path = edited(await record(), (j) => {
      j.request.path = "/v1/messages";
    });
    expect(verdictFor(path, PIN).failures).toEqual([expect.stringMatching(/recomputed from the stored request/)]);
  });

  it("a request body that is not JSON cannot be rehashed: a failure with meta, an unverifiable warning without", async () => {
    const withMeta = edited(await record(), (j) => {
      j.request.body = b64("not json");
    });
    expect(verdictFor(withMeta, PIN).failures).toEqual([expect.stringMatching(/not JSON/)]);
    const old = edited(withMeta, (j) => {
      delete j.meta;
    });
    expect(verdictFor(old, PIN)).toMatchObject({ failures: [], warnings: [expect.stringMatching(/unverifiable \(pre-meta cassette\)/)] });
  });

  it("a scrubbed request is not rehashed: its body differs from what the key was made of, and meta says so", async () => {
    const file = await record(requestBody({ note: "mail bob@north.test" }));
    expect(verdictFor(file, PIN).warnings).toEqual([]);
  });

  it("a pre-meta cassette whose body was scrubbed warns 'unverifiable (pre-meta cassette)' and does not fail", async () => {
    const file = edited(await record(requestBody({ note: "mail bob@north.test" })), (j) => {
      delete j.meta;
    });
    const verdict = verdictFor(file, PIN);
    expect(verdict.failures).toEqual([]);
    expect(verdict.warnings).toEqual([expect.stringMatching(/unverifiable \(pre-meta cassette\)/)]);
  });

  it("a pre-meta cassette whose key recomputes passes without a warning", async () => {
    const file = edited(await record(), (j) => {
      delete j.meta;
    });
    expect(verdictFor(file, PIN)).toEqual({ name: file.name, failures: [], warnings: [] });
  });

  it("a file that is not JSON, or not a cassette, fails with a reason", async () => {
    const file = await record();
    expect(verdictFor({ ...file, text: "{ nope" }, PIN).failures).toEqual([expect.stringMatching(/not JSON/)]);
    const broken = edited(file, (j) => {
      j.response.status = 99;
    });
    expect(verdictFor(broken, PIN).failures).toEqual([expect.stringMatching(/not a valid cassette/)]);
    const noMetaFields = edited(file, (j) => {
      j.meta = { sdkVersion: "0.3.301" };
    });
    expect(verdictFor(noMetaFields, PIN).failures).toEqual([expect.stringMatching(/not a valid cassette.*meta/)]);
  });

  it("reports every problem at once", async () => {
    const file = edited(await record(), (j) => {
      j.response.body = b64("sk-ant-abc");
      j.request.body = b64(JSON.stringify(requestBody({ max_tokens: 1 })));
    });
    expect(verdictFor({ ...file, name: `${"1".repeat(64)}.json` }, "0.3.302").failures).toHaveLength(4);
  });
});

describe("TST-2 checkDirectory", () => {
  it("an empty directory has 0 files and passes", async () => {
    const report = await checkDirectory(dir, PIN);
    expect(report).toMatchObject({ files: 0, warnings: 0, failures: 0 });
    expect(summaryLine(report)).toBe("cassette check: 0 files, 0 warnings");
  });

  it("clean files pass and are counted; README.md is not a cassette", async () => {
    await record();
    await record(requestBody({ max_tokens: 65 }));
    await writeFile(join(dir, "README.md"), "# Cassettes\n");
    const report = await checkDirectory(dir, PIN);
    expect(report).toMatchObject({ files: 2, warnings: 0, failures: 0 });
    expect(summaryLine(report)).toBe("cassette check: 2 files, 0 warnings");
  });

  it("a file with a secret fails, and the report names the file and the reason", async () => {
    const file = edited(await record(), (j) => {
      j.response.body = b64('{"k":"sk-ant-abc"}');
    });
    await put(file);
    const report = await checkDirectory(dir, PIN);
    expect(report.failures).toBe(1);
    expect(report.lines.join("\n")).toMatch(new RegExp(`FAIL ${file.name}: response body.*Anthropic key`));
    expect(summaryLine(report)).toBe("cassette check: 1 files, 0 warnings, 1 failed");
  });

  it("a renamed file fails", async () => {
    const file = await record();
    await rename(join(dir, file.name), join(dir, "renamed.json"));
    const report = await checkDirectory(dir, PIN);
    expect(report.failures).toBe(1);
    expect(report.lines.join("\n")).toMatch(/FAIL renamed\.json: .*does not match its key/);
  });

  it("a stale SDK version fails and a pre-meta scrubbed file warns, in one run", async () => {
    await record();
    const old = edited(await record(requestBody({ note: "mail bob@north.test" })), (j) => {
      delete j.meta;
    });
    await put(old);
    expect(await checkDirectory(dir, PIN)).toMatchObject({ files: 2, warnings: 1, failures: 0 });
    const stale = await checkDirectory(dir, "0.3.302");
    expect(stale).toMatchObject({ files: 2, warnings: 1, failures: 2 }); // the pre-meta file is compared by its stored user agent
    expect(stale.lines.join("\n")).toMatch(/WARN .*unverifiable \(pre-meta cassette\)/);
    expect(summaryLine(stale)).toBe("cassette check: 2 files, 1 warnings, 2 failed");
  });

  it("anything else in the directory fails: a leftover temp file or a subdirectory could carry what the checks never read", async () => {
    await record();
    await writeFile(join(dir, `.${"a".repeat(64)}.123abc.tmp`), "{}");
    await makeSubdir(dir, "old");
    const report = await checkDirectory(dir, PIN);
    expect(report.failures).toBe(2);
    expect(report.lines.join("\n")).toMatch(/FAIL \.a+\.123abc\.tmp: unexpected file/);
    expect(report.lines.join("\n")).toMatch(/FAIL old: unexpected directory/);
  });

  it("a directory that does not exist is a failure, not an empty set", async () => {
    const report = await checkDirectory(join(dir, "nope"), PIN);
    expect(report.failures).toBe(1);
    expect(report.lines.join("\n")).toMatch(/cannot read the cassette directory/);
  });
});

describe("TST-2 readPin", () => {
  it("reads the Agent SDK pin from the agents package", async () => {
    await writeFile(join(dir, "package.json"), JSON.stringify({ dependencies: { "@anthropic-ai/claude-agent-sdk": "0.3.301" } }));
    expect(await readPin(join(dir, "package.json"))).toBe("0.3.301");
    expect(await readPin(new URL("../packages/agents/package.json", import.meta.url).pathname)).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("fails when the package does not pin the SDK", async () => {
    await writeFile(join(dir, "package.json"), JSON.stringify({ dependencies: {} }));
    await expect(readPin(join(dir, "package.json"))).rejects.toThrow(/claude-agent-sdk/);
  });
});
