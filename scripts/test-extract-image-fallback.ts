/**
 * Unit checks for the extractor's "API rejected a menu image" recovery (no test framework
 * in repo). A 400 "Could not process image" must NOT lose the venue — we retry once with
 * image blocks stripped so the text/PDF happy hour still extracts.
 * Run: npx tsx scripts/test-extract-image-fallback.ts — exits non-zero on any failure.
 */
import assert from "node:assert/strict";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages";
import { isImageProcessingError, stripImageBlocks } from "@/lib/ai/extractHappyHours";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// Shape the Anthropic SDK throws for an undecodable image (status 400 + nested message).
const imageErr = {
  status: 400,
  error: { type: "error", error: { type: "invalid_request_error", message: "Could not process image" } },
};

check("isImageProcessingError detects the 400 image rejection", () => {
  assert.equal(isImageProcessingError(imageErr), true);
});
check("isImageProcessingError ignores unrelated errors", () => {
  assert.equal(isImageProcessingError({ status: 429, error: { message: "rate limited" } }), false);
  assert.equal(isImageProcessingError({ status: 400, error: { message: "max_tokens too large" } }), false);
  assert.equal(isImageProcessingError(new Error("network down")), false);
  assert.equal(isImageProcessingError(null), false);
});

const params = (): MessageCreateParamsNonStreaming => ({
  model: "claude-haiku-4-5",
  max_tokens: 8,
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: "page text" },
        { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
        { type: "text", text: "more text" },
      ],
    },
  ],
});

check("stripImageBlocks removes image blocks, keeps text", () => {
  const stripped = stripImageBlocks(params());
  assert.ok(stripped, "returns new params when an image was present");
  const content = stripped!.messages[0].content;
  assert.ok(Array.isArray(content));
  assert.equal((content as unknown[]).length, 2, "two text blocks remain");
  assert.ok(!(content as { type: string }[]).some((b) => b.type === "image"), "no image blocks left");
});
check("stripImageBlocks returns null when there is nothing to strip", () => {
  const noImages: MessageCreateParamsNonStreaming = {
    model: "claude-haiku-4-5",
    max_tokens: 8,
    messages: [{ role: "user", content: [{ type: "text", text: "only text" }] }],
  };
  assert.equal(stripImageBlocks(noImages), null);
});

console.log(`\n${passed} checks passed.`);
