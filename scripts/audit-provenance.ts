/**
 * Source/provenance audit of LIVE happy-hour windows — $0, no AI. The read-only
 * counterpart to the persist-time guard added in lib/recover/sourceProvenance.ts: the
 * guard hides BAD-SOURCE windows going forward, this finds the ones ALREADY stored live
 * (they predate the fix) so the operator can confirm + hide them.
 *
 *   Report (no DB writes):
 *     pnpm audit:provenance [--city <slug> --state <code>] [--limit N]
 *   → writes docs/audits/provenance-audit-<YYYY-MM-DD>.{json,md,csv}
 *     Lists every live window whose source_url does NOT trace to the venue's own site
 *     (source host ≠ venue website host, and not a known menu/file host). Suggested
 *     `action` is "hide" for every flagged window; the operator flips false positives
 *     (a legit menu host I missed) to "keep_live" — that host then belongs in
 *     MENU_HOSTS in lib/recover/sourceProvenance.ts. Decision core is the golden-tested
 *     isSourceProvenanceSuspect; host columns are display-only, for tuning.
 *
 *   Apply (after you review + edit the `action` fields, .json or .csv):
 *     pnpm audit:provenance --apply docs/audits/provenance-audit-<date>.csv
 *   → hide: active=false (NON-destructive — window stays for review, never deleted),
 *     writes audit_log. keep_live: REACTIVATES a previously-hidden window (idempotent — so
 *     re-applying after an earlier hide restores it); never touches a soft-deleted window
 *     (operator deletes are final).
 *
 * Requires DATABASE_URL only.
 */
import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import postgres from "postgres";
import { requireCityArgs } from "@/lib/cities/resolveCity";
import { isSourceProvenanceSuspect } from "@/lib/recover/sourceProvenance";
import { toCsv, parseCsv } from "@/lib/recover/hiddenReview";

const DATABASE_URL = process.env.DATABASE_URL;

const args = process.argv.slice(2);
const argValue = (f: string) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};
const applyPath = argValue("--apply");
const limit = argValue("--limit") ? Number(argValue("--limit")) : undefined;

const hasCityFlag = args.includes("--city");
const cityArgs = hasCityFlag ? requireCityArgs() : null;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Display-only host extraction (decision uses isSourceProvenanceSuspect). */
function host(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "(unparseable)";
  }
}

type ProvenanceAction = "hide" | "keep_live";
const ACTIONS: ProvenanceAction[] = ["hide", "keep_live"];

interface ReportEntry {
  happyHourId: string;
  venueId: string;
  city: string;
  venue: string;
  sourceHost: string;
  venueHost: string;
  sourceUrl: string | null;
  websiteUrl: string | null;
  daysOfWeek: number[];
  startTime: string | null;
  endTime: string | null;
  offerings: number;
  /** Live windows this venue has, total — so the operator sees when hiding this one
   *  would leave the venue with no public happy hour at all. */
  venueLiveWindows: number;
  action: ProvenanceAction;
}

const DAY = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const fmtDays = (d: number[]) => d.map((n) => DAY[n] ?? String(n)).join(",");

async function runReport() {
  if (!DATABASE_URL) {
    console.error("ERROR: DATABASE_URL is required.");
    process.exit(1);
  }
  const sql = postgres(DATABASE_URL, { max: 4 });
  try {
    const rows = await sql<
      {
        happy_hour_id: string;
        venue_id: string;
        city: string;
        venue: string;
        website_url: string | null;
        source_url: string | null;
        days_of_week: number[];
        start_time: string | null;
        end_time: string | null;
        offerings: number;
        venue_live_windows: number;
      }[]
    >`
      SELECT hh.id AS happy_hour_id, v.id AS venue_id, c.name AS city, v.name AS venue,
             v.website_url, hh.source_url, hh.days_of_week, hh.start_time, hh.end_time,
             (SELECT count(*)::int FROM offerings o WHERE o.happy_hour_id = hh.id AND o.active) AS offerings,
             (SELECT count(*)::int FROM happy_hours a
                WHERE a.venue_id = v.id AND a.active AND a.deleted_at IS NULL) AS venue_live_windows
      FROM happy_hours hh
      JOIN venues v ON v.id = hh.venue_id
      JOIN cities c ON c.id = v.city_id
      WHERE hh.active AND hh.deleted_at IS NULL
        AND v.deleted_at IS NULL AND v.status = 'active'
        ${cityArgs ? sql`AND c.slug = ${cityArgs.slug} AND c.state = ${cityArgs.state}` : sql``}
      ORDER BY c.name, v.name, hh.start_time NULLS LAST
      ${limit ? sql`LIMIT ${limit}` : sql``}
    `;

    const scanned = rows.length;
    const entries: ReportEntry[] = rows
      .filter((r) => isSourceProvenanceSuspect(r.source_url, r.website_url))
      .map((r) => ({
        happyHourId: r.happy_hour_id,
        venueId: r.venue_id,
        city: r.city,
        venue: r.venue,
        sourceHost: host(r.source_url),
        venueHost: host(r.website_url),
        sourceUrl: r.source_url,
        websiteUrl: r.website_url,
        daysOfWeek: r.days_of_week,
        startTime: r.start_time,
        endTime: r.end_time,
        offerings: r.offerings,
        venueLiveWindows: r.venue_live_windows,
        action: "hide",
      }));

    // Group flagged source hosts so a single legit menu-host false positive is obvious
    // to allowlist (e.g. "12 windows from menupages.example.com" → add it to MENU_HOSTS).
    const byHost = new Map<string, number>();
    for (const e of entries) byHost.set(e.sourceHost, (byHost.get(e.sourceHost) ?? 0) + 1);
    const hostTally = [...byHost.entries()].sort((a, b) => b[1] - a[1]);

    const stamp = today();
    mkdirSync("docs/audits", { recursive: true }); // keep docs/ tidy — outputs live here (gitignored)
    const jsonPath = `docs/audits/provenance-audit-${stamp}.json`;
    const mdPath = `docs/audits/provenance-audit-${stamp}.md`;
    const csvPath = `docs/audits/provenance-audit-${stamp}.csv`;
    writeFileSync(jsonPath, JSON.stringify({ generatedAt: stamp, scanned, flagged: entries.length, hostTally, entries }, null, 2));
    writeFileSync(
      csvPath,
      toCsv(
        entries.map((e) => ({ ...e, days: fmtDays(e.daysOfWeek), time: `${e.startTime ?? "?"}–${e.endTime ?? "close"}` })),
        ["action", "city", "venue", "sourceHost", "venueHost", "days", "time", "offerings",
         "venueLiveWindows", "sourceUrl", "websiteUrl", "happyHourId", "venueId"],
      ),
    );

    const md = [
      `# Source/provenance audit — ${stamp}`,
      "",
      `Scanned **${scanned}** live windows` +
        (cityArgs ? ` in ${cityArgs.slug}, ${cityArgs.state}` : " across all cities") +
        `; **${entries.length}** flagged (source host ≠ venue host, not a known menu host) on ` +
        `${new Set(entries.map((e) => e.venueId)).size} venues.`,
      "",
      "Each flagged window's `source_url` does not trace to the venue's own website — the",
      "Depot Bar / Blanco failure mode (a sibling-brand or unrelated domain). Suggested",
      "`action` = **hide** (non-destructive; stays for review). If a row is a FALSE POSITIVE",
      "— a legit menu/file host I haven't allowlisted — flip it to `keep_live` AND add that",
      "host to `MENU_HOSTS` in `lib/recover/sourceProvenance.ts` so the persist guard stops",
      "flagging it. `venueLiveWindows` = 1 means hiding this leaves the venue with no public HH.",
      "",
      `Edit \`action\` in \`${jsonPath}\` or sort/filter \`${csvPath}\`, then: \`pnpm audit:provenance --apply <file>\`.`,
      "",
      "### Flagged source hosts (tune the allowlist from here)",
      "",
      "| count | source host |",
      "|---:|---|",
      ...hostTally.map(([h, n]) => `| ${n} | ${h} |`),
      "",
      "### Flagged windows",
      "",
      "| action | city | venue | source host | venue host | days | time | offers | venueLive |",
      "|---|---|---|---|---|---|---|---:|---:|",
      ...entries.map(
        (e) =>
          `| ${e.action} | ${e.city} | ${e.venue} | ${e.sourceHost} | ${e.venueHost} | ${fmtDays(e.daysOfWeek)} | ${e.startTime ?? "?"}–${e.endTime ?? "close"} | ${e.offerings} | ${e.venueLiveWindows} |`,
      ),
      "",
    ].join("\n");
    writeFileSync(mdPath, md);

    console.log(`scanned ${scanned} live windows, flagged ${entries.length} (${new Set(entries.map((e) => e.venueId)).size} venues)`);
    if (hostTally.length) console.log(`flagged hosts: ${hostTally.map(([h, n]) => `${h}×${n}`).join(", ")}`);
    console.log(`report → ${mdPath}`);
    console.log(`actions → ${jsonPath} or ${csvPath} (edit either, then --apply <file>)`);
  } finally {
    await sql.end();
  }
}

function readDecisions(path: string): Array<Pick<ReportEntry, "happyHourId" | "venueId" | "action">> {
  const raw = readFileSync(path, "utf8");
  const rows = path.endsWith(".csv")
    ? parseCsv(raw)
    : (JSON.parse(raw) as { entries: ReportEntry[] }).entries;
  return rows.map((r, i) => {
    const { happyHourId, venueId, action } = r as Record<string, string>;
    if (!happyHourId || !venueId || !ACTIONS.includes(action as ProvenanceAction)) {
      throw new Error(`row ${i + 1}: bad decision (happyHourId=${happyHourId}, venueId=${venueId}, action=${action})`);
    }
    return { happyHourId, venueId, action: action as ProvenanceAction };
  });
}

async function runApply(path: string) {
  if (!DATABASE_URL) {
    console.error("ERROR: DATABASE_URL is required.");
    process.exit(1);
  }
  const decisions = readDecisions(path);
  const sql = postgres(DATABASE_URL, { max: 4 });
  let hidden = 0;
  let kept = 0;
  let reactivated = 0;
  try {
    for (const e of decisions) {
      if (e.action === "keep_live") {
        // keep_live is idempotent: if an earlier apply hid this window, bring it back so the
        // operator's reviewed decision wins. Only a currently-hidden, NON-deleted window is
        // reactivated — a soft-deleted window stays deleted (operator deletes are final).
        const [row] = await sql`
          SELECT active FROM happy_hours WHERE id = ${e.happyHourId} AND deleted_at IS NULL
        `;
        if (!row || row.active) { kept++; continue; } // already live / deleted / unknown — leave it
        await sql`UPDATE happy_hours SET active = true, updated_at = now() WHERE id = ${e.happyHourId}`;
        await sql`
          INSERT INTO audit_log (table_name, row_id, before_jsonb, after_jsonb, actor, reason)
          VALUES ('happy_hours', ${e.happyHourId}, ${sql.json({ active: false })},
                  ${sql.json({ active: true })}, 'admin', 'provenance audit: keep_live — source confirmed venue-owned, reactivating')
        `;
        reactivated++;
        continue;
      }
      // hide: only act on a currently-live, non-deleted window.
      const [before] = await sql`
        SELECT active FROM happy_hours WHERE id = ${e.happyHourId} AND deleted_at IS NULL AND active
      `;
      if (!before) continue; // already hidden / deleted / unknown id — nothing to do
      await sql`UPDATE happy_hours SET active = false, updated_at = now() WHERE id = ${e.happyHourId}`;
      await sql`
        INSERT INTO audit_log (table_name, row_id, before_jsonb, after_jsonb, actor, reason)
        VALUES ('happy_hours', ${e.happyHourId}, ${sql.json({ active: true })},
                ${sql.json({ active: false })}, 'admin', 'provenance audit: source not the venue''s own site')
      `;
      hidden++;
    }
    console.log(`hidden ${hidden}, reactivated ${reactivated}, kept live ${kept}`);
  } finally {
    await sql.end();
  }
}

(applyPath ? runApply(applyPath) : runReport()).catch((err) => {
  console.error(err);
  process.exit(1);
});
