/**
 * Unit checks for sniffImageMediaType — derive an image's REAL media type from its magic bytes,
 * not the URL extension or the CDN's content-type header. No network ($0).
 * Run: pnpm tsx scripts/test-image-sniff.ts
 *
 * Why: CDNs transcode menus to WebP while keeping a .png/.jpg URL (and sometimes an image/png
 * header). Anthropic's vision API validates the declared media type against the magic bytes and
 * 400s the WHOLE request on a mismatch — dropping every bit of extraction for that venue → a bare
 * window (Wooden Nickel Tavern: bar-interior.png is actually WebP). Sniffing the bytes is the fix.
 */
import assert from "node:assert/strict";
import { sniffImageMediaType } from "@/lib/verification/fetchUrl";

let passed = 0;
function check(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const gif = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
// "RIFF" + 4 size bytes + "WEBP" — Wooden Nickel's real bar-interior.png header
const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x06, 0x3d, 0x08, 0x00]), Buffer.from("WEBPVP8X")]);

check("JPEG magic → image/jpeg", () => assert.equal(sniffImageMediaType(jpeg), "image/jpeg"));
check("PNG magic → image/png", () => assert.equal(sniffImageMediaType(png), "image/png"));
check("GIF magic → image/gif", () => assert.equal(sniffImageMediaType(gif), "image/gif"));
check("WebP (RIFF…WEBP) magic → image/webp", () => assert.equal(sniffImageMediaType(webp), "image/webp"));

check("WebP bytes at a .png URL still sniff as webp (the Wooden Nickel 400 bug)", () =>
  assert.equal(sniffImageMediaType(webp), "image/webp"));

check("unsupported/garbage bytes → null (caller skips, never feeds a 400-risky image)", () => {
  assert.equal(sniffImageMediaType(Buffer.from("<?xml version=\"1.0\"?><svg")), null); // SVG
  assert.equal(sniffImageMediaType(Buffer.from([0x00, 0x00, 0x00, 0x00])), null);
  assert.equal(sniffImageMediaType(Buffer.from("<!DOCTYPE html>")), null); // error page
});

check("too-short buffer → null (no crash)", () =>
  assert.equal(sniffImageMediaType(Buffer.from([0xff])), null));

console.log(`\n✓ ${passed} image-sniff checks passed.`);
