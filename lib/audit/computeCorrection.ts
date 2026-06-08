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

function key(w: { daysOfWeek: number[]; startTime: string | null; endTime: string | null; allDay: boolean }): string {
  const days = [...new Set(w.daysOfWeek)].sort((a, b) => a - b).join(",");
  return `${days}|${w.startTime ?? ""}|${w.endTime ?? ""}|${w.allDay}`;
}

export function computeCorrection(stored: StoredRow[], corrected: CorrectedWindow[]): CorrectionPlan {
  const plan: CorrectionPlan = { updates: [], deactivations: [], inserts: [] };
  const activeStored = stored.filter((r) => r.active);
  const correctedByKey = new Map(corrected.map((c) => [key(c), c]));
  const matchedKeys = new Set<string>();

  for (const row of activeStored) {
    const match = correctedByKey.get(key(row));
    if (match) {
      matchedKeys.add(key(row));
      if (match.sourceUrl !== row.sourceUrl || match.notes !== row.notes) {
        plan.updates.push({ id: row.id, sourceUrl: match.sourceUrl, notes: match.notes });
      }
    } else {
      plan.deactivations.push(row.id);
    }
  }

  for (const c of corrected) {
    if (!matchedKeys.has(key(c))) plan.inserts.push(c);
  }
  return plan;
}
