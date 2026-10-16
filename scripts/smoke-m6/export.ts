/**
 * Phase 7 of the M6 smoke (docs/plans/M6.md "Acceptance test"): an export
 * while the subscription has ended. The owner's client requests it, the
 * worker builds the zip into the private bucket, the owner's client signs a
 * URL and downloads it; the entries, the exact markdown, the PDF's text and
 * the README's repositories are checked, and a stranger gets neither the
 * row nor a URL. The readers below look inside without a zip or PDF
 * dependency: the zip's central directory and pdf-lib's flate text streams.
 */
import { inflateRawSync, inflateSync } from "node:zlib";
import { EVENT, EXPORT_TTL_DAYS, exportPath } from "@north/core";
import { createCompany, exportStoragePath, getArtifactMarkdown, getExport, listActionsByKind, listArtifacts, recordAction, requestExport, signExportUrl, type ArtifactRecord, type ExportRecord } from "@north/db";
import { required, THESIS } from "./billing";
import { check, checkpoint, DAY_MS, db, send, until, withFacts, workerNow, type Company, type Ctx, type SignedInUser } from "./harness";

const EXPORT_MAX_MS = 60_000;
const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;

/** Every entry of a zip (stored or deflated), by name, read through the central directory (archiver writes data descriptors). */
export function unzip(bytes: Uint8Array): ReadonlyMap<string, Buffer> {
  const b = Buffer.from(bytes);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557) && eocd < 0; i -= 1) if (b.readUInt32LE(i) === EOCD) eocd = i;
  check(eocd >= 0, "export zip", "an end-of-central-directory record", `${b.length} bytes without one`);
  const entries = new Map<string, Buffer>();
  let p = b.readUInt32LE(eocd + 16);
  for (let n = b.readUInt16LE(eocd + 10); n > 0; n -= 1) {
    check(b.readUInt32LE(p) === CENTRAL, "export zip", `a central directory entry at ${p}`, b.readUInt32LE(p).toString(16));
    const [method, size, nameLength, extraLength, commentLength, local] = [b.readUInt16LE(p + 10), b.readUInt32LE(p + 20), b.readUInt16LE(p + 28), b.readUInt16LE(p + 30), b.readUInt16LE(p + 32), b.readUInt32LE(p + 42)];
    const name = b.toString("utf8", p + 46, p + 46 + nameLength);
    const start = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
    const data = b.subarray(start, start + size);
    entries.set(name, method === 0 ? Buffer.from(data) : inflateRawSync(data));
    p += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

const hexText = (hex: string): string => Buffer.from(hex.length % 2 === 0 ? hex : `${hex}0`, "hex").toString("latin1");

/** The text a pdf-lib PDF draws: every `<hex> Tj` and `(literal) Tj` of every (flate) content stream, one per line. */
export function pdfText(bytes: Uint8Array): string {
  const b = Buffer.from(bytes);
  const s = b.toString("latin1");
  const lines: string[] = [];
  const header = /<<((?:(?!>>).)*?\/Length (\d+)(?:(?!>>).)*?)>>\s*stream\r?\n/gs;
  for (let m = header.exec(s); m; m = header.exec(s)) {
    const raw = b.subarray(m.index + m[0].length, m.index + m[0].length + Number(m[2]));
    let text = "";
    try {
      text = (m[1] ?? "").includes("/FlateDecode") ? inflateSync(raw).toString("latin1") : raw.toString("latin1");
    } catch {
      continue;
    }
    for (const op of text.matchAll(/<([0-9A-Fa-f]*)>\s*Tj|\(((?:\\.|[^\\)])*)\)\s*Tj/g)) lines.push(op[1] !== undefined ? hexText(op[1]) : (op[2] ?? ""));
  }
  return lines.join("\n");
}

/** Letters and digits only, lower case: a heading survives wrapping, inline markdown and WinAnsi substitutions. */
const words = (text: string): string => text.replace(/[^A-Za-z0-9]+/g, " ").trim().toLowerCase();

/** The latest `repo.create` reference per company (what the README must name: the code is already theirs). */
async function repoUrl(company: Company): Promise<string> {
  const repo = (await listActionsByKind(db, company.id, "repo.create", 365)).find((a) => (a.status === "executed" || a.status === "notified") && a.externalRef?.startsWith("sandbox://repos/"));
  return required(repo?.externalRef, `the repository of ${company.slug}`);
}

const latest = (rows: readonly ArtifactRecord[], kind: string): ArtifactRecord =>
  required([...rows].filter((a) => a.kind === kind).sort((a, b) => b.version - a.version)[0], `a ${kind} artifact`);

/** `requested` by the owner's client → `export/requested` → `ready` within 60 s at `users/<uid>/exports/<id>.zip`, expiring in 7 days. */
async function readyExport(ctx: Ctx): Promise<ExportRecord> {
  const requested = await requestExport(ctx.owner, { userId: ctx.ownerId, companyId: null, kind: "full" });
  check(requested.status === "requested" && requested.storagePath === null, "export row", "requested, no path (the owner may insert nothing else)", requested);
  const simNow = await workerNow();
  const sentAt = Date.now();
  await send(EVENT.exportRequested, { exportId: requested.id, userId: ctx.ownerId });
  const done = await until("export ready", async () => {
    const e = await getExport(db, requested.id);
    return e && e.status !== "requested" && e.status !== "running" ? e : null;
  }, { timeoutMs: EXPORT_MAX_MS + 10_000, found: () => getExport(db, requested.id) });
  const ms = Date.now() - sentAt;
  check(done.status === "ready" && ms <= EXPORT_MAX_MS, "export", `ready within ${EXPORT_MAX_MS} ms`, { status: done.status, error: done.error, ms });
  check((done.bytes ?? 0) > 0 && done.storagePath === exportStoragePath(ctx.ownerId, done.id), "export object", `bytes > 0 at ${exportStoragePath(ctx.ownerId, done.id)}`, { bytes: done.bytes, path: done.storagePath });
  const ttl = Date.parse(done.expiresAt ?? "") - simNow.getTime();
  check(Math.abs(ttl - EXPORT_TTL_DAYS * DAY_MS) < 10 * 60_000, "export expires_at", `the worker clock + ${EXPORT_TTL_DAYS} d`, { expiresAt: done.expiresAt, workerNow: simNow.toISOString() });
  return done;
}

/** The owner's client signs the URL (1 h); the download is the stored zip, byte for byte. */
async function download(ctx: Ctx, record: ExportRecord): Promise<ReadonlyMap<string, Buffer>> {
  const url = await signExportUrl(ctx.owner, record);
  check(url, "signed export URL", "a URL from the owner's own client", url);
  const response = await fetch(url);
  check(response.ok, "export download", "200", response.status);
  const bytes = new Uint8Array(await response.arrayBuffer());
  check(bytes.length === record.bytes, "export size", `${record.bytes} bytes`, bytes.length);
  return unzip(bytes);
}

async function entryChecks(ctx: Ctx, entries: ReadonlyMap<string, Buffer>): Promise<void> {
  const [c1, c2] = [ctx.c1, required(ctx.c2, "company 2")];
  const artifacts = await listArtifacts(db, c1.id);
  const prd = latest(artifacts, "prd");
  const deck = latest(artifacts, "investor_deck");
  const prdMd = exportPath(c1.slug, "prd", prd.title, prd.version, "md");
  const prdPdf = exportPath(c1.slug, "prd", prd.title, prd.version, "pdf");
  const expected = [prdMd, prdPdf, exportPath(c1.slug, "investor_deck", deck.title, deck.version, "pptx"), `data/${c1.slug}/ledger.csv`, `data/${c1.slug}/actions.json`, `data/${c2.slug}/decision_cards.csv`, "data/profile.json", "README.md"];
  const missing = expected.filter((name) => !entries.has(name));
  check(missing.length === 0, "export entries", expected.join(", "), { missing, present: [...entries.keys()].slice(0, 80) });
  const markdown = required(await getArtifactMarkdown(db, prd.id), "the PRD markdown");
  check(entries.get(prdMd)?.toString("utf8") === markdown, "the PRD markdown in the zip", "byte for byte the stored artifact", (entries.get(prdMd)?.toString("utf8") ?? "").slice(0, 200));
  const heading = required(markdown.split("\n").find((line) => /^#\s+\S/.test(line)), "the PRD's first heading").replace(/^#\s+/, "");
  const text = pdfText(entries.get(prdPdf) ?? Buffer.alloc(0));
  check(words(text).includes(words(heading)), "the PRD's PDF", `text containing the first heading "${heading}"`, text.slice(0, 300));
  const readme = entries.get("README.md")?.toString("utf8") ?? "";
  const repos = [await repoUrl(c1), await repoUrl(c2)];
  check(repos.every((r) => readme.includes(r)), "export README", `both repositories (${repos.join(", ")})`, readme.slice(0, 600));
}

/**
 * A second user: their own client sees neither the owner's export row nor a
 * signed URL. They also own one company with one K0 action row, the witness
 * the phase 9 append-only proof updates after the owner's purge.
 */
async function strangerChecks(user: SignedInUser, record: ExportRecord): Promise<{ readonly strangerId: string; readonly witnessCompanyId: string }> {
  check((await getExport(user.client, record.id)) === null, "stranger's export read", "no row", await getExport(user.client, record.id));
  check((await signExportUrl(user.client, record)) === null, "stranger's signed URL", "none (the storage policy keys on the user id)", "a URL");
  const witness = await createCompany(user.client, { ownerId: user.id, name: `Witness Co ${Date.now().toString(36)}`, thesis: THESIS });
  await recordAction(db, { companyId: witness.id, taskId: null, agentRole: "research", kind: "research", tier: "K0", description: "Witness reads the market", status: "executed" });
  return { strangerId: user.id, witnessCompanyId: witness.id };
}

export async function phase7(ctx: Ctx, stranger: SignedInUser): Promise<Ctx> {
  const record = await readyExport(ctx);
  const entries = await download(ctx, record);
  await entryChecks(ctx, entries);
  const other = await strangerChecks(stranger, record);
  return checkpoint(withFacts(ctx, { exportId: record.id, exportBytes: record.bytes ?? 0, exportEntries: entries.size, ...other }), 7);
}
