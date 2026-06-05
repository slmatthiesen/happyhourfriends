/**
 * $0 recall-lift benchmark for the Firecrawl render backend. For each URL, fetch the page
 * three ways and compare what content/links each surfaces:
 *   1. plain  — fetchUrl only (today's default fast path; menu-dense reduced text)
 *   2. pw     — renderUrl with Firecrawl forced OFF (Playwright headless, visible text)
 *   3. fc     — scrapeWithFirecrawl directly (the Firecrawl render itself)
 * No Claude / Google calls — this only exercises the local content layer.
 *
 * The fc column shows Firecrawl's OWN output, and prints `fallback` when Firecrawl declines
 * (a PDF/image URL, an error, or empty markdown) — it never silently mirrors Playwright.
 * If FIRECRAWL_URL is set but the service is unreachable / unhealthy, the benchmark ABORTS
 * (a silent pw-mirror would make the proof-of-lift gate meaningless). If FIRECRAWL_URL is
 * unset, fc is reported as `off`.
 *
 * Caveat: plain's char count is menu-dense reduced text and pw's is visible innerText, so
 * raw counts are NOT directly comparable. The trustworthy signal is RECOVERY: a row where
 * plain is ~0 but pw/fc surface real content — and, for the Firecrawl question, rows where
 * fc beats pw.
 *
 * Usage:
 *   tsx scripts/bench-firecrawl.ts <url> [url2 ...]
 *   tsx scripts/bench-firecrawl.ts --file urls.txt   # one URL per line
 *
 * For a meaningful fc column, start a self-hosted Firecrawl (docs/firecrawl-setup.md) and
 * export FIRECRAWL_URL=http://localhost:3002 before running.
 */
import { readFileSync } from "node:fs";
import { fetchUrl } from "@/lib/verification/fetchUrl";
import { renderUrl, closeRenderBrowser } from "@/lib/verification/renderUrl";
import { scrapeWithFirecrawl } from "@/lib/places/firecrawl";

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

const fmt = (s: Stat) => `${s.ok ? "" : "✗"}${s.textChars}/${s.mediaLinks}${s.isDoc ? "(doc)" : ""}`;

/**
 * One-shot health check: is the configured Firecrawl actually usable? Returns reachable
 * (got any HTTP response) and ok (success:true on a trivial scrape). Mirrors the client's
 * /v2/scrape path so a wrong endpoint surfaces here too.
 */
async function probeFirecrawl(base: string): Promise<{ reachable: boolean; ok: boolean; detail: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const resp = await fetch(`${base.replace(/\/$/, "")}/v2/scrape`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com", formats: [{ type: "markdown" }] }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      return { reachable: true, ok: false, detail: `HTTP ${resp.status} from /v2/scrape (older builds use /v1 — adjust SCRAPE_PATH in lib/places/firecrawl.ts)` };
    }
    const j = (await resp.json().catch(() => null)) as { success?: boolean } | null;
    if (!j?.success) return { reachable: true, ok: false, detail: "response did not contain success:true" };
    return { reachable: true, ok: true, detail: "ok" };
  } catch (e) {
    return { reachable: false, ok: false, detail: (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const urls = parseArgs(process.argv.slice(2));
  if (urls.length === 0) {
    console.error("Usage: tsx scripts/bench-firecrawl.ts <url> [...] | --file urls.txt");
    process.exit(1);
  }

  const fcUrl = process.env.FIRECRAWL_URL;
  if (fcUrl) {
    const p = await probeFirecrawl(fcUrl);
    if (!p.ok) {
      console.error(`\n✗ FIRECRAWL_URL is set to ${fcUrl} but Firecrawl is not usable:`);
      console.error(`  ${p.reachable ? "reachable but unhealthy" : "UNREACHABLE"} — ${p.detail}`);
      console.error(`  Start the stack (docs/firecrawl-setup.md), or unset FIRECRAWL_URL to benchmark plain-vs-Playwright only.`);
      console.error(`  Aborting so the fc column can't silently mirror Playwright.\n`);
      process.exit(2);
    }
    console.log("✓ Firecrawl reachable — fc column reflects real Firecrawl renders.");
  } else {
    console.log("ℹ FIRECRAWL_URL unset — fc = 'off' (benchmarking plain vs Playwright only).");
  }

  console.log(`\nURL                                               | plain text/links | pw text/links | fc text/links`);
  console.log("-".repeat(110));

  for (const url of urls) {
    const plain = stat(await fetchUrl(url, { maxContent: 28_000 }));

    // Playwright column: force Firecrawl off so renderUrl uses Chromium.
    const saved = process.env.FIRECRAWL_URL;
    delete process.env.FIRECRAWL_URL;
    const pw = stat(await renderUrl(url));
    if (saved) process.env.FIRECRAWL_URL = saved;

    // Firecrawl column: call the client directly so we see ITS output (or an explicit
    // `fallback` when it declines: PDF/image URL, error, or empty markdown).
    let fcCell: string;
    if (!fcUrl) fcCell = "off";
    else {
      const fc = await scrapeWithFirecrawl(url);
      fcCell = fc ? fmt(stat(fc)) : "fallback";
    }

    const short = url.length > 48 ? url.slice(0, 45) + "..." : url.padEnd(48);
    console.log(`${short} | ${fmt(plain).padEnd(16)} | ${fmt(pw).padEnd(13)} | ${fcCell}`);
  }

  // Free the shared Chromium launched by the Playwright runs.
  await closeRenderBrowser().catch(() => {});
  console.log("\nLegend: <textChars>/<mediaLinks> — higher = more content surfaced.");
  console.log("  RECOVERY = plain ~0 but pw/fc > 0 (truly JS-walled). For Firecrawl's value, compare fc vs pw.");
  console.log("  fc 'fallback' = Firecrawl declined (PDF/image URL, error, or empty) → real pipeline uses Playwright there.");
}

main().catch((e) => { console.error(e); process.exit(1); });
