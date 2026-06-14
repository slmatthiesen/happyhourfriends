import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { venues, cities, seedCandidates } from "@/db/schema";
import { hhLikelihood } from "@/lib/places/hhLikelihood";
import { StubRow, type StubVenue } from "@/components/admin/stub-row";

export const dynamic = "force-dynamic";

export default async function StubsPage() {
  const rows = await db
    .select({
      id: venues.id,
      name: venues.name,
      type: venues.type,
      websiteUrl: venues.websiteUrl,
      cityName: cities.name,
      candUrl: seedCandidates.websiteUrl,
      primaryType: seedCandidates.primaryType,
      types: seedCandidates.types,
      hhProbeStatus: venues.hhProbeStatus,
      hhPageUrl: venues.hhPageUrl,
      address: venues.address,
      phone: venues.phone,
    })
    .from(venues)
    .leftJoin(cities, eq(venues.cityId, cities.id))
    .leftJoin(seedCandidates, eq(seedCandidates.resultingVenueId, venues.id))
    .where(
      and(
        eq(venues.dataCompleteness, "stub"),
        eq(venues.status, "active"),
        isNull(venues.deletedAt),
      ),
    )
    .limit(800);

  // Dedupe by venue (a venue can match >1 candidate row), score, sort most-likely first.
  const seen = new Set<string>();
  const items: StubVenue[] = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    items.push({
      id: r.id,
      name: r.name,
      cityName: r.cityName,
      websiteUrl: r.websiteUrl,
      candidateUrl: r.candUrl,
      type: r.type,
      score: hhLikelihood({ primaryType: r.primaryType, types: r.types, name: r.name }),
      hhProbeStatus: r.hhProbeStatus ?? null,
      hhPageUrl: r.hhPageUrl ?? null,
      address: r.address ?? null,
      phone: r.phone ?? null,
    });
  }
  items.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  // Blocked sites (confirmed unreadable) surface first — they're the manual-entry queue.
  const blocked = items.filter((v) => v.hhProbeStatus === "blocked");
  const rest = items.filter((v) => v.hhProbeStatus !== "blocked");
  const ordered = [...blocked, ...rest];

  const withSite = items.filter((v) => v.websiteUrl || v.candidateUrl).length;

  return (
    <main className="mt-8">
      <h1 className="text-3xl text-text-primary" style={{ fontFamily: "var(--font-serif)" }}>
        Stub resolver
      </h1>
      <p className="mt-2 text-text-muted">
        {items.length} stub venue(s) with no happy-hour data ({withSite} have a website).
        <strong> Auto-retry</strong> runs the full discovery + extract pipeline;{" "}
        <strong>Resolve with URL</strong> extracts from a menu/PDF/image link you paste.
        Each click is one paid model call; a found window flips the venue live.
      </p>

      {blocked.length > 0 && (
        <p className="mt-3 text-sm text-text-muted">
          <strong className="text-text-primary">{blocked.length} venue(s) need manual entry</strong>{" "}
          (site confirmed unreadable — shown first).
        </p>
      )}

      <div className="mt-6 overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-bg-elevated text-xs text-text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Venue (sorted by HH-likelihood)</th>
              <th className="px-3 py-2 font-medium">URLs</th>
              <th className="px-3 py-2 font-medium">Resolve</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((v) => (
              <StubRow key={v.id} venue={v} />
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
