/**
 * regate-hidden — re-run the CURRENT live/hidden gates over already-stored hidden
 * windows and promote the ones that now pass. $0, no network, no AI.
 *
 * Why this exists: `active` is a STORED column set once at persist time. When the gates
 * improve (the 2026-06-14 time-first bare-window rule; earlier meal-special / reconcile
 * fixes), windows hidden by the OLD logic are never re-evaluated — real happy hours stay
 * benched forever (Super Duper's M–F 4–6pm @0.95 sat hidden for two weeks). This sweep
 * recomputes the EXACT decision the persist path makes —
 *     active = !assessRealness().suspect && !isOperatingHours() && !provenanceSuspect
 * — over each stored hidden window from its own offerings/notes/source/hours, and flips
 * active=true for those today's gates would show. It only ever promotes (hidden→live);
 * it never hides or deletes, and it skips operator-deleted windows (deleted_at IS NOT NULL).
 *
 * The free-parser `suspect` flag is not stored per-row, so it cannot be recomputed; the
 * realness duration/confidence checks and the reconcile op-hours gate cover those cases.
 *
 * Usage:
 *   tsx scripts/regate-hidden.ts                       # ALL cities, dry-run (report only, $0)
 *   tsx scripts/regate-hidden.ts --city tucson --state az
 *   tsx scripts/regate-hidden.ts --apply               # flip active=true for the promoted set
 *
 * Required env: DATABASE_URL.
 */
import "dotenv/config";
import postgres from "postgres";
import { writeFileSync } from "node:fs";
import { assessRealness, qualifiesForAllDayConsistencyRescue } from "@/lib/places/realnessGate";
import { isOperatingHours } from "@/lib/places/windowReconcile";
import { isSourceProvenanceSuspect } from "@/lib/recover/sourceProvenance";
import { HH_RE } from "@/lib/places/hhText";
import type { OpenPeriod } from "@/lib/geo/timezone";

const APPLY = process.argv.includes("--apply");
const argOf = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const cityArg = argOf("--city")?.toLowerCase();
const stateArg = argOf("--state")?.toLowerCase();

interface Off {
  name: string | null;
  description: string | null;
  priceCents: number | null;
  kind: string | null;
}
interface Row {
  id: string;
  venue_id: string;
  active: boolean;
  days_of_week: number[];
  start_time: string | null;
  end_time: string | null;
  all_day: boolean;
  time_known: boolean;
  extract_confidence: string | null;
  notes: string | null;
  source_url: string | null;
  venue: string;
  website_url: string | null;
  hours_json: OpenPeriod[] | null;
  city: string;
  state: string;
  offerings: Off[];
}

const DAY = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
function fmtDays(d: number[]): string {
  if (!d?.length) return "—";
  const s = [...d].sort((a, b) => a - b);
  // contiguous run → "Mon–Fri"
  const contiguous = s.every((v, i) => i === 0 || v === s[i - 1] + 1);
  if (contiguous && s.length > 2) return `${DAY[s[0]]}–${DAY[s[s.length - 1]]}`;
  return s.map((n) => DAY[n]).join(",");
}
const hm = (t: string | null) => (t ? t.slice(0, 5) : null);
function fmtTime(s: string | null, e: string | null, allDay: boolean): string {
  if (allDay) return "all-day";
  return `${hm(s) ?? "?"}–${hm(e) ?? "close"}`;
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 4 });
  try {
    const rows = (await sql`
      SELECT h.id, h.active, h.days_of_week, h.start_time::text AS start_time, h.end_time::text AS end_time,
             h.all_day, h.time_known, h.extract_confidence::text AS extract_confidence,
             h.notes, h.source_url,
             v.id AS venue_id, v.name AS venue, v.website_url, v.hours_json,
             c.slug AS city, c.state,
             coalesce(
               json_agg(json_build_object('name', o.name, 'description', o.description, 'priceCents', o.price_cents, 'kind', o.kind))
               FILTER (WHERE o.id IS NOT NULL), '[]'
             ) AS offerings
      FROM happy_hours h
      JOIN venues v ON v.id = h.venue_id
      JOIN cities c ON c.id = v.city_id
      LEFT JOIN offerings o ON o.happy_hour_id = h.id AND o.deleted_at IS NULL
      WHERE h.deleted_at IS NULL AND v.deleted_at IS NULL
        ${cityArg ? sql`AND lower(c.slug) = ${cityArg}` : sql``}
        ${stateArg ? sql`AND lower(c.state) = ${stateArg}` : sql``}
      GROUP BY h.id, v.id, v.name, v.website_url, v.hours_json, c.slug, c.state
      ORDER BY c.slug, v.name
    `) as unknown as Row[];

    // hhEvidence = strong enough to show LIVE (the venue's own text/source says happy hour, OR
    // there is an actual drink deal). Without it a plausible window is captured for REVIEW, not
    // shown — the operator trusts the time but can't confirm it (their 2026-06-15 directive).
    type Cand = { row: Row; category: "new_policy_bare" | "stale_hide" | "consistency_rescue"; hhEvidence: boolean };
    const candidates: Cand[] = [];
    const demote: Array<{ row: Row; reasons: string[] }> = [];
    let unchanged = 0;

    // Venues that ALREADY show an all-day deal window (active, all-day, ≥1 offering, <3 days).
    // Their hidden all-day-deal siblings dropped only for a missing clock time get rescued to
    // match (the extractor flags time_known inconsistently across a venue's daily specials —
    // Agua Salada). Built from current stored state before the loop.
    const venuesWithActiveAllDayDeal = new Set<string>();
    for (const r of rows) {
      if (r.active && r.all_day && (r.days_of_week?.length ?? 0) < 3 && (r.offerings?.length ?? 0) > 0) {
        venuesWithActiveAllDayDeal.add(r.venue_id);
      }
    }

    for (const r of rows) {
      const days = Array.isArray(r.days_of_week) ? r.days_of_week : [];
      const offerings = (r.offerings ?? []).map((o) => ({
        name: o.name,
        description: o.description,
        priceCents: o.priceCents,
        kind: o.kind,
      }));
      const confidence = r.extract_confidence != null ? Number(r.extract_confidence) : 1;

      const verdict = assessRealness({
        allDay: r.all_day,
        dayCount: days.length,
        timeKnown: r.time_known,
        confidence,
        mealSpecial: {
          startTime: r.start_time,
          endTime: r.end_time,
          notes: r.notes,
          sourceUrl: r.source_url,
          daysOfWeek: days,
          hoursJson: r.hours_json ?? null,
          offerings,
        },
      });

      const isOpHours = isOperatingHours(
        { daysOfWeek: days, startTime: hm(r.start_time), endTime: hm(r.end_time), allDay: r.all_day },
        r.hours_json ?? null,
      );
      const provenanceSuspect = isSourceProvenanceSuspect(r.source_url, r.website_url);
      // Consistency rescue: an all-day deal hidden ONLY for the missing clock time, on a venue
      // that already shows an all-day deal window. Clears no_time_window only — op-hours /
      // provenance still bench it.
      const consistencyRescue =
        !isOpHours &&
        !provenanceSuspect &&
        qualifiesForAllDayConsistencyRescue({
          reasons: verdict.reasons,
          allDay: r.all_day,
          offeringsCount: offerings.length,
          dayCount: days.length,
          venueHasActiveAllDayDeal: venuesWithActiveAllDayDeal.has(r.venue_id),
        });
      const nowActive = (!verdict.suspect || consistencyRescue) && !isOpHours && !provenanceSuspect;

      if (r.active === nowActive) {
        unchanged++;
        continue;
      }

      if (nowActive) {
        // hidden → passes the gate. Bare (offering-less, no-HH-text) → rescued by time-first;
        // consistency_rescue → an all-day daily-special sibling un-hidden to match the venue;
        // else a stale hide today's gates already pass.
        const bare = offerings.length === 0 && !HH_RE.test(`${r.notes ?? ""}`);
        const offeringText = (r.offerings ?? []).map((o) => `${o.name ?? ""} ${o.description ?? ""}`).join(" ");
        const hhEvidence =
          HH_RE.test(`${offeringText} ${r.notes ?? ""}`) ||
          HH_RE.test(r.source_url ?? "") ||
          (r.offerings ?? []).some((o) => o.kind === "drink");
        const category = consistencyRescue ? "consistency_rescue" : bare ? "new_policy_bare" : "stale_hide";
        candidates.push({ row: r, category, hhEvidence });
      } else {
        // live → hidden. Surface which gate now votes it down so the operator can veto.
        const reasons: string[] = [...verdict.reasons];
        if (isOpHours) reasons.push("operating_hours");
        if (provenanceSuspect) reasons.push("source_provenance");
        demote.push({ row: r, reasons });
      }
    }

    // ── reconcile dedup: never promote a window that overlaps one already staying live, and
    // dedup overlapping candidates among themselves (keep the most complete). regate gates each
    // window alone; without this it would promote duplicate/vaguer twins of a HH already shown
    // (7 Mile House's +Tuesday twin; Hula Hoops' 3pm-close twins of a live 3-5:30). Mirrors the
    // persist path's cross-window reconcile. A skipped candidate stays hidden (no degrade).
    const toMin = (t: string | null) => {
      if (!t) return null;
      const m = /^(\d{1,2}):(\d{2})/.exec(t);
      return m ? Number(m[1]) * 60 + Number(m[2]) : null;
    };
    const interval = (r: Row): [number, number] | null => {
      const s = toMin(r.start_time);
      if (s == null) return null;
      let e = r.end_time == null ? 24 * 60 : toMin(r.end_time)!;
      if (r.end_time != null && e <= s) e += 24 * 60; // crosses midnight
      return [s, e];
    };
    const overlaps = (a: Row, b: Row): boolean => {
      const da = new Set(a.days_of_week ?? []);
      if (!(b.days_of_week ?? []).some((d) => da.has(d))) return false; // no shared day
      if (a.all_day || b.all_day) return true; // all-day covers the whole shared day
      const ia = interval(a);
      const ib = interval(b);
      if (!ia || !ib) return false;
      return ia[0] < ib[1] && ib[0] < ia[1]; // intervals intersect (identical counts)
    };
    const demoteIds = new Set(demote.map((d) => d.row.id));
    // Windows that will be live regardless of any promote: currently active AND not demoted.
    const liveByVenue = new Map<string, Row[]>();
    for (const r of rows) {
      if (r.active && !demoteIds.has(r.id)) {
        (liveByVenue.get(r.venue_id) ?? liveByVenue.set(r.venue_id, []).get(r.venue_id)!).push(r);
      }
    }
    const candByVenue = new Map<string, Cand[]>();
    for (const c of candidates) {
      (candByVenue.get(c.row.venue_id) ?? candByVenue.set(c.row.venue_id, []).get(c.row.venue_id)!).push(c);
    }
    // Quality order so the survivor of an overlap is the most complete window; HH-evidenced
    // windows outrank bare ones so a confirmable window wins over an unconfirmable twin.
    const quality = (c: Cand) =>
      (c.hhEvidence ? 1000 : 0) + (c.row.days_of_week?.length ?? 0) * 100 + (c.row.end_time ? 50 : 0) + (c.row.offerings?.length ?? 0);
    const accepted: Cand[] = [];
    const skippedRedundant: Cand[] = [];
    for (const [venueId, cands] of candByVenue) {
      const live = [...(liveByVenue.get(venueId) ?? [])];
      for (const c of [...cands].sort((a, b) => quality(b) - quality(a))) {
        if (live.some((w) => overlaps(c.row, w))) skippedRedundant.push(c);
        else { accepted.push(c); live.push(c.row); } // accepted; now blocks lesser overlapping twins
      }
    }
    // LIVE only with real HH evidence; the rest are captured for operator confirmation (stay hidden).
    const promote = accepted.filter((c) => c.hhEvidence);
    const review = accepted.filter((c) => !c.hhEvidence);

    // ── report ────────────────────────────────────────────────────────────────────
    const byCity = new Map<string, { promote: number; review: number; demote: number }>();
    const bump = (city: string, k: "promote" | "review" | "demote") => {
      const e = byCity.get(city) ?? { promote: 0, review: 0, demote: 0 };
      e[k]++;
      byCity.set(city, e);
    };
    for (const p of promote) bump(p.row.city, "promote");
    for (const r of review) bump(r.row.city, "review");
    for (const d of demote) bump(d.row.city, "demote");

    console.log(`\nregate — ${APPLY ? "APPLY" : "DRY-RUN ($0)"}${cityArg ? ` · ${cityArg}/${stateArg ?? "*"}` : " · ALL cities"}`);
    console.log(`windows scanned: ${rows.length}  ·  unchanged: ${unchanged}`);
    console.log(`→ PROMOTE hidden→live: ${promote.length}  (HH evidence: own/source wording or a drink deal)`);
    console.log(`→ REVIEW (stay hidden): ${review.length}  (plausible time, no HH evidence — needs your confirmation)`);
    console.log(`→ DEMOTE live→hidden:  ${demote.length}`);
    console.log(`   (skipped ${skippedRedundant.length} candidates as duplicates/overlaps of a window already live)\n`);

    console.log("city             promote  review  demote");
    for (const [city, e] of [...byCity.entries()].sort((a, b) => b[1].promote + b[1].review + b[1].demote - (a[1].promote + a[1].review + a[1].demote))) {
      console.log(`${city.padEnd(16)} ${String(e.promote).padStart(7)} ${String(e.review).padStart(7)} ${String(e.demote).padStart(7)}`);
    }

    // detailed markdown — venue · action · time · why · URL
    const date = new Date().toISOString().slice(0, 10);
    const lines: string[] = [
      `# regate — ${date}${cityArg ? ` (${cityArg})` : " (all cities)"}`,
      ``,
      `Recomputed the current live/hidden gates over ${rows.length} stored windows (${unchanged} unchanged).`,
      `**PROMOTE ${promote.length}** hidden→live · **REVIEW ${review.length}** (stay hidden, need confirmation) · **DEMOTE ${demote.length}** live→hidden.`,
      ``,
      `| city | venue | action | days | time | offers | reason | URL |`,
      `|---|---|---|---|---|---|---|---|`,
    ];
    const row = (city: string, venue: string, action: string, days: number[], st: string | null, et: string | null, allDay: boolean, offs: number, reason: string, url: string | null) =>
      `| ${city} | ${venue.replace(/\|/g, "/")} | **${action}** | ${fmtDays(days)} | ${fmtTime(st, et, allDay)} | ${offs} | ${reason} | ${url ?? ""} |`;
    for (const p of promote) {
      const r = p.row;
      const reason =
        p.category === "new_policy_bare"
          ? "bare→time-first"
          : p.category === "consistency_rescue"
            ? "all-day special: sibling already live"
            : "stale-hide (gate already passes)";
      lines.push(row(r.city, r.venue, "PROMOTE", r.days_of_week, r.start_time, r.end_time, r.all_day, r.offerings?.length ?? 0, reason, r.source_url));
    }
    for (const rv of review) {
      const r = rv.row;
      lines.push(row(r.city, r.venue, "REVIEW", r.days_of_week, r.start_time, r.end_time, r.all_day, r.offerings?.length ?? 0, "plausible time, no HH evidence — confirm before live", r.source_url));
    }
    for (const d of demote) {
      const r = d.row;
      lines.push(row(r.city, r.venue, "DEMOTE", r.days_of_week, r.start_time, r.end_time, r.all_day, r.offerings?.length ?? 0, d.reasons.join(", "), r.source_url));
    }
    const outPath = `docs/regate-${date}.md`;
    writeFileSync(outPath, lines.join("\n") + "\n");

    // CSV — sortable/filterable in a spreadsheet, same shape as review:hidden so it drops
    // into the same workflow. happy_hour_id lets the operator trace/override a single row.
    const csvCell = (v: string | number | boolean | null) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csvHeader = ["city", "venue", "action", "category_or_reason", "days", "start", "end", "all_day", "offers", "source_url", "happy_hour_id"];
    const csvRows: Array<(string | number | boolean | null)[]> = [];
    for (const p of promote) {
      const r = p.row;
      const cat = p.category === "new_policy_bare" ? "bare→time-first" : p.category === "consistency_rescue" ? "all-day-sibling-live" : "stale-hide";
      csvRows.push([r.city, r.venue, "promote", cat, fmtDays(r.days_of_week), hm(r.start_time) ?? "", hm(r.end_time) ?? "", r.all_day, r.offerings?.length ?? 0, r.source_url, r.id]);
    }
    for (const rv of review) {
      const r = rv.row;
      csvRows.push([r.city, r.venue, "review", "no HH evidence", fmtDays(r.days_of_week), hm(r.start_time) ?? "", hm(r.end_time) ?? "", r.all_day, r.offerings?.length ?? 0, r.source_url, r.id]);
    }
    for (const d of demote) {
      const r = d.row;
      csvRows.push([r.city, r.venue, "demote", d.reasons.join(" "), fmtDays(r.days_of_week), hm(r.start_time) ?? "", hm(r.end_time) ?? "", r.all_day, r.offerings?.length ?? 0, r.source_url, r.id]);
    }
    const csvPath = `docs/regate-${date}.csv`;
    writeFileSync(csvPath, [csvHeader, ...csvRows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n");
    console.log(`\nFull per-venue list → ${outPath}\nCSV → ${csvPath}`);

    if (APPLY) {
      // --ids restricts the WRITE to specific venue UUIDs (the report still lists every
      // candidate). Lets the operator approve a subset — "promote just Grand Lake" — without
      // regate's all-or-nothing apply pushing unrelated/ shape-promoted venues live.
      const venueFilter = argOf("--ids")
        ? new Set(argOf("--ids")!.split(",").map((s) => s.trim()).filter(Boolean))
        : null;
      const promoteIds = promote.filter((p) => !venueFilter || venueFilter.has(p.row.venue_id)).map((p) => p.row.id);
      const demoteIds = demote.filter((d) => !venueFilter || venueFilter.has(d.row.venue_id)).map((d) => d.row.id);
      if (promoteIds.length) await sql`UPDATE happy_hours SET active = true, updated_at = now() WHERE id IN ${sql(promoteIds)}`;
      if (demoteIds.length) await sql`UPDATE happy_hours SET active = false, updated_at = now() WHERE id IN ${sql(demoteIds)}`;
      // REVIEW rows are left active=false (already hidden) — they need operator confirmation, not a write.
      console.log(`\nAPPLIED: ${promoteIds.length} promoted, ${demoteIds.length} demoted. ${review.length} review rows left hidden for confirmation.`);
      console.log(`Note: public page caches (ISR ~1h) revalidate on their own — seed-style writes bypass the apply engine's on-demand invalidation.`);
    } else {
      console.log(`\nDry-run only. Re-run with --apply to sync.`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
