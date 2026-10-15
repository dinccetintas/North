/**
 * Paths a visitor without a session may open (the proxy redirects every
 * other one to `/login`). M6 adds the public company page, the legal
 * documents and the PWA files: the offline page, the manifest, the icons and
 * the service worker (a redirected worker script would fail to register).
 */
const PUBLIC_PREFIXES = ["/login", "/auth", "/api/", "/p/", "/legal/", "/icons/", "/_next", "/favicon"] as const;
const PUBLIC_PATHS: ReadonlySet<string> = new Set(["/", "/offline", "/manifest.webmanifest", "/sw.js"]);

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}
