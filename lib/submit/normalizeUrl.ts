/**
 * Lenient normalization for user-entered source links. A contributor who types a bare
 * domain ("www.somesite.com" or "somesite.com/menu") or omits the scheme should NOT be
 * blocked — we prepend `https://` and validate. Returns the normalized absolute URL, or
 * null when the input is empty or can't be parsed as an http(s) URL with a dotted host.
 *
 * Shared by every submit form (client) and the submissions API (server), so the same
 * leniency applies regardless of where the value comes from.
 */
export function normalizeUrl(raw: string | null | undefined): string | null {
  // Strip whitespace anywhere in the string, not just the ends: mobile keyboards and
  // autocorrect routinely inject a stray space ("google. com", "www. site.com"), and a
  // real web URL never contains a literal space. Without this, such input fails to parse
  // and the whole submission is rejected.
  const trimmed = (raw ?? "").replace(/\s+/g, "");
  if (!trimmed) return null;

  // Reject dangerous / non-web schemes outright — a stored source_url is later rendered
  // as a clickable link, so never let javascript:/data:/etc. through.
  if (/^(javascript|data|vbscript|file|mailto|tel|blob):/i.test(trimmed)) return null;

  // Keep an explicit http(s) scheme; otherwise assume https (handles bare domains).
  const hasWebScheme = /^https?:\/\//i.test(trimmed);
  const candidate = hasWebScheme ? trimmed : `https://${trimmed.replace(/^\/+/, "")}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  // A real web source has a dotted hostname — rejects "localhost", typos like "foo", etc.
  if (!url.hostname.includes(".")) return null;
  return url.toString();
}
