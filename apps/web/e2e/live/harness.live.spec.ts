import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, request, test } from "@playwright/test";
import { statusOutside } from "./helpers";
import { BYPASS_HEADER } from "./staging-env";

/**
 * TST-5: a self-check of the live journey's harness, runnable without
 * staging (no browser, a local server only). Playwright copies every `use`
 * option a new request context does not name into it, so a bypass header in
 * `use` would reach the agent-built `e2e-` preview through `statusOutside`.
 * Here `use` carries a canary header: a plain context sends it (the runner
 * does copy options) and the preview check's context does not.
 */
const CANARY = "canary-not-a-secret";

test.use({ extraHTTPHeaders: { [BYPASS_HEADER]: CANARY } });

/** Starts a server on 127.0.0.1 that answers 200 and keeps each request's headers. */
async function recordingServer(): Promise<{ readonly url: string; readonly seen: readonly IncomingHttpHeaders[]; readonly close: () => Promise<void> }> {
  const seen: IncomingHttpHeaders[] = [];
  const server = createServer((req, res) => {
    seen.push(req.headers);
    res.end("ok");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/`, seen, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

test("harness (TST-5): the preview check sends no Vercel bypass header, even when the runner would copy one in", async () => {
  const server = await recordingServer();
  try {
    const inheriting = await request.newContext();
    await inheriting.get(server.url);
    await inheriting.dispose();
    const answer = await statusOutside(server.url);
    expect(answer.status).toBe(200);
    expect(server.seen.map((headers) => headers[BYPASS_HEADER] ?? null)).toEqual([CANARY, null]);
  } finally {
    await server.close();
  }
});
