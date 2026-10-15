import { z } from "zod";

/**
 * PWA-1: the web app manifest served at `/manifest.webmanifest` by
 * `app/manifest.ts`. Installable means standalone display, a start URL on
 * this origin (the portfolio), theme colours and 192/512 icons plus a
 * maskable one; the schema states exactly that and the unit test holds it.
 */

export const APPLE_TOUCH_ICON = "/icons/apple-touch-icon.png";
export const THEME_COLOR = "#000000";
export const BACKGROUND_COLOR = "#ffffff";

const Hex = z.string().regex(/^#[0-9a-f]{6}$/i, "a #rrggbb colour");
const SameOriginPath = z.string().regex(/^\/(?!\/)/, "a path on this origin");

const IconSchema = z.object({
  src: z.string().regex(/^\/icons\/[a-z0-9-]+\.png$/, "a PNG under /icons/"),
  sizes: z.enum(["192x192", "512x512"]),
  type: z.literal("image/png"),
  purpose: z.enum(["any", "maskable"]),
});

export const WebManifestSchema = z.object({
  name: z.string().min(1).max(45),
  short_name: z.string().min(1).max(12),
  description: z.string().min(1).max(300),
  id: SameOriginPath,
  start_url: z.literal("/companies"),
  scope: SameOriginPath,
  display: z.literal("standalone"),
  orientation: z.enum(["portrait", "any"]),
  background_color: Hex,
  theme_color: Hex,
  icons: z
    .array(IconSchema)
    .min(3)
    .refine((icons) => icons.some((i) => i.sizes === "192x192" && i.purpose === "any"), { message: "a 192x192 icon" })
    .refine((icons) => icons.some((i) => i.sizes === "512x512" && i.purpose === "any"), { message: "a 512x512 icon" })
    .refine((icons) => icons.some((i) => i.purpose === "maskable"), { message: "a maskable icon" }),
});
export type WebManifest = z.infer<typeof WebManifestSchema>;

/** Structurally a `MetadataRoute.Manifest`; frozen so nothing edits it per request. */
export function northManifest(): WebManifest {
  return Object.freeze({
    name: "North",
    short_name: "North",
    description: "The operating system for a one-person company. You decide; agents execute.",
    id: "/companies",
    start_url: "/companies",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: BACKGROUND_COLOR,
    theme_color: THEME_COLOR,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  } satisfies WebManifest);
}
