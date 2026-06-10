/** Unit checks for SSR-JSON rich-text recovery. Run: npx tsx scripts/test-embedded-text.ts */
import assert from "node:assert/strict";
import { extractEmbeddedText } from "@/lib/verification/fetchUrl";

let passed = 0;
const check = (n: string, fn: () => void) => { fn(); passed++; console.log("  ✓ " + n); };

// Square Online / Quill: HH copy lives in {"insert":"..."} inside a <script> JSON blob.
const squareHtml = `<html><body><script>window.x={"quill":{"ops":[{"insert":"Happy Hour Tue-Fri: 3:00pm-5:30pm\\nDinner: 3:00pm-closing\\n"}]}}</script></body></html>`;
check("recovers Quill insert text from script JSON", () => {
  const t = extractEmbeddedText(squareHtml);
  assert.match(t, /Happy Hour Tue-Fri: 3:00pm-5:30pm/);
});
check("JSON-unescapes newlines", () =>
  assert.match(extractEmbeddedText(squareHtml), /Dinner: 3:00pm-closing/));
check("ignores non-prose / empty inserts", () => {
  const t = extractEmbeddedText(`<script>[{"insert":"\\n"},{"insert":"  "},{"insert":"Real Text"}]</script>`);
  assert.equal(t, "Real Text");
});
check("empty when no embedded JSON", () =>
  assert.equal(extractEmbeddedText("<p>plain page</p>"), ""));

console.log(`\n${passed} checks passed`);
