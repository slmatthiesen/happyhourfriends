/**
 * Unit tests for source_url classification (lib/ui/sourceLink). Run:
 *   tsx scripts/test-source-link.ts
 */
import assert from "node:assert";
import { classifySource, sourceMeta } from "@/lib/ui/sourceLink";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

check("reader uploads (relative or absolute) → reader-photo", () => {
  assert.equal(classifySource("/uploads/evidence/ab12.jpg"), "reader-photo");
  assert.equal(classifySource("https://happyhourfriends.com/uploads/evidence/x.pdf"), "reader-photo");
  // Evidence path wins even though the file is a pdf — the point is a local submitted it.
});

check("menu PDFs → pdf", () => {
  assert.equal(classifySource("https://d266.cloudfront.net/files/Menus/EMPhappyhour.pdf"), "pdf");
  assert.equal(classifySource("https://x.com/HH.PDF"), "pdf");
});

check("menu images, including CDN URLs with query params → image", () => {
  assert.equal(classifySource("https://images.squarespace-cdn.com/.../BarMenu.jpg?format=1500w"), "image");
  assert.equal(classifySource("https://x.com/sign.PNG"), "image");
  assert.equal(classifySource("https://x.com/a.webp#frag"), "image");
});

check("normal web pages → page (extension-in-path must not false-positive)", () => {
  assert.equal(classifySource("https://ojoslocos.com/our-menu/happy-hour"), "page");
  assert.equal(classifySource("https://www.amicis.com/specials"), "page");
  assert.equal(classifySource("https://backyardspokane.com/"), "page");
});

check("sourceMeta returns a label + title per kind", () => {
  assert.equal(sourceMeta("/uploads/evidence/a.jpg").label, "Reader photo");
  assert.equal(sourceMeta("https://x.com/m.pdf").label, "Menu (PDF)");
  assert.equal(sourceMeta("https://x.com/m.jpg").label, "Menu photo");
  assert.equal(sourceMeta("https://x.com/happy-hour").label, "Source");
  assert.ok(sourceMeta("https://x.com/happy-hour").title.length > 0);
});

console.log(`\n${passed} checks passed.`);
