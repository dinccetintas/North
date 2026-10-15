import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { APPLE_TOUCH_ICON, northManifest, WebManifestSchema } from "./manifest";

/** Width and height from a PNG's IHDR chunk (bytes 16..23, big-endian). */
function pngSize(publicPath: string): { width: number; height: number } {
  const bytes = readFileSync(new URL(`../../public${publicPath}`, import.meta.url));
  expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("PWA-1 web manifest", () => {
  const manifest = northManifest();

  it("validates: standalone, starts on the portfolio, themed, 192/512 and a maskable icon", () => {
    const parsed = WebManifestSchema.parse(manifest);
    expect(parsed.name).toBe("North");
    expect(parsed.start_url).toBe("/companies");
    expect(parsed.display).toBe("standalone");
    expect(parsed.icons.map((i) => [i.sizes, i.purpose])).toEqual([
      ["192x192", "any"],
      ["512x512", "any"],
      ["512x512", "maskable"],
    ]);
  });

  it("refuses a manifest that would not install or would leave the app", () => {
    expect(WebManifestSchema.safeParse({ ...manifest, display: "browser" }).success).toBe(false);
    expect(WebManifestSchema.safeParse({ ...manifest, start_url: "https://evil.example/" }).success).toBe(false);
    expect(WebManifestSchema.safeParse({ ...manifest, icons: manifest.icons.filter((i) => i.purpose !== "maskable") }).success).toBe(false);
    expect(WebManifestSchema.safeParse({ ...manifest, icons: manifest.icons.filter((i) => i.sizes !== "192x192") }).success).toBe(false);
    expect(WebManifestSchema.safeParse({ ...manifest, theme_color: "orange" }).success).toBe(false);
  });

  it("points at icon files that exist with the declared pixel sizes", () => {
    for (const icon of manifest.icons) {
      const [w, h] = icon.sizes.split("x").map(Number);
      expect(pngSize(icon.src)).toEqual({ width: w, height: h });
    }
    expect(pngSize(APPLE_TOUCH_ICON)).toEqual({ width: 180, height: 180 });
  });
});
