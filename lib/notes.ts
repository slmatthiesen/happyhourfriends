/**
 * Which happy-hour `notes` earn a spot on a public page.
 *
 * `notes` is a catch-all the extractor/parser fills, and once a card already renders days,
 * times, and offerings, most of it is noise: bare labels ("Happy Hour"), restatements of
 * the window ("Happy hour daily 3–6pm") or the deals ("Two-for-one on spirits"), and
 * internal provenance markers the parser writes for the audit ("days assumed Mon–Fri
 * (none stated)"). The only prose worth showing a visitor is an access / redemption
 * *restriction* they can't infer from the rest of the card and could get turned away by —
 * age limits, dine-in / to-go, seating-area limits, or a chain's location limits.
 *
 * Heuristic by necessity: there's no structured restriction field yet, so we pattern-match.
 * The durable fix is to promote these to tags; until then one central classifier keeps
 * every public surface consistent. Non-restriction notes are hidden, never deleted — the
 * raw value stays in the DB for the audit and for a future structured migration.
 */
const RESTRICTION_RE =
  /\b(?:18|21)\s*\+|\b(?:18|21)\s+(?:and|&)\s+(?:over|up)\b|dine[\s-]?in|no\s+to[\s-]?go|take[\s-]?out|take\s?away|in[\s-]?store\s+only|in[\s-]?restaurant|bar\s+only|bar\s+seating|bar\s*(?:&|and)\s*(?:lounge|patio)|lounge\s+only|patio\s+only|locations?\s+only/i;

/** The note to render publicly, or null to show nothing. Keeps only access restrictions. */
export function publicNote(notes: string | null | undefined): string | null {
  const n = notes?.trim();
  if (!n) return null;
  return RESTRICTION_RE.test(n) ? n : null;
}
