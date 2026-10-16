import { inflateRawSync, inflateSync } from "node:zlib";

/**
 * Readers the export tests use to look inside what the worker produced,
 * without a zip or PDF dependency: the zip's central directory, and the text
 * operators of pdf-lib's (flate-compressed) content streams.
 */

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;

/** Every entry of a zip (stored or deflated), by name. */
export function unzip(bytes: Uint8Array): ReadonlyMap<string, Buffer> {
  const b = Buffer.from(bytes);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i -= 1) {
    if (b.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip: no end of central directory");
  const count = b.readUInt16LE(eocd + 10);
  const entries = new Map<string, Buffer>();
  let p = b.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n += 1) {
    if (b.readUInt32LE(p) !== CENTRAL) throw new Error(`bad central directory entry at ${p}`);
    const method = b.readUInt16LE(p + 10);
    const compressed = b.readUInt32LE(p + 20);
    const nameLength = b.readUInt16LE(p + 28);
    const extraLength = b.readUInt16LE(p + 30);
    const commentLength = b.readUInt16LE(p + 32);
    const local = b.readUInt32LE(p + 42);
    const name = b.toString("utf8", p + 46, p + 46 + nameLength);
    const start = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
    const data = b.subarray(start, start + compressed);
    entries.set(name, method === 0 ? Buffer.from(data) : inflateRawSync(data));
    p += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** WinAnsi (cp1252) differs from Latin-1 in 0x80-0x9F only. */
const CP1252 = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ";
const winAnsiChar = (byte: number): string => (byte >= 0x80 && byte <= 0x9f ? (CP1252[byte - 0x80] ?? "?") : String.fromCharCode(byte));
const decodeHex = (hex: string): string => Array.from(Buffer.from(hex.length % 2 === 0 ? hex : `${hex}0`, "hex"), winAnsiChar).join("");

/** The text a PDF draws, one `Tj` per line, from every flate content stream. */
export function pdfText(bytes: Uint8Array): string {
  const b = Buffer.from(bytes);
  const s = b.toString("latin1");
  const lines: string[] = [];
  const header = /<<((?:(?!>>).)*?\/Length (\d+)(?:(?!>>).)*?)>>\s*stream\r?\n/gs;
  for (let m = header.exec(s); m; m = header.exec(s)) {
    const start = m.index + m[0].length;
    const raw = b.subarray(start, start + Number(m[2]));
    let text: string;
    try {
      text = (m[1] ?? "").includes("/FlateDecode") ? inflateSync(raw).toString("latin1") : raw.toString("latin1");
    } catch {
      continue;
    }
    for (const op of text.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)) lines.push(decodeHex(op[1] ?? ""));
  }
  return lines.join("\n");
}

/** The number of slides in a .pptx (one `ppt/slides/slideN.xml` per slide). */
export const slideCount = (pptx: Uint8Array): number => [...unzip(pptx).keys()].filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length;
