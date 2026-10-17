/**
 * TST-2: the cassette check, hardened (fix round 1 of Task 18). Each case is a
 * way a secret, a hand edit or a stale recording got past the first version:
 * a key split across stream events, a `s` escape, a credential header in
 * any case, a field the schema did not know, a gzip body that cannot be read, a
 * `requestScrubbed` that lies, and a reply that echoes a made-up address.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { secretFindings, verdictFor } from "./cassette-check";
import { PIN, b64, edited, editedText, makeDir, parsed, recordIn, removeDir, requestBody, type Recorded } from "./cassette-check-fixtures";

let dir: string;
beforeEach(async () => {
  dir = await makeDir();
});
afterEach(async () => {
  await removeDir(dir);
});

const record = (body?: Record<string, unknown>, userAgent?: string, reply?: { body?: string; headers?: Record<string, string> }) => recordIn(dir, body, userAgent, reply);
const failuresOf = (file: Recorded, pin = PIN) => verdictFor(file, pin).failures.join("\n");

const piece = (index: number, text: string) => `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index, delta: { type: "text_delta", text } })}\n\n`;
const SSE = { "content-type": "text/event-stream" };

describe("TST-2 a reply's text is read the way its reader reads it", () => {
  /** A recording whose reply is swapped for `reply` afterwards: the gateway's writer refuses to record these, so they can only get into a file by hand. */
  const withReply = async (reply: string, headers: Record<string, string>, body = requestBody()): Promise<Recorded> =>
    edited(await record(body), (j) => {
      j.response.body = b64(reply);
      j.response.headers = headers;
    });

  it("a key split across two stream events fails; the same pieces in two blocks do not", async () => {
    const split = await withReply(piece(0, "sk-") + piece(0, "ant-api03-AbCdEf123"), SSE);
    expect(failuresOf(split)).toMatch(/response body.*Anthropic key/);
    expect(failuresOf(split)).not.toContain("AbCdEf123");
    const apart = await withReply(piece(0, "sk-") + piece(1, "ant-api03-AbCdEf123"), SSE, requestBody({ n: 2 }));
    expect(verdictFor(apart, PIN)).toMatchObject({ failures: [], warnings: [] });
  });

  it("the reviewer's stream: two events with no index at all, and the event name on its own line", async () => {
    const event = (text: string) => `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text } })}\n\n`;
    const file = await withReply(event("sk-") + event("ant-api03-AbCdEf123"), SSE, requestBody({ n: 6 }));
    expect(failuresOf(file)).toMatch(/response body.*Anthropic key/);
  });

  it("a key spelled with a JSON escape in a reply fails", async () => {
    const file = await withReply('{"content":[{"type":"text","text":"\\u0073k-ant-api03-AbCd"}]}', { "content-type": "application/json" });
    expect(failuresOf(file)).toMatch(/response body.*Anthropic key/);
  });

  it("a key spelled with a JSON escape in a header value or the path fails (the parsed strings are scanned, not the file text)", async () => {
    const base = edited(await record(), (j) => {
      j.request.headers["x-note"] = "PLACEHOLDER";
    });
    const inHeader = editedText(base, (t) => t.replace("PLACEHOLDER", "\\u0073k-ant-api03-LEAK"));
    expect(failuresOf(inHeader)).toMatch(/headers, path or metadata.*Anthropic key/);
    const inPath = editedText(
      edited(await record(requestBody({ n: 3 })), (j) => {
        j.request.path = "PLACEHOLDER";
      }),
      (t) => t.replace("PLACEHOLDER", "/v1/messages?k=\\u0073k-ant-api03-LEAK"),
    );
    expect(failuresOf(inPath)).toMatch(/Anthropic key/);
  });

  it("the bearer scheme in any case is a bearer token, in a header and in a body", async () => {
    const file = edited(await record(), (j) => {
      j.request.headers["x-note"] = "bearer ghp_abcdefghijklmnopqrstuvwxyz0123";
    });
    expect(failuresOf(file)).toMatch(/headers.*bearer token/i);
    expect(secretFindings("BEARER abcdefghijklmnop1234")).toEqual([expect.stringMatching(/bearer token/i)]);
    expect(secretFindings("the bearer of this note, bearer shortword")).toEqual([]);
  });
});

describe("TST-2 a made-up @north.test address in a reply is expected; anywhere else it is not", () => {
  it("a reply that echoes bob@north.test only warns, naming the place", async () => {
    const file = await record(requestBody(), undefined, { body: '{"content":[{"type":"text","text":"write to bob@north.test"}]}' });
    const verdict = verdictFor(file, PIN);
    expect(verdict.failures).toEqual([]);
    expect(verdict.warnings).toEqual([expect.stringMatching(/response body.*@north\.test/)]);
    expect(verdict.warnings.join("\n")).not.toContain("bob");
  });

  it("a key or a bearer token in the same reply still fails, with the address only a warning", async () => {
    const file = edited(await record(requestBody(), undefined, { body: '{"text":"bob@north.test"}' }), (j) => {
      j.response.body = b64('{"text":"bob@north.test and Bearer abcdefghijklmnop1234"}');
    });
    const verdict = verdictFor(file, PIN);
    expect(verdict.failures).toEqual([expect.stringMatching(/response body.*bearer token/i)]);
    expect(verdict.warnings).toEqual([expect.stringMatching(/response body.*@north\.test/)]);
  });

  it("in a request body, a header or the path it fails", async () => {
    const base = await record();
    const inBody = edited(base, (j) => {
      j.request.body = b64(JSON.stringify(requestBody({ note: "mail bob@north.test" })));
    });
    expect(failuresOf(inBody)).toMatch(/request body.*@north\.test/);
    const inResponseHeader = edited(base, (j) => {
      j.response.headers["x-echo"] = "bob@north.test";
    });
    expect(failuresOf(inResponseHeader)).toMatch(/headers.*@north\.test/);
    const inPath = edited(base, (j) => {
      j.request.path = "/v1/messages?to=bob@north.test";
    });
    expect(failuresOf(inPath)).toMatch(/@north\.test/);
  });
});

describe("TST-2 what the gateway never stores fails", () => {
  it("a credential header, in any case, request or response", async () => {
    for (const name of ["Authorization", "x-api-key", "X-Api-Key", "Proxy-Authorization", "COOKIE", "Set-Cookie"]) {
      const file = edited(await record(), (j) => {
        j.request.headers[name] = "something-short";
      });
      expect(failuresOf(file), name).toMatch(new RegExp(`request header "${name.toLowerCase()}" is a credential header`));
    }
    const response = edited(await record(requestBody({ n: 4 })), (j) => {
      j.response.headers["Set-Cookie"] = "__cf_bm=abc";
    });
    expect(failuresOf(response)).toMatch(/response header "set-cookie" is a credential header/);
  });

  it("a header with a 15-character bearer token fails by its name even though the token is too short to be token-shaped", async () => {
    const file = edited(await record(), (j) => {
      j.request.headers.Authorization = "Bearer abcdefghijklmno";
    });
    expect(failuresOf(file)).toMatch(/credential header/);
  });

  it("a content-encoded reply fails: its text cannot be scanned; identity is fine", async () => {
    const gzip = edited(await record(), (j) => {
      j.response.headers["Content-Encoding"] = "gzip";
      j.response.body = b64("\x1f\x8b opaque");
    });
    expect(failuresOf(gzip)).toMatch(/content-encoded \(gzip\)/);
    const identity = edited(await record(requestBody({ n: 5 })), (j) => {
      j.response.headers["content-encoding"] = "identity";
    });
    expect(verdictFor(identity, PIN)).toMatchObject({ failures: [], warnings: [] });
  });

  it("a field the schema does not know fails at the file, the request, the response and meta", async () => {
    const hidden = b64("sk-ant-api03-HIDDEN");
    const where: Array<[string, (j: ReturnType<typeof parsed>) => void]> = [
      ["file", (j) => void (j.notes = hidden)],
      ["request", (j) => void ((j.request as Record<string, unknown>).notes = hidden)],
      ["response", (j) => void ((j.response as Record<string, unknown>).notes = hidden)],
      ["meta", (j) => void ((j.meta as Record<string, unknown>).notes = hidden)],
    ];
    for (const [level, change] of where) {
      const file = edited(await record(requestBody({ level })), change);
      expect(failuresOf(file), level).toMatch(/not a valid cassette.*notes/);
      expect(failuresOf(file), level).not.toContain("HIDDEN");
    }
  });
});

describe("TST-2 the key and the SDK version are checked against the request, not against what meta claims", () => {
  it("requestScrubbed: true on a request holding no redaction marker is a lie: the key is recomputed and an edit fails", async () => {
    const file = edited(await record(), (j) => {
      j.meta = { ...j.meta, requestScrubbed: true };
      j.request.body = b64(JSON.stringify(requestBody({ max_tokens: 1 })));
    });
    expect(failuresOf(file)).toMatch(/recomputed from the stored request.*no redaction marker/);
  });

  it("requestScrubbed: true on a request that was scrubbed is believed", async () => {
    const file = await record(requestBody({ note: "mail bob@north.test" }));
    expect(parsed(file).meta?.requestScrubbed).toBe(true);
    expect(verdictFor(file, PIN)).toMatchObject({ failures: [], warnings: [] });
  });

  it("a stored path that is not the canonical key path fails (the gateway stores keyPathOf)", async () => {
    const file = edited(await record(), (j) => {
      j.request.path = "/v1/./messages?beta=true";
    });
    expect(failuresOf(file)).toMatch(/recomputed from the stored request/);
  });

  it("a user agent that is claude-cli but names no agent-sdk warns 'SDK version not recorded' instead of skipping the pin", async () => {
    const file = await record(requestBody(), "claude-cli/2.1.301 (external, cli)");
    expect(parsed(file).meta?.sdkVersion).toBeNull();
    const verdict = verdictFor(file, PIN);
    expect(verdict.failures).toEqual([]);
    expect(verdict.warnings).toEqual([expect.stringMatching(/SDK version not recorded.*claude-cli\/2\.1\.301/)]);
  });

  it("another client (the API SDK) has no SDK version and no warning", async () => {
    expect(verdictFor(await record(requestBody(), "Anthropic/JS 0.134.0"), PIN)).toMatchObject({ failures: [], warnings: [] });
  });

  it("a pre-meta cassette is compared to the pin by its stored user agent", async () => {
    const file = edited(await record(), (j) => {
      delete j.meta;
    });
    expect(verdictFor(file, PIN)).toMatchObject({ failures: [], warnings: [] });
    expect(failuresOf(file, "0.3.302")).toMatch(/0\.3\.301.*0\.3\.302/);
  });

  it("a meta.sdkVersion that disagrees with the stored user agent fails: the pin cannot be dodged by editing meta", async () => {
    const file = edited(await record(requestBody(), "claude-cli/2.1.301 (external, sdk-ts, agent-sdk/0.3.299)"), (j) => {
      j.meta = { ...j.meta, sdkVersion: PIN };
    });
    expect(failuresOf(file)).toMatch(/meta\.sdkVersion 0\.3\.301 disagrees with the user agent's 0\.3\.299/);
  });
});
