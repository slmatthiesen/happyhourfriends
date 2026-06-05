/**
 * $0 recall-lift benchmark for the Firecrawl render backend. For each URL, fetch the page
 * three ways and compare what content/links each surfaces:
 *   1. plain  — fetchUrl only (today's default fast path)
 *   2. pw     — renderUrl with Firecrawl DISABLED (Playwright headless)
 *   3. fc     — renderUrl with Firecrawl ENABLED (needs FIRECRAWL_URL + a running stack)
 * No Claude / Google calls — this only exercises the local content layer.
 *
 * Usage:
 *   tsx scripts/bench-firecrawl.ts <url> [url2 ...]
 *   tsx scripts/bench-firecrawl.ts --file urls.txt   # one URL per line
 *
 * Requires FIRECRAWL_URL set (and `docker compose up -d` in a firecrawl checkout — see
 * docs/firecrawl-setup.md) for the `fc` column to be meaningful; otherwise `fc` mirrors `pw`.
 */
import { readFileSync } from "node:fs";
import { fetchUrl } from "@/lib/verification/fetchUrl";
import { renderUrl } from "@/lib/verification/renderUrl";

function parseArgs(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--file") {
      const f = argv[++i];
      out.push(...readFileSync(f, "utf8").split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
    } else if (argv[i].startsWith("http")) {
      out.push(argv[i]);
    }
  }
  return out;
}

type Stat = { textChars: number; mediaLinks: number; isDoc: boolean; ok: boolean };

function stat(r: { ok: boolean; contentText?: string; mediaLinks?: string[]; isPdf?: boolean; isImage?: boolean }): Stat {
  return {
    ok: r.ok,
    textChars: r.contentText?.length ?? 0,
    mediaLinks: r.mediaLinks?.length ?? 0,
    isDoc: Boolean(r.isPdf || r.isImage),
  };
}

async function main() {
  const urls = parseArgs(process.argv.slice(2));
  if (urls.length === 0) {
    console.error("Usage: tsx scripts/bench-firecrawl.ts <url> [...] | --file urls.txt");
    process.exit(1);
  }
  if (!process.env.FIRECRAWL_URL) {
    console.warn("⚠ FIRECRAWL_URL not set — `fc` column will mirror `pw` (Playwright).");
  }

  console.log(`\nURL                                               | plain text/links | pw text/links | fc text/links`);
  console.log("-".repeat(110));

  for (const url of urls) {
    const plain = stat(await fetchUrl(url, { maxContent: 28_000 }));

    const savedEnv = process.env.FIRECRAWL_URL;
    delete process.env.FIRECRAWL_URL; // force Playwright
    const pw = stat(await renderUrl(url));
    if (savedEnv) process.env.FIRECRAWL_URL = savedEnv;

    const fc = stat(await renderUrl(url)); // Firecrawl if configured, else Playwright again

    const fmt = (s: Stat) => `${s.ok ? "" : "✗"}${s.textChars}/${s.mediaLinks}${s.isDoc ? "(doc)" : ""}`;
    const short = url.length > 48 ? url.slice(0, 45) + "..." : url.padEnd(48);
    console.log(`${short} | ${fmt(plain).padEnd(16)} | ${fmt(pw).padEnd(13)} | ${fmt(fc)}`);
  }

  // Free the shared Chromium launched by the Playwright runs.
  await (await import("@/lib/verification/renderUrl")).closeRenderBrowser().catch(() => {});
  console.log("\nLegend: <textChars>/<mediaLinks>  — higher = more HH content recovered. (doc)=PDF/image bytes.");
}

main().catch((e) => { console.error(e); process.exit(1); });
