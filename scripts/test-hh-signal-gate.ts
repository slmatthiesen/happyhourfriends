/**
 * The free pre-Claude gate: only escalate a venue to the (paid) extractor when its
 * fetched pages show SOME inkling of a deal — happy-hour wording, a "special"/"daily"/
 * "industry night"/"drink deal" mention, a time-range like 3-6pm — OR carry a PDF/image
 * menu we can't read for free. Pages with none of that (garbage/plain marketing) are
 * skipped at $0. Run: tsx scripts/test-hh-signal-gate.ts
 */
import assert from "node:assert";
import { hasHhOrDealSignal } from "@/lib/places/hhText";
import { pagesHaveExtractableSignal } from "@/lib/ai/siteContent";

let passed = 0;
function check(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

check("hasHhOrDealSignal: catches every happy-hour spelling", () => {
  for (const s of ["Join us for Happy Hour", "happy-hour menu", "our HappyHour deals", "happy_hour 4pm", "Happy Hr daily"]) {
    assert.ok(hasHhOrDealSignal(s), `should match: ${s}`);
  }
});

check("hasHhOrDealSignal: catches deal/special wording (any inkling)", () => {
  for (const s of [
    "Daily drink specials",
    "Industry Night every Monday",
    "Check out our specials",
    "Drink Deals on Wednesdays",
    "Open Mon-Fri 3-6pm bar menu",
    "Bar bites 4 - 7pm",
  ]) {
    assert.ok(hasHhOrDealSignal(s), `should match: ${s}`);
  }
});

check("hasHhOrDealSignal: skips garbage with zero indication", () => {
  for (const s of [
    "Authentic cuisine since 1985. Reservations recommended. Order online. Private events welcome.",
    "Welcome to our restaurant. Catering and delivery available. Contact us today.",
    "",
  ]) {
    assert.ok(!hasHhOrDealSignal(s), `should NOT match: ${s}`);
  }
});

check("pagesHaveExtractableSignal: true when any text page has a signal", () => {
  assert.ok(pagesHaveExtractableSignal([
    { url: "https://x.com/about", text: "About us. Order online." },
    { url: "https://x.com/menu", text: "Happy Hour Mon-Fri 3-6pm" },
  ]));
});

check("pagesHaveExtractableSignal: true for a PDF or image even with no text (can't read free)", () => {
  assert.ok(pagesHaveExtractableSignal([{ url: "https://x.com/hh.pdf", pdfBase64: "JVBERi0=" }]), "pdf escalates");
  assert.ok(pagesHaveExtractableSignal([{ url: "https://x.com/flyer.jpg", imageBase64: "/9j/4AA=", imageMediaType: "image/jpeg" }]), "image escalates");
});

check("pagesHaveExtractableSignal: false for garbage-only text pages", () => {
  assert.ok(!pagesHaveExtractableSignal([
    { url: "https://x.com", text: "Welcome. Reservations recommended. Order online for pickup." },
    { url: "https://x.com/about", text: "Family owned since 1985. Catering available." },
  ]));
});

check("pagesHaveExtractableSignal: false for no pages", () => {
  assert.ok(!pagesHaveExtractableSignal([]));
});

console.log(`\n${passed} checks passed.`);
