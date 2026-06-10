/**
 * Runnable check: AI evidence-image relevance gate (lib/moderation/evidenceRelevance).
 * Fail-open contract: only an explicit is_venue_evidence=false rejects; unsupported
 * mimes, missing tool calls, and API errors all allow.
 *
 * Run: tsx scripts/test-evidence-relevance.ts
 */
import assert from "node:assert";
import type { Message } from "@anthropic-ai/sdk/resources/messages";
import {
  buildEvidenceCheckRequest,
  checkEvidenceRelevance,
  parseEvidenceVerdict,
  type AnthropicLike,
} from "@/lib/moderation/evidenceRelevance";

let passed = 0;
function check(name: string, fn: () => void | Promise<void>) {
  const r = fn();
  const done = () => { passed++; console.log(`  ✓ ${name}`); };
  return r instanceof Promise ? r.then(done) : done();
}

function fakeMessage(content: Message["content"]): Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content,
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 20 },
  } as Message;
}

function clientReturning(content: Message["content"]): AnthropicLike {
  return { messages: { create: async () => fakeMessage(content) } };
}

const IMG = { base64: "aGVsbG8=", mime: "image/jpeg", venueName: "The Office Bar" };

async function main() {
  await check("builds a vision request with the image block + forced tool", () => {
    const req = buildEvidenceCheckRequest(IMG);
    assert.ok(req);
    const content = req!.params.messages[0].content;
    assert.ok(Array.isArray(content) && content[0].type === "image");
    assert.equal((req!.params.tool_choice as { name: string }).name, "record_evidence_verdict");
    assert.ok(req!.promptHash.length > 0);
  });

  await check("unsupported mime → skipped, allowed", async () => {
    const r = await checkEvidenceRelevance({ ...IMG, mime: "image/heic" });
    assert.equal(r.allowed, true);
    assert.equal(r.checked, false);
  });

  await check("explicit not-evidence verdict → rejected", async () => {
    const r = await checkEvidenceRelevance(
      IMG,
      clientReturning([
        { type: "tool_use", id: "t1", name: "record_evidence_verdict", input: { is_venue_evidence: false, reason: "a meme" } },
      ] as Message["content"]),
    );
    assert.equal(r.allowed, false);
    assert.equal(r.checked, true);
    assert.match(r.reason, /venue evidence/);
  });

  await check("explicit evidence verdict → allowed", async () => {
    const r = await checkEvidenceRelevance(
      IMG,
      clientReturning([
        { type: "tool_use", id: "t1", name: "record_evidence_verdict", input: { is_venue_evidence: true, reason: "menu board" } },
      ] as Message["content"]),
    );
    assert.equal(r.allowed, true);
    assert.equal(r.checked, true);
  });

  await check("missing tool call → fail open", () => {
    const v = parseEvidenceVerdict(fakeMessage([{ type: "text", text: "hmm" }] as Message["content"]));
    assert.equal(v.allowed, true);
  });

  await check("non-boolean verdict → fail open", () => {
    const v = parseEvidenceVerdict(
      fakeMessage([
        { type: "tool_use", id: "t1", name: "record_evidence_verdict", input: { is_venue_evidence: "no", reason: "" } },
      ] as Message["content"]),
    );
    assert.equal(v.allowed, true);
  });

  await check("API error → fail open", async () => {
    const boom: AnthropicLike = { messages: { create: async () => { throw new Error("api down"); } } };
    const r = await checkEvidenceRelevance(IMG, boom);
    assert.equal(r.allowed, true);
    assert.equal(r.checked, false);
  });

  console.log(`\n${passed} checks passed.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
