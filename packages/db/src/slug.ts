/** URL-safe company slug: lowercase, a-z0-9 and hyphens, 2-63 chars. */
export function slugify(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
  return base.length >= 2 ? base : `company-${base}`.slice(0, 63);
}

/** Appends a short random suffix so that collisions resolve without a round trip. */
export function uniqueSlug(name: string, random: () => number = Math.random): string {
  const suffix = Math.floor(random() * 36 ** 4)
    .toString(36)
    .padStart(4, "0");
  return `${slugify(name).slice(0, 58)}-${suffix}`;
}
