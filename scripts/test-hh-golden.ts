/**
 * test-hh-golden — GOLDEN-SET regression test for the free HTML→happy-hour pipeline.
 * Run: pnpm tsx scripts/test-hh-golden.ts  (exits non-zero on any mismatch)
 *
 * Each case is a real-shaped venue page committed under scripts/fixtures/hh-golden/.
 * The test runs the ACTUAL pipeline a page goes through — stripHtml() (the same reduction
 * fetchUrl applies, incl. the <script>-JSON harvest) → freeExtractFromPages() (what the
 * persist layer writes) — and compares the result to the golden expectation:
 *
 *   live    = windows shown publicly (clean + plausible; suspect=false)
 *   review  = captured but HIDDEN for operator review (clean + implausible; suspect=true)
 *   null    = nothing trustworthy → no write (escalate / stay stub)
 *
 * This is FULLY OFFLINE: it reads static fixtures, never the network. The deterministic
 * parse it exercises is pure regex over already-fetched text — it is NOT re-fetched or
 * re-run per page beyond the single pass the free path already does. To extend the golden
 * set, drop a new .html in the fixtures dir and add one GOLDEN entry below.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripHtml } from "@/lib/verification/fetchUrl";
import { freeExtractFromPages } from "@/lib/ai/freeExtract";

interface WindowSig {
  days: number[];
  start: string | null;
  end: string | null;
}
interface GoldenCase {
  file: string;
  what: string;
  live: WindowSig[]; // expected publicly-shown windows
  review: number; // expected hidden-for-review window count
  resultNull: boolean; // true → freeExtractFromPages returns null (nothing written)
}

const GOLDEN: GoldenCase[] = [
  {
    file: "visible-hh.html",
    what: "HH in visible HTML, two windows incl. a to-close late-night",
    live: [
      { days: [1, 2, 3, 4, 5], start: "15:00", end: "18:00" },
      { days: [4, 5, 6], start: "22:00", end: null },
    ],
    review: 0,
    resultNull: false,
  },
  {
    file: "script-json-hh.html",
    what: "client-hydrated page; HH lives ONLY in a <script> JSON blob (harvest path)",
    live: [{ days: [1, 2, 3, 4, 5, 6, 7], start: "16:00", end: "19:00" }],
    review: 0,
    resultNull: false,
  },
  {
    file: "operating-hours-and-prices.html",
    what: "no real HH — operating hours (12h) flagged for review; prices ignored",
    live: [],
    review: 1,
    resultNull: false,
  },
  {
    file: "marketing-no-time.html",
    what: "happy-hour wording but no time at all → nothing written",
    live: [],
    review: 0,
    resultNull: true,
  },
];

const META = { model: "deterministic-html-v1", promptHash: "golden" };
const sig = (w: { daysOfWeek: number[]; startTime: string | null; endTime: string | null }): WindowSig => ({
  days: w.daysOfWeek,
  start: w.startTime,
  end: w.endTime,
});
const sortSigs = (xs: WindowSig[]) =>
  [...xs].sort((a, b) => (a.start ?? "").localeCompare(b.start ?? "") || a.days.join().localeCompare(b.days.join()));

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

for (const g of GOLDEN) {
  check(`${g.file} — ${g.what}`, () => {
    const html = readFileSync(new URL(`./fixtures/hh-golden/${g.file}`, import.meta.url), "utf8");
    const text = stripHtml(html); // the exact reduction fetchUrl applies (incl. script-JSON harvest)
    const result = freeExtractFromPages([{ url: `https://golden.test/${g.file}`, text }], META);

    if (g.resultNull) {
      assert.equal(result, null, "expected null (nothing trustworthy to write)");
      return;
    }
    assert.ok(result, "expected a non-null ExtractResult");
    assert.equal(result!.costCents, 0, "free path must be $0");

    const liveSigs = result!.happyHours.filter((h) => !h.suspect).map(sig);
    const reviewCount = result!.happyHours.filter((h) => h.suspect).length;

    assert.deepEqual(sortSigs(liveSigs), sortSigs(g.live), "live (shown) windows mismatch");
    assert.equal(reviewCount, g.review, "hidden-for-review window count mismatch");
  });
}

console.log(`\n${passed} golden case(s) passed.`);
