/**
 * webSearch — DuckDuckGo HTML endpoint scraper used by the Stage 2 verifier
 * tool loop (PRD §4.3). Returns up to 8 results with title, url, snippet.
 *
 * TODO: Upgrade to a paid search API (e.g. Brave Search, SerpAPI, or Bing
 *   Web Search) for higher rate limits and more reliable structured results
 *   when request volume grows (PRD §4.3).
 */

// USER_AGENT shared convention — identical string used in fetchUrl.ts
const USER_AGENT =
  "HappyHourFriendsBot/1.0 (+https://happyhourfriends.com)";

const DDG_URL = "https://html.duckduckgo.com/html/";
const TIMEOUT_MS = 10_000;
const MAX_RESULTS = 8;

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Extract plain text from a small HTML fragment (result title / snippet).
 * Strips tags and decodes basic entities.
 */
function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function webSearch(query: string): Promise<SearchResult[]> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const params = new URLSearchParams({ q: query });
    const res = await fetch(`${DDG_URL}?${params.toString()}`, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      },
    });
    clearTimeout(timer);

    if (!res.ok) return [];

    const html = await res.text();

    // DuckDuckGo HTML result links are <a class="result__a" href="...">title</a>
    // Snippets are in <a class="result__snippet" ...>snippet</a>
    const results: SearchResult[] = [];

    // Match result blocks: each starts with result__a then result__snippet
    // We iterate with a global regex over the full HTML.
    const linkRe =
      /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    const snippetRe =
      /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

    const links: { url: string; title: string }[] = [];
    let linkMatch: RegExpExecArray | null;
    while ((linkMatch = linkRe.exec(html)) !== null) {
      const rawUrl = linkMatch[1];
      const title = stripTags(linkMatch[2]);
      // DDG sometimes uses redirect URLs like //duckduckgo.com/l/?uddg=...
      let url = rawUrl;
      try {
        const uddg = new URL(
          rawUrl.startsWith("//") ? `https:${rawUrl}` : rawUrl,
        ).searchParams.get("uddg");
        if (uddg) url = decodeURIComponent(uddg);
      } catch {
        // keep rawUrl as-is
      }
      if (title && url) links.push({ url, title });
    }

    const snippets: string[] = [];
    let sMatch: RegExpExecArray | null;
    while ((sMatch = snippetRe.exec(html)) !== null) {
      snippets.push(stripTags(sMatch[1]));
    }

    const count = Math.min(links.length, MAX_RESULTS);
    for (let i = 0; i < count; i++) {
      results.push({
        title: links[i].title,
        url: links[i].url,
        snippet: snippets[i] ?? "",
      });
    }

    return results;
  } catch {
    return [];
  }
}
