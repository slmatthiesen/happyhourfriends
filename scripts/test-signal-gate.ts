/**
 * Unit checks for pagesHaveExtractableSignal — the free gate that decides whether a venue's
 * fetched pages are worth a paid Haiku read. No DB/AI/network ($0).
 * Run: pnpm tsx scripts/test-signal-gate.ts
 */
import assert from "node:assert/strict";
import { pagesHaveExtractableSignal, type FetchedPage } from "@/lib/ai/siteContent";

let passed = 0;
function check(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }
const gate = (p: FetchedPage) => pagesHaveExtractableSignal([p]);

// WORDS — the strongest lead, always escalates.
check("text with a happy-hour signal → escalate", () =>
  assert.equal(gate({ url: "https://x.com/", text: "Happy Hour Mon-Fri 3-6pm" }), true));
check("text with a bare deal signal → escalate", () =>
  assert.equal(gate({ url: "https://x.com/", text: "Daily specials in the bar" }), true));
check("text with no HH/deal signal → no escalate", () =>
  assert.equal(gate({ url: "https://x.com/", text: "About our family restaurant." }), false));

// PDF — a document, almost always a menu; keep reading it regardless of name.
check("a PDF (any name) → escalate", () =>
  assert.equal(gate({ url: "https://x.com/Dine-In-Menu.pdf", pdfBase64: "JVBERi0=" }), true));

// IMAGES — only when the name looks like a menu (scoreHhUrl decodes %20/+ first).
check("image named happy_hour → escalate (Limón getbento)", () =>
  assert.equal(gate({ url: "https://cdn/15432happy_hour_1.png", imageBase64: "x", imageMediaType: "image/png" }), true));
check("image 'menu.jpg' → escalate", () =>
  assert.equal(gate({ url: "https://x.com/menu.jpg", imageBase64: "x", imageMediaType: "image/jpeg" }), true));
check("%20-encoded 'Online Menu' image → escalate (Tacoma Comedy Club; decode before matching)", () =>
  assert.equal(gate({ url: "https://x.com/1744356246-Tacoma%20Online%20Menu%202.jpg", imageBase64: "x", imageMediaType: "image/jpeg" }), true));
check("decorative dish photo item-400.jpg → NO escalate", () =>
  assert.equal(gate({ url: "https://x.com/item-400000009593607383.jpg", imageBase64: "x", imageMediaType: "image/jpeg" }), false));
check("food photo food-2.jpg → NO escalate", () =>
  assert.equal(gate({ url: "https://x.com/food-2-963244a415dacc28.jpg", imageBase64: "x", imageMediaType: "image/jpeg" }), false));
check("dessert photo Berry-Pie.png → NO escalate", () =>
  assert.equal(gate({ url: "https://x.com/Berry-Pie.png", imageBase64: "x", imageMediaType: "image/png" }), false));
check("a generic-name image alongside HH text still escalates (via the text)", () =>
  assert.equal(pagesHaveExtractableSignal([
    { url: "https://x.com/IMG_2837.jpg", imageBase64: "x", imageMediaType: "image/jpeg" },
    { url: "https://x.com/", text: "happy hour daily 4-6" },
  ]), true));

check("nothing usable → no escalate", () =>
  assert.equal(gate({ url: "https://x.com/" }), false));

console.log(`\n✓ ${passed} signal-gate checks passed.`);
