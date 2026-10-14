import { ImageRequestSchema, type ImageProvider, type ImageRequest, type ImageResult, type SandboxSink } from "../types";
import { recordSandboxEvent, sandboxRef } from "./record";

const escape = (text: string): string => text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

/** A labelled placeholder SVG, so designs and creatives render without an image provider. */
export function placeholderSvg(prompt: string, width: number, height: number): string {
  const label = escape(prompt.slice(0, 80));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#fafafa" stroke="#000" stroke-width="2"/><text x="50%" y="50%" font-family="monospace" font-size="${Math.max(12, Math.round(width / 40))}" text-anchor="middle" dominant-baseline="middle" fill="#555">${label}</text></svg>`;
}

/** Image provider that returns a data-URI placeholder and records the prompt. */
export class SandboxImages implements ImageProvider {
  constructor(private readonly sink?: SandboxSink) {}

  async generate(raw: ImageRequest): Promise<ImageResult> {
    const input = ImageRequestSchema.parse(raw);
    const svg = placeholderSvg(input.prompt, input.width, input.height);
    const url = `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
    await recordSandboxEvent(this.sink, { provider: "images", op: "generate", companyId: null, ref: sandboxRef("image"), payload: { prompt: input.prompt, width: input.width, height: input.height } });
    return Object.freeze({ url, sandbox: true });
  }
}
