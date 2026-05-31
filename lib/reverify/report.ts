/**
 * Build, serialize, and parse the all-day reverify report. The .json is the operator's
 * editable source of truth for --apply; the .md is the human view. Pure (no IO).
 */
import { recommendAction, type Action, type Verdict } from "@/lib/reverify/policy";

export interface ReverifyRow {
  happyHourId: string;
  venueId: string;
  venueName: string;
  city: string;
  currentDays: number[];
  sourceUrl: string | null;
}

export interface ReportEntry extends ReverifyRow {
  verdict: Verdict;
  action: Action;
}

/** Pair each row with its verdict and the recommended action. Order must match. */
export function buildReportEntries(rows: ReverifyRow[], verdicts: (Verdict | null)[]): ReportEntry[] {
  return rows.map((row, i) => {
    const verdict = verdicts[i] ?? { kind: "unconfirmable", quote: "", sourceUrl: "", servesAlcohol: false, reasoning: "no verdict returned" } as Verdict;
    return { ...row, verdict, action: recommendAction(verdict) };
  });
}

export function toJson(entries: ReportEntry[]): string {
  return JSON.stringify(entries, null, 2);
}

export function parseJson(json: string): ReportEntry[] {
  const parsed = JSON.parse(json) as ReportEntry[];
  if (!Array.isArray(parsed)) throw new Error("report json must be an array");
  return parsed;
}

export function toMarkdown(entries: ReportEntry[]): string {
  const lines: string[] = [
    "# All-day happy-hour review",
    "",
    "Edit the `action` field in the matching `.json` before running `--apply`.",
    "Actions: `correct` (fix to real window) · `keep` · `stub` (drop window, keep venue) · `delete_venue`.",
    "",
  ];
  for (const e of entries) {
    lines.push(`## ${e.venueName} (${e.city})`);
    lines.push(`- happyHourId: \`${e.happyHourId}\` · venueId: \`${e.venueId}\``);
    lines.push(`- current all-day days: ${JSON.stringify(e.currentDays)}`);
    lines.push(`- verdict: **${e.verdict.kind}** · servesAlcohol: ${e.verdict.servesAlcohol}`);
    if (e.verdict.kind === "real_window") {
      lines.push(`- real window: ${e.verdict.startTime}–${e.verdict.endTime ?? "close"} on ${JSON.stringify(e.verdict.daysOfWeek)}`);
    }
    lines.push(`- quote: ${e.verdict.quote ? `"${e.verdict.quote}"` : "_(none)_"}`);
    lines.push(`- source: ${e.verdict.sourceUrl || e.sourceUrl || "_(none)_"}`);
    lines.push(`- reasoning: ${e.verdict.reasoning}`);
    lines.push(`- **recommended action: ${e.action}**`);
    lines.push("");
  }
  return lines.join("\n");
}
