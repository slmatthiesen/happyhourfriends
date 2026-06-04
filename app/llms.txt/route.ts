import { listCities } from "@/lib/queries/venues";
import { cityPath } from "@/lib/routes";
import { SITE_URL } from "@/lib/seo/structuredData";

// Generated at request time so `next build` never depends on a reachable DB (mirrors
// sitemap.ts). `/llms.txt` is an emerging convention (llmstxt.org) that points LLM
// crawlers at the site's key pages + a short description of what it is.
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const cities = await listCities(); // already filtered to status="live", cached

  const cityLines =
    cities
      .map(
        (c) =>
          `- [${c.name}, ${c.state}](${SITE_URL}${cityPath(c.state, c.slug)}): Verified happy-hour times and deals in ${c.name}, ${c.state}.`,
      )
      .join("\n") || "- No cities are live yet.";

  const body = `# Happy Hour Friends

> Community-verified happy-hour times and deals, aggregated into one sortable, filterable table per city. Every listing traces to a source; missing data is shown as a "help us add it" prompt rather than guessed.

## Cities
${cityLines}

## About
- [About](${SITE_URL}/about): What Happy Hour Friends is and how the data is verified.
- [FAQ](${SITE_URL}/faq): How data is collected, how submissions are verified, and why some data is missing.
- [For restaurants](${SITE_URL}/for-restaurants): How venues can correct or promote their listing.

## Notes
- Happy-hour times are venue-local; "happening now" is computed in each venue's own timezone.
- Data is AI-assisted with human review and community corroboration. Every applied change cites a source.
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
