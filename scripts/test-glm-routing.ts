/**
 * Unit checks for GLM provider routing (no test framework in repo).
 * Sets dummy keys so the lazy Anthropic SDK clients construct without a network call.
 * Run: npx tsx scripts/test-glm-routing.ts — exits non-zero on any failure.
 */
process.env.GLM_API_KEY = "test-glm-key";
process.env.ANTHROPIC_API_KEY = "test-anthropic-key";

import assert from "node:assert/strict";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages";
import { clientForModel, isTextOnlyGlmModel } from "@/lib/ai/anthropic";
import { stripVisionBlocks, paramsHaveVisionBlocks } from "@/lib/ai/extractHappyHours";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

check("isTextOnlyGlmModel: text GLMs true, vision GLMs and non-GLMs false", () => {
  assert.equal(isTextOnlyGlmModel("glm-4.5-flash"), true);
  assert.equal(isTextOnlyGlmModel("glm-4.5-air"), true);
  assert.equal(isTextOnlyGlmModel("glm-4.5v"), false, "vision GLM keeps its images");
  assert.equal(isTextOnlyGlmModel("glm-4.6v-flash"), false);
  assert.equal(isTextOnlyGlmModel("claude-haiku-4-5"), false);
});

check("clientForModel routes glm-* to the z.ai endpoint, else Anthropic", () => {
  const glm = clientForModel("glm-4.5-flash");
  const anthropic = clientForModel("claude-haiku-4-5");
  assert.notEqual(glm, anthropic, "different clients per provider");
  assert.match(String(glm.baseURL), /z\.ai/, "GLM client points at z.ai compat endpoint");
  assert.doesNotMatch(String(anthropic.baseURL), /z\.ai/, "Anthropic client does not");
});

check("clientForModel caches one client per provider", () => {
  assert.equal(clientForModel("glm-4.5-flash"), clientForModel("glm-4.5-air"), "GLM client cached");
  assert.equal(clientForModel("claude-haiku-4-5"), clientForModel("claude-sonnet-4-6"), "Anthropic cached");
});

const visionParams = (): MessageCreateParamsNonStreaming => ({
  model: "glm-4.5-flash",
  max_tokens: 8,
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: "page text" },
        { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: "BBBB" } },
        { type: "text", text: "more text" },
      ],
    },
  ],
});

check("stripVisionBlocks removes image AND document blocks, keeps text", () => {
  const stripped = stripVisionBlocks(visionParams());
  const content = stripped.messages[0].content as { type: string }[];
  assert.equal(content.length, 2, "only the two text blocks remain");
  assert.ok(!content.some((b) => b.type === "image" || b.type === "document"), "no vision blocks left");
});

check("paramsHaveVisionBlocks detects image/PDF, false for text-only", () => {
  assert.equal(paramsHaveVisionBlocks(visionParams()), true, "image+document present");
  const textOnly: MessageCreateParamsNonStreaming = {
    model: "glm-4.5-flash",
    max_tokens: 8,
    messages: [{ role: "user", content: [{ type: "text", text: "only text" }] }],
  };
  assert.equal(paramsHaveVisionBlocks(textOnly), false);
});

console.log(`\n${passed} checks passed.`);
