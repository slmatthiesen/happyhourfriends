/**
 * Google Search Console (Search Analytics API) access behind a small interface so the
 * data source is swappable and fakeable in tests. The real implementation authenticates
 * with a service-account JSON key (read-only webmasters scope) and POSTs to the REST
 * searchAnalytics/query endpoint. See docs/superpowers/specs/2026-06-19-gsc-visibility-check-design.md
 * for the one-time service-account setup.
 */
import { readFileSync } from "node:fs";
import { JWT } from "google-auth-library";

export interface SearchAnalyticsRow {
  page: string;
  query: string;
  impressions: number;
  clicks: number;
  position: number;
}

export interface SearchAnalyticsQuery {
  property: string;
  startDate: string;
  endDate: string;
  rowLimit: number;
}

export interface SearchAnalyticsClient {
  fetchRows(q: SearchAnalyticsQuery): Promise<SearchAnalyticsRow[]>;
}

const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

/** Build the real GSC client from env. Throws loudly if creds are missing. */
export function googleSearchConsoleClient(): SearchAnalyticsClient {
  const keyPath = process.env.GSC_SERVICE_ACCOUNT_KEY_PATH;
  if (!keyPath) {
    throw new Error(
      "GSC_SERVICE_ACCOUNT_KEY_PATH is not set. See the setup steps in " +
      "docs/superpowers/specs/2026-06-19-gsc-visibility-check-design.md",
    );
  }
  const key = JSON.parse(readFileSync(keyPath, "utf8")) as { client_email: string; private_key: string };
  const auth = new JWT({ email: key.client_email, key: key.private_key, scopes: [SCOPE] });

  return {
    async fetchRows(q: SearchAnalyticsQuery): Promise<SearchAnalyticsRow[]> {
      const { token } = await auth.getAccessToken();
      const endpoint =
        `https://searchconsole.googleapis.com/webmasters/v3/sites/` +
        `${encodeURIComponent(q.property)}/searchAnalytics/query`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate: q.startDate,
          endDate: q.endDate,
          dimensions: ["page", "query"],
          rowLimit: q.rowLimit,
        }),
      });
      if (!res.ok) {
        throw new Error(`GSC API ${res.status}: ${await res.text()}`);
      }
      const data = (await res.json()) as {
        rows?: { keys: [string, string]; clicks: number; impressions: number; position: number }[];
      };
      return (data.rows ?? []).map((r) => ({
        page: r.keys[0],
        query: r.keys[1],
        impressions: r.impressions,
        clicks: r.clicks,
        position: r.position,
      }));
    },
  };
}
