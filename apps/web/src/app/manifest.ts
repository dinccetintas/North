import type { MetadataRoute } from "next";
import { northManifest } from "@/lib/manifest";

/** PWA-1: `/manifest.webmanifest`; the object and its schema live in `lib/manifest.ts`. */
export default function manifest(): MetadataRoute.Manifest {
  return northManifest();
}
