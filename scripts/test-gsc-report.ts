/**
 * Runnable check: buildReport groups GSC rows by page, resolves each page, enriches
 * venue pages via the injected lookup, derives status, and sorts by impressions.
 * Run: tsx scripts/test-gsc-report.ts
 */
import assert from "node:assert";
import { buildReport, type VenueLookup } from "@/lib/gsc/report";
import type { SearchAnalyticsRow } from "@/lib/gsc/client";

let passed = 0;
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve(fn()).then(() => { passed++; console.log(`  ✓ ${name}`); });
}

const rows: SearchAnalyticsRow[] = [
  { page: "https://x.com/ca/oakland/venue/alamar", query: "alamar happy hour", impressions: 40, clicks: 5, position: 3 },
  { page: "https://x.com/ca/oakland/venue/alamar", query: "happy hour oakland", impressions: 10, clicks: 0, position: 8 },
  { page: "https://x.com/ca/oakland/venue/stubby",  query: "stubby happy hour times", impressions: 25, clicks: 0, position: 6 },
  { page: "https://x.com/ca/oakland",               query: "oakland happy hour", impressions: 5, clicks: 1, position: 9 },
];

const lookup: VenueLookup = async ({ slug }) => {
  if (slug === "alamar") return { name: "alaMar", windowCount: 2, offeringCount: 12 };
  if (slug === "stubby") return { name: "Stubby Bar", windowCount: 0, offeringCount: 0 };
  return null;
};

await check("groups by page and sorts by impressions desc", async () => {
  const report = await buildReport(rows, lookup);
  assert.equal(report.length, 3);
  assert.deepEqual(report.map((e) => e.impressions), [50, 25, 5]);
});

await check("venue status derives from window/offering counts", async () => {
  const report = await buildReport(rows, lookup);
  const alamar = report.find((e) => e.page.endsWith("/alamar"))!;
  const stubby = report.find((e) => e.page.endsWith("/stubby"))!;
  assert.equal(alamar.venue!.status, "complete");
  assert.equal(stubby.venue!.status, "stub");
});

await check("unresolved venue (lookup null) is tagged", async () => {
  const r: SearchAnalyticsRow[] = [
    { page: "https://x.com/ca/oakland/venue/ghost", query: "ghost", impressions: 3, clicks: 0, position: 7 },
  ];
  const report = await buildReport(r, lookup);
  assert.equal(report[0].venue!.status, "unresolved");
});

await check("top queries are sorted and capped at 5", async () => {
  const report = await buildReport(rows, lookup);
  const alamar = report.find((e) => e.page.endsWith("/alamar"))!;
  assert.deepEqual(alamar.topQueries.map((q) => q.query), ["alamar happy hour", "happy hour oakland"]);
});

await check("city page has no venue block", async () => {
  const report = await buildReport(rows, lookup);
  const city = report.find((e) => e.kind === "city")!;
  assert.equal(city.venue, undefined);
});

console.log(`\n${passed} checks passed`);
