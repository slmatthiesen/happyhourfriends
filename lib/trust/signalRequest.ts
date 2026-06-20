/** Pure parser/validator for /api/signals request bodies. Shared by POST and DELETE. */
export interface SignalBody {
  venueId: string;
  kind: "good";
  fingerprint: string;
  website?: string; // honeypot
}

export type ParseResult =
  | { ok: true; body: SignalBody }
  | { ok: false; error: string };

export function parseSignalBody(raw: unknown): ParseResult {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: "Invalid JSON" };
  }
  const r = raw as Record<string, unknown>;

  const venueId = typeof r.venueId === "string" ? r.venueId.trim() : "";
  if (!venueId) return { ok: false, error: "venueId is required" };

  const fingerprint = typeof r.fingerprint === "string" ? r.fingerprint.trim() : "";
  if (!fingerprint) return { ok: false, error: "Missing fingerprint" };

  const rawKind = typeof r.kind === "string" && r.kind.trim() ? r.kind.trim() : "good";
  if (rawKind !== "good") return { ok: false, error: "Unknown kind" };

  const website = typeof r.website === "string" ? r.website : undefined;
  return { ok: true, body: { venueId, kind: "good", fingerprint, website } };
}
