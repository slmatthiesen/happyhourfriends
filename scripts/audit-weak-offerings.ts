/**
 * audit-weak-offerings — READ-ONLY scan for LIVE happy-hour data that is showing but
 * weak/incomplete: the deal made it live, yet what we display is thin or garbled.
 *
 * Motivating case: Sevy's Bar + Kitchen showed an offering with name "$1 off" and nothing
 * else — the extractor dropped the item ("$1 Off House wines...") into the name field and
 * truncated it, so the public page reads "$1 off" with no context. The source site had
 * rich data; we just captured it badly.
 *
 * This complements audit-hh-anomalies.ts (day/time smells). Here we grade the *content*
 * of what's live so an operator can pick the highest-value venues to complete by hand.
 *
 * All checks are heuristics for human review, not auto-fixes.
 *
 * Usage:
 *   tsx scripts/audit-weak-offerings.ts                      # every live venue
 *   tsx scripts/audit-weak-offerings.ts --city "Santa Cruz" --state CA
 *   tsx scripts/audit-weak-offerings.ts --city "Santa Cruz" --state CA --write docs/weak-live-offerings.md
 */
import "dotenv/config";
import postgres from "postgres";
import { writeFileSync } from "node:fs";

type Row = {
  city: string;
  state: string;
  venue: string;
  slug: string;
  venue_id: string;
  hh_id: string;
  days_of_week: number[];
  start_time: string | null;
  end_time: string | null;
  all_day: boolean;
  time_known: boolean;
  crosses_midnight: boolean | null;
  hh_source_url: string | null;
  off_id: string | null;
  kind: string | null;
  category: string | null;
  name: string | null;
  price_cents: number | null;
  discount_cents: number | null;
  discount_percent: number | null;
  description: string | null;
};

// A name that is ONLY a price/discount expression with no item noun — the deal phrase
// leaked into the name field and the actual item was lost. "$1 off", "$2", "50% off",
// "half off", "2 for 1", "BOGO". NOT "$1 off house wines" (that carries the item).
const DEAL_ONLY_NAME = [
  /^\s*\$?\d+(\.\d+)?\s*(off|%|%\s*off|dollars?|each|ea\.?)?\s*$/i,
  /^\s*\d+\s*%\s*off\s*$/i,
  /^\s*(half|1\/2)\s*(price|off)?\s*$/i,
  /^\s*\d+\s*for\s*\d+\s*$/i,
  /^\s*bogo\s*$/i,
  /^\s*(happy\s*hour|special|specials|deal|deals|discount|off)\s*$/i,
];

const isDealOnlyName = (n: string | null) =>
  !!n && DEAL_ONLY_NAME.some((re) => re.test(n.trim()));

const hasContent = (v: string | null) => !!v && v.trim().length > 0;

// A one-off EVENT page masquerading as a recurring window: Wix event-details URLs or a
// URL with a hard calendar date baked in (…-2026-11-30-15-00).
const isEventSource = (u: string | null) =>
  !!u && (/event-details/i.test(u) || /-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}/.test(u));

function timeAnomaly(r: Row): string | null {
  if (r.all_day || !r.start_time) return null;
  if (r.start_time < "06:00:00") return "starts pre-6am";
  if (r.end_time && r.end_time <= r.start_time && !r.crosses_midnight)
    return "end<=start (no midnight cross)";
  if (r.end_time) {
    const span =
      (Date.parse("1970-01-01T" + r.end_time + "Z") -
        Date.parse("1970-01-01T" + r.start_time + "Z")) /
      3.6e6;
    if (span > 6) return `span ${span}h (>6h)`;
  }
  return null;
}

type Issue = { tag: string; weight: number; detail: string };

async function main() {
  const args = process.argv.slice(2);
  const val = (f: string) => {
    const i = args.indexOf(f);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const city = val("--city");
  const state = val("--state");
  const writePath = val("--write");
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  const scope = city && state ? sql`AND c.name = ${city} AND c.state = ${state}` : sql``;

  const rows = (await sql<Row[]>`
    SELECT c.name AS city, c.state, v.name AS venue, v.slug, v.id AS venue_id,
           hh.id AS hh_id, hh.days_of_week, hh.start_time, hh.end_time, hh.all_day,
           hh.time_known, hh.crosses_midnight, hh.source_url AS hh_source_url,
           o.id AS off_id, o.kind, o.category, o.name, o.price_cents,
           o.discount_cents, o.discount_percent, o.description
    FROM venues v
    JOIN cities c ON c.id = v.city_id
    JOIN happy_hours hh ON hh.venue_id = v.id AND hh.active AND hh.deleted_at IS NULL
    LEFT JOIN offerings o ON o.happy_hour_id = hh.id AND o.active AND o.deleted_at IS NULL
    WHERE v.status = 'active' ${scope}
    ORDER BY c.name, v.name, hh.start_time
  `) as unknown as Row[];

  // Group rows by venue (each row is one offering, or one bare window with off_id NULL).
  type VenueReport = { meta: Row; issues: Issue[]; score: number };
  const reports: VenueReport[] = [];
  const byVenue = new Map<string, Row[]>();
  for (const r of rows) {
    const a = byVenue.get(r.venue_id) ?? [];
    a.push(r);
    byVenue.set(r.venue_id, a);
  }

  for (const [, vrows] of byVenue) {
    const meta = vrows[0];
    const issues: Issue[] = [];
    const wins = new Map<string, Row[]>();
    for (const r of vrows) {
      const a = wins.get(r.hh_id) ?? [];
      a.push(r);
      wins.set(r.hh_id, a);
    }
    for (const [, wr] of wins) {
      const win = wr[0];
      const offs = wr.filter((r) => r.off_id);

      const ta = timeAnomaly(win);
      if (ta) issues.push({ tag: "time-anomaly", weight: 2, detail: `${win.days_of_week} ${win.start_time}-${win.end_time ?? "close"}: ${ta}` });

      if (isEventSource(win.hh_source_url))
        issues.push({ tag: "event-page-source", weight: 3, detail: win.hh_source_url! });

      if (offs.length === 0) {
        issues.push({ tag: "bare-window", weight: 3, detail: `${win.days_of_week} ${win.start_time ?? "?"}-${win.end_time ?? "close"} has no offerings` });
        continue;
      }

      for (const o of offs) {
        // An offering communicates its ITEM if it has a real name (not just a deal phrase)
        // or a non-empty description. If it communicates no item, the "what" is missing —
        // the public page shows a price/time with nothing meaningful attached.
        const communicatesItem =
          (hasContent(o.name) && !isDealOnlyName(o.name)) || hasContent(o.description);
        if (communicatesItem) continue;

        const hasDeal = o.price_cents != null || o.discount_cents != null || o.discount_percent != null;
        const deal = o.discount_cents != null ? `$${(o.discount_cents / 100).toFixed(2)} off`
          : o.discount_percent != null ? `${o.discount_percent}% off`
          : o.price_cents != null ? `$${(o.price_cents / 100).toFixed(2)}`
          : "";
        if (isDealOnlyName(o.name)) {
          issues.push({ tag: "deal-only-name", weight: 3, detail: `name="${o.name}" — deal phrase, item lost (${o.kind}/${o.category}${deal ? `, ${deal}` : ""})` });
        } else if (hasDeal) {
          issues.push({ tag: "unnamed-discount", weight: 2, detail: `${deal} on unknown ${o.kind}/${o.category} — no item name or description` });
        } else {
          issues.push({ tag: "empty-offering", weight: 4, detail: `${o.kind}/${o.category} has no name/price/description` });
        }
      }
    }
    if (issues.length) {
      const score = issues.reduce((s, i) => s + i.weight, 0);
      reports.push({ meta, issues, score });
    }
  }

  reports.sort((a, b) => b.score - a.score || a.meta.city.localeCompare(b.meta.city));

  // Console summary.
  const tally = new Map<string, number>();
  for (const r of reports) for (const i of r.issues) tally.set(i.tag, (tally.get(i.tag) ?? 0) + 1);
  console.log(`\nScanned ${byVenue.size} live venues${city ? ` in ${city}, ${state}` : ""}.`);
  console.log(`Flagged ${reports.length} venues. Issue counts:`);
  for (const [tag, n] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`  ${tag.padEnd(20)} ${n}`);
  console.log(`\nTop 25 venues by weakness score:`);
  for (const r of reports.slice(0, 25)) {
    console.log(`\n  [${r.score}] ${r.meta.venue} — ${r.meta.city}, ${r.meta.state}`);
    console.log(`      https://happyhourfriends.com/${r.meta.state.toLowerCase()}/${citySlug(r.meta.city)}/venue/${r.meta.slug}`);
    for (const i of r.issues.slice(0, 6)) console.log(`      · [${i.tag}] ${i.detail}`);
  }

  if (writePath) {
    const md = renderMarkdown(reports, tally, byVenue.size, city, state);
    writeFileSync(writePath, md);
    console.log(`\nWrote ${reports.length} flagged venues → ${writePath}`);
  }

  await sql.end();
}

function citySlug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function renderMarkdown(
  reports: { meta: Row; issues: Issue[]; score: number }[],
  tally: Map<string, number>,
  scanned: number,
  city?: string,
  state?: string,
) {
  const today = new Date().toISOString().slice(0, 10);
  let md = `# Weak / incomplete LIVE offerings\n\nGenerated ${today}. Scanned **${scanned}** live venues${city ? ` in ${city}, ${state}` : " (all cities)"}. **${reports.length}** flagged.\n\n`;
  md += `Issue counts: ${[...tally].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t}=${n}`).join(" · ")}\n\n`;
  md += `Tags: **deal-only-name** (deal phrase leaked into name, item lost — the Sevy's bug) · **empty-offering** (no name/price/description) · **bare-window** (live window, zero offerings) · **event-page-source** (one-off event captured as recurring) · **time-anomaly** (pre-6am / span>6h / end<=start).\n\n---\n\n`;
  let curCity = "";
  for (const r of reports) {
    if (r.meta.city !== curCity) {
      curCity = r.meta.city;
      md += `\n## ${curCity}, ${r.meta.state}\n\n`;
    }
    md += `### [${r.score}] ${r.meta.venue}\n`;
    md += `- Public: https://happyhourfriends.com/${r.meta.state.toLowerCase()}/${citySlug(r.meta.city)}/venue/${r.meta.slug}\n`;
    for (const i of r.issues) md += `- **${i.tag}** — ${i.detail}\n`;
    md += `\n`;
  }
  return md;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
