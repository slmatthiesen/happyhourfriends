/**
 * reextract:stubs:free — $0 stub recovery. NO Anthropic API. For every stub with a
 * website: triage (sitemap-aware) → fetch pages (plain HTTP, no browser) → deterministic
 * parse. CLEAN windows are written through the shared audited persist path; pages with a
 * happy-hour signal but no clean parse are written to an escalation shortlist for the paid
 * extractor (reextract:stubs --venue / the /admin/stubs Auto-retry button).
 *
 * Dry-run by DEFAULT. Pass --apply to write.
 * Usage: pnpm tsx scripts/reextract-stubs-free.ts --city <slug> --state <code> [--limit N] [--apply]
 */
import "dotenv/config";
import postgres from "postgres";
import { writeFileSync } from "node:fs";
import { triageSite, resolveEnrichAction } from "@/lib/places/siteTriage";
import { hhLikelihood } from "@/lib/places/hhLikelihood";
import { buildExtractRequest } from "@/lib/ai/extractHappyHours";
import { freeExtractFromPages } from "@/lib/ai/freeExtract";
import { persistExtractedWindows } from "@/lib/recover/resolveVenue";
import { hasHhOrDealSignal } from "@/lib/places/hhText";
import { requireCityArgs, resolveCity } from "@/lib/cities/resolveCity";

function arg(f: string): string | undefined {
  const i = process.argv.indexOf(f);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const LIMIT = arg("--limit") ? parseInt(arg("--limit")!, 10) : null;
const APPLY = process.argv.includes("--apply");

interface StubVenue {
  id: string;
  name: string;
  website_url: string | null;
  primary_type: string | null;
}

interface EscalationEntry {
  venueId: string;
  name: string;
  citySlug: string;
  url: string;
  snippet: string;
}

async function main() {
  const { slug, state } = requireCityArgs();

  const sql = postgres(process.env.DATABASE_URL!, { max: 4 });
  try {
    const city = await resolveCity(sql, slug, state);

    const stubs = await sql<StubVenue[]>`
      SELECT v.id, v.name, v.website_url, sc.primary_type
      FROM venues v
      LEFT JOIN seed_candidates sc ON sc.resulting_venue_id = v.id
      WHERE v.city_id = ${city.id}
        AND v.status = 'active'
        AND v.data_completeness = 'stub'
        AND v.website_url IS NOT NULL
      ORDER BY v.name
      ${LIMIT ? sql`LIMIT ${LIMIT}` : sql``}`;

    console.log(
      `[${APPLY ? "APPLY" : "DRY RUN"}] ${stubs.length} stub(s) with a website in ${city.name}. $0 — no API.\n`,
    );

    let filledLive = 0;
    let hiddenOnly = 0;
    let escalated = 0;
    let noSignal = 0;
    let social = 0;
    const shortlist: EscalationEntry[] = [];

    for (const v of stubs) {
      const verdict = await triageSite({ websiteUri: v.website_url, name: v.name, cityName: city.name });
      const likelihood = hhLikelihood({ primaryType: v.primary_type, types: null, name: v.name });
      const decided = resolveEnrichAction(verdict, likelihood);
      if (decided.action !== "extract") {
        social++;
        continue;
      }

      const built = await buildExtractRequest({
        venueName: v.name,
        websiteUrl: verdict.kind === "real" ? verdict.url : null,
        otherUrl: null,
        cityName: city.name,
        priorityUrls: decided.priorityUrls,
        noRender: true,
      });

      const free = freeExtractFromPages(built.pages, {
        model: "deterministic-html-v1",
        promptHash: built.promptHash,
      });

      if (free) {
        const liveCount = free.happyHours.filter((h) => !h.suspect).length;
        const hiddenCount = free.happyHours.filter((h) => h.suspect).length;
        const days = free.happyHours
          .map((h) => `${h.daysOfWeek.length}d ${h.startTime ?? "open"}-${h.endTime ?? "close"}${h.suspect ? "?" : ""}`)
          .join(", ");

        if (liveCount > 0) {
          // Real fill — venue will promote out of stub.
          if (APPLY) {
            const { windowsLive, windowsHidden } = await persistExtractedWindows({
              venueId: v.id,
              cityId: city.id,
              extracted: free,
              actor: "reextract-free",
            });
            console.log(
              `  ✓ ${v.name}: +${windowsLive} live${windowsHidden ? ` (+${windowsHidden} hidden)` : ""} [${days}]`,
            );
          } else {
            console.log(
              `  ✓ ${v.name}: WOULD write ${liveCount} live${hiddenCount ? ` (+${hiddenCount} hidden for review)` : ""} [${days}]`,
            );
          }
          filledLive++;
        } else {
          // Hidden-only — every window is suspect; venue stays a stub.
          if (APPLY) {
            const { windowsHidden } = await persistExtractedWindows({
              venueId: v.id,
              cityId: city.id,
              extracted: free,
              actor: "reextract-free",
            });
            console.log(
              `  ◦ ${v.name}: ${windowsHidden} window(s) captured hidden for review (stays stub) [${days}]`,
            );
          } else {
            console.log(
              `  ◦ ${v.name}: WOULD capture ${hiddenCount} hidden for review (stays stub) [${days}]`,
            );
          }
          hiddenOnly++;
        }
        continue;
      }

      // No clean parse — does the page even show a signal? If so, escalate to paid.
      const signalPage = built.pages.find((p) => hasHhOrDealSignal(p.text ?? ""));
      if (signalPage) {
        const snippet = (
          (signalPage.text ?? "").match(/.{0,40}happy[ -]?hour.{0,80}/i)?.[0] ??
          (signalPage.text ?? "").slice(0, 120)
        )
          .replace(/\s+/g, " ")
          .trim();
        shortlist.push({
          venueId: v.id,
          name: v.name,
          citySlug: city.slug,
          url: signalPage.url,
          snippet,
        });
        console.log(`  ⚑ ${v.name}: signal but no clean parse → escalate`);
        escalated++;
      } else {
        noSignal++;
      }
    }

    if (shortlist.length > 0) {
      const outFile = `docs/hh-escalation-${city.slug}.json`;
      writeFileSync(outFile, JSON.stringify(shortlist, null, 2));
      console.log(`\nEscalation shortlist (${shortlist.length}) → ${outFile}`);
      console.log("Run the paid extractor on these, e.g.:");
      for (const s of shortlist.slice(0, 10)) {
        console.log(`  pnpm tsx scripts/reextract-stubs.ts --venue ${s.venueId} --url ${s.url}`);
      }
      if (shortlist.length > 10) {
        console.log(`  …and ${shortlist.length - 10} more in ${outFile}`);
      }
    }

    console.log(`\n── Free fill complete ──`);
    console.log(
      `  filled → live ($0):       ${filledLive}${!APPLY && filledLive > 0 ? "  (dry-run — re-run with --apply to write)" : ""}`,
    );
    console.log(`  captured hidden (stub):   ${hiddenOnly}`);
    console.log(`  escalated (→ paid):       ${escalated}`);
    console.log(`  no signal (stub):         ${noSignal}`);
    console.log(`  social/non-extract:       ${social}`);
  } finally {
    // Close the headless browser if buildExtractRequest launched one (it won't here since
    // noRender:true, but we mirror reextract-stubs.ts's finally block for safety).
    await (await import("@/lib/verification/renderUrl")).closeRenderBrowser().catch(() => {});
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
