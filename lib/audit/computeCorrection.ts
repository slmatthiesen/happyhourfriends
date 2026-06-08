/**
 * computeCorrection — pure diff between a venue's STORED happy-hour rows and the window-set
 * a fresh free re-parse produced. Produces a reversible plan the fixer applies through
 * audit_log. NO DB, NO network ($0, unit-tested).
 *
 * Matching is by natural key (sorted days | start | end | allDay):
 *   - stored ACTIVE row matched by a corrected window → UPDATE provenance (source/notes) if it
 *     differs; otherwise no-op.
 *   - stored ACTIVE row NOT matched → DEACTIVATE (a spurious/superseded window).
 *   - corrected window with no stored match → INSERT.
 * Inactive stored rows are left untouched (already withheld).
 */
export interface StoredRow {
  id: string;
  daysOfWeek: number[];
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  active: boolean;
  sourceUrl: string | null;
  notes: string | null;
}

export interface CorrectedWindow {
  daysOfWeek: number[];
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  sourceUrl: string | null;
  notes: string | null;
}

export interface CorrectionPlan {
  updates: { id: string; sourceUrl: string | null; notes: string | null }[];
  deactivations: string[]; // row ids
  inserts: CorrectedWindow[];
}

/** Canonicalize a clock string for keying: "16:00" and "16:00:00" both → "16:00";
 *  null (open-ended bound) → "" so open bounds compare equal. The DB time column returns
 *  "HH:MM:SS" while the deterministic parser emits "HH:MM" — normalize both before keying. */
function normTime(t: string | null): string {
  return t ? t.slice(0, 5) : "";
}

function key(w: { daysOfWeek: number[]; startTime: string | null; endTime: string | null; allDay: boolean }): string {
  const days = [...new Set(w.daysOfWeek)].sort((a, b) => a - b).join(",");
  return `${days}|${normTime(w.startTime)}|${normTime(w.endTime)}|${w.allDay}`;
}

export function computeCorrection(stored: StoredRow[], corrected: CorrectedWindow[]): CorrectionPlan {
  const plan: CorrectionPlan = { updates: [], deactivations: [], inserts: [] };
  const correctedByKey = new Map(corrected.map((c) => [key(c), c]));
  const matchedKeys = new Set<string>();

  // Match corrected windows against ALL stored rows (active OR inactive) by normalized key.
  // Matching an inactive row REACTIVATES it via an update — this is what prevents an insert
  // from colliding (ON CONFLICT DO NOTHING) with a same-natural-key row that we just hid.
  for (const row of stored) {
    const k = key(row);
    const match = correctedByKey.get(k);
    if (match) {
      matchedKeys.add(k);
      // Emit an update when the row is hidden (needs reactivation) OR its provenance differs.
      if (!row.active || match.sourceUrl !== row.sourceUrl || match.notes !== row.notes) {
        plan.updates.push({ id: row.id, sourceUrl: match.sourceUrl, notes: match.notes });
      }
    } else if (row.active) {
      plan.deactivations.push(row.id);
    }
    // unmatched + already inactive → leave as-is
  }

  for (const c of corrected) {
    if (!matchedKeys.has(key(c))) plan.inserts.push(c);
  }
  return plan;
}
