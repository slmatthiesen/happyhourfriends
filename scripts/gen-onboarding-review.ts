/**
 * gen:onboarding-review — emit an annotatable Markdown review of a city's HH data for the
 * operator pass (LIVE / HIDDEN-with-auto-read / stubs), each row carrying a blank "Your note"
 * column. Read-only, $0. Built for the new-city onboarding review step (Phase 4/7).
 *   pnpm tsx scripts/gen-onboarding-review.ts --city <slug> --state <code>
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import postgres from "postgres";
import { requireCityArgs, resolveCity } from "@/lib/cities/resolveCity";

const DOW = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
function fmtDays(days: number[] | null): string {
  if (!days || days.length === 0) return "—";
  const s = [...days].sort((a, b) => a - b);
  const runs: string[] = [];
  let i = 0;
  while (i < s.length) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    runs.push(i === j ? DOW[s[i]] : `${DOW[s[i]]}–${DOW[s[j]]}`);
    i = j + 1;
  }
  return runs.join(", ");
}
const t = (x: string | null) => (x ? x.slice(0, 5) : null);
const fmtTime = (a: string | null, b: string | null) => `${t(a) ?? "?"}–${t(b) ?? "close"}`;
function durationH(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const [sh, sm] = a.split(":").map(Number);
  const [eh, em] = b.split(":").map(Number);
  let d = eh + em / 60 - (sh + sm / 60);
  if (d < 0) d += 24;
  return d;
}
function classify(a: string | null, b: string | null, hasOffer: boolean): string {
  const d = durationH(a, b);
  const sh = a ? Number(a.slice(0, 2)) : null;
  if (d != null && d >= 6) return "operating hours (correctly hidden)";
  if (sh != null && sh >= 11 && sh < 12 && d != null && d <= 3.5) return "lunch service (likely not HH)";
  if (sh != null && sh >= 14 && sh <= 19 && d != null && d <= 4.5)
    return hasOffer ? "★ HH candidate (has offerings)" : "★ HH candidate — bare, confirm/re-extract";
  if (sh != null && sh >= 20) return "late-night (review)";
  return "review";
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  const { slug, state } = requireCityArgs();
  const c = await resolveCity(sql, slug, state);

  const win = await sql<{ name: string; active: boolean; days: number[]; st: string; en: string | null; src: string | null; notes: string | null; town: string | null; offers: number }[]>`
    SELECT v.name, h.active, h.days_of_week AS days, h.start_time AS st, h.end_time AS en, h.source_url AS src, h.notes,
           n.name AS town, (SELECT count(*)::int FROM offerings o WHERE o.happy_hour_id=h.id AND o.active) AS offers
    FROM happy_hours h JOIN venues v ON v.id=h.venue_id LEFT JOIN neighborhoods n ON n.id=v.neighborhood_id
    WHERE v.city_id=${c.id} AND h.deleted_at IS NULL ORDER BY v.name, h.start_time`;
  const stubs = await sql<{ name: string; website: string | null; town: string | null }[]>`
    SELECT v.name, v.website_url AS website, n.name AS town
    FROM venues v LEFT JOIN neighborhoods n ON n.id=v.neighborhood_id
    WHERE v.city_id=${c.id} AND NOT EXISTS (SELECT 1 FROM happy_hours h WHERE h.venue_id=v.id)
    ORDER BY (v.website_url IS NULL), n.name, v.name`;

  const live = win.filter((w) => w.active);
  const hidden = win.filter((w) => !w.active);
  const N = "_____";
  let md = `# ${c.name} — onboarding review (regenerated)\n\n`;
  md += `**${live.length} LIVE windows** · ${hidden.length} hidden · ${stubs.length} pure stubs.\n\n`;
  md += `Put your call in **Your note** (\`promote\` / \`delete\` / \`wrong\` / free text).\n\n`;

  md += `## 1. LIVE (${live.length})\n\n| Venue | Town | Days | Time | Offers | Source | Your note |\n|---|---|---|---|---|---|---|\n`;
  for (const r of live) md += `| ${r.name} | ${r.town ?? "—"} | ${fmtDays(r.days)} | ${fmtTime(r.st, r.en)} | ${r.offers} | ${r.src ? `[link](${r.src})` : "—"} | ${N} |\n`;

  const ranked = hidden.map((r) => ({ ...r, cls: classify(r.st, r.en, r.offers > 0) }));
  ranked.sort((a, b) => (a.cls.startsWith("★") ? 0 : 1) - (b.cls.startsWith("★") ? 0 : 1) || a.name.localeCompare(b.name));
  md += `\n## 2. HIDDEN (${hidden.length}) — ★ = possible real HH wrongly benched\n\n| Venue | Town | Days | Time | Offers | Auto-read | Source | Your note |\n|---|---|---|---|---|---|---|---|\n`;
  for (const r of ranked) md += `| ${r.name} | ${r.town ?? "—"} | ${fmtDays(r.days)} | ${fmtTime(r.st, r.en)} | ${r.offers} | ${r.cls} | ${r.src ? `[link](${r.src})` : "—"} | ${N} |\n`;

  const withSite = stubs.filter((s) => s.website);
  md += `\n## 3. STUBS with a website (${withSite.length})\n\n| Venue | Town | Website | Your note |\n|---|---|---|---|\n`;
  for (const s of withSite) md += `| ${s.name} | ${s.town ?? "—"} | ${s.website ? `[site](${s.website})` : "—"} | ${N} |\n`;
  md += `\n## 4. STUBS no website (${stubs.length - withSite.length})\n\n` + stubs.filter((s) => !s.website).map((s) => `- ${s.name} (${s.town ?? "—"})`).join("\n") + "\n";

  const out = `docs/${slug}-onboarding-review.md`;
  writeFileSync(out, md);
  console.log(`Wrote ${out} — ${live.length} live, ${hidden.length} hidden, ${stubs.length} stubs.`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
