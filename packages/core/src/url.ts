/**
 * The one check every surface uses before rendering a reference as a link or
 * fetching it: http(s) only, parseable, no credentials in the authority.
 * `javascript:`, `data:`, `sandbox://` and friends are never links in the UI.
 */
export function isHttpUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (url.protocol === "http:" || url.protocol === "https:") && url.username === "" && url.password === "";
}
