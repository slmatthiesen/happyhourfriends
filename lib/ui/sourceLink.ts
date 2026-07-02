/**
 * Classify a happy-hour `source_url` so the venue page can tell the reader WHAT the
 * source is before they click — a reader-submitted photo, a menu image/PDF, or a web
 * page. Every applied change carries a source_url (PRD §13); it's one of:
 *   - a reader upload served from our own /uploads/evidence path (photo or PDF of a
 *     menu/sign a local submitted — see lib/submit/evidenceStore.ts),
 *   - an external menu image or PDF the extractor pulled the deal from, or
 *   - a normal web page (the usual case: a /happy-hour or /specials route).
 * Pure + string-only so it's trivially testable and safe in a server component.
 */
export type SourceKind = "reader-photo" | "image" | "pdf" | "page";

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif|heic|bmp|tiff?)$/i;
const PDF_EXT = /\.pdf$/i;

export function classifySource(rawUrl: string): SourceKind {
  const url = rawUrl.trim();
  // Reader uploads are served from our own evidence path (relative or absolute).
  if (/\/uploads\/evidence\//i.test(url)) return "reader-photo";
  // Drop any query/hash before checking the extension — CDN URLs append params
  // (e.g. .../menu.jpg?format=1500w) that would otherwise hide the real suffix.
  const path = url.split(/[?#]/)[0];
  if (PDF_EXT.test(path)) return "pdf";
  if (IMAGE_EXT.test(path)) return "image";
  return "page";
}

export interface SourceMeta {
  kind: SourceKind;
  /** Short button text naming the source type. */
  label: string;
  /** Hover/aria description. */
  title: string;
}

export function sourceMeta(rawUrl: string): SourceMeta {
  const kind = classifySource(rawUrl);
  switch (kind) {
    case "reader-photo":
      return {
        kind,
        label: "Reader photo",
        title: "A photo of the happy-hour menu, submitted by a local",
      };
    case "image":
      return { kind, label: "Menu photo", title: "The menu image this happy hour was read from" };
    case "pdf":
      return { kind, label: "Menu (PDF)", title: "The menu PDF this happy hour was read from" };
    case "page":
      return { kind, label: "Source", title: "The page this happy-hour info was sourced from" };
  }
}
