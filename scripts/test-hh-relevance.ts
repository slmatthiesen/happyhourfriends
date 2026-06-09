/**
 * Hermetic unit checks for the Haiku HH-relevance gate (no DB/network/API key, $0).
 * Run: pnpm tsx scripts/test-hh-relevance.ts — exits non-zero on any failure.
 */
import assert from "node:assert/strict";
import type { Message } from "@anthropic-ai/sdk/resources/messages";
import {
  buildRelevanceSnippet,
  buildRelevanceRequest,
  parseRelevanceVerdict,
  foldRelevanceCost,
  classifyHhRelevance,
  type ClassifyRelevanceOpts,
} from "@/lib/ai/hhRelevance";

let passed = 0;
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve(fn()).then(() => {
    passed++;
    console.log(`  ✓ ${name}`);
  });
}

/** Fabricate a Message whose only content is a record_relevance tool call. */
function toolMsg(relevant: boolean, reason = "r"): Message {
  return {
    id: "m", type: "message", role: "assistant", model: "claude-haiku-4-5",
    stop_reason: "tool_use", stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 8 } as Message["usage"],
    content: [
      { type: "tool_use", id: "t", name: "record_relevance",
        input: { is_recurring_happy_hour: relevant, reason } },
    ],
  } as Message;
}

async function run() {
  // --- buildRelevanceSnippet: labels by URL, caps length, ignores doc-only pages ---
  await check("snippet labels each HTML page by its Source url", () => {
    const s = buildRelevanceSnippet([
      { url: "https://v.com/a", text: "Happy hour Mon-Fri 4-6" },
      { url: "https://v.com/b", text: "Cocktails" },
    ]);
    assert.ok(s!.includes("Source: https://v.com/a"));
    assert.ok(s!.includes("Source: https://v.com/b"));
    assert.ok(s!.includes("Happy hour Mon-Fri 4-6"));
  });
  await check("snippet caps a very long page", () => {
    const s = buildRelevanceSnippet([{ url: "u", text: "x".repeat(10_000) }]);
    assert.ok(s!.length < 4_000, `expected per-page cap, got ${s!.length}`);
  });
  await check("snippet WINDOWS around the HH signal on a long page (no recall hole)", () => {
    // HH text sits at ~char 7000, well past the per-page cap — a head-only slice would
    // miss it and Haiku would wrongly skip a real happy hour. Windowing must include it.
    const s = buildRelevanceSnippet([
      { url: "u", text: "filler ".repeat(1000) + "HAPPY HOUR Mon-Fri 4-6pm $5 wells " + "tail ".repeat(1000) },
    ]);
    assert.ok(s!.toLowerCase().includes("happy hour mon-fri 4-6pm"), "HH text must survive the cap");
  });
  await check("snippet is null when there is no HTML text (doc-only)", () => {
    assert.equal(buildRelevanceSnippet([{ url: "u", pdfBase64: "JVBERi0=" }]), null);
    assert.equal(buildRelevanceSnippet([]), null);
  });

  // --- buildRelevanceRequest: null when no HTML, else a forced-tool params object ---
  await check("request null when no HTML text", () => {
    assert.equal(buildRelevanceRequest([{ url: "u", pdfBase64: "x" }], "V"), null);
  });
  await check("request forces record_relevance + carries prompt hash/model", () => {
    const r = buildRelevanceRequest([{ url: "u", text: "Happy hour 4-6" }], "V");
    assert.ok(r);
    assert.equal(r!.params.tool_choice && (r!.params.tool_choice as { name: string }).name, "record_relevance");
    assert.equal((r!.params.tools as { name: string }[])[0].name, "record_relevance");
    assert.ok(r!.promptHash.length >= 12);
    assert.ok(r!.model.includes("haiku"));
    assert.ok(JSON.stringify(r!.params.messages).includes("V")); // venue name filled
  });

  // --- parseRelevanceVerdict: reads the tool call; fail-OPEN on anything malformed ---
  await check("parse reads is_recurring_happy_hour=false", () => {
    const v = parseRelevanceVerdict(toolMsg(false, "covid notice"));
    assert.equal(v.relevant, false);
    assert.equal(v.reason, "covid notice");
  });
  await check("parse reads is_recurring_happy_hour=true", () =>
    assert.equal(parseRelevanceVerdict(toolMsg(true)).relevant, true));
  await check("parse fail-OPEN when no tool call present", () => {
    const m = { ...toolMsg(false), content: [{ type: "text", text: "hi" }] } as Message;
    assert.equal(parseRelevanceVerdict(m).relevant, true);
  });

  // --- foldRelevanceCost: adds usage + cents onto a base result ---
  await check("fold adds relevance usage + cents", () => {
    const folded = foldRelevanceCost(
      { usage: { inputTokens: 1000, outputTokens: 50 }, costCents: 3 },
      { usage: { inputTokens: 100, outputTokens: 8 }, costCents: 1 },
    );
    assert.deepEqual(folded.usage, { inputTokens: 1100, outputTokens: 58 });
    assert.equal(folded.costCents, 4);
  });

  // --- classifyHhRelevance: injected client, no network ---
  await check("classify returns the verdict the (mocked) model recorded", async () => {
    const client = { messages: { create: async () => toolMsg(false, "hotel packages") } };
    const v = await classifyHhRelevance(
      { pages: [{ url: "u", text: "Spa & dinner packages" }], venueName: "V" },
      { client: client as unknown as ClassifyRelevanceOpts["client"] },
    );
    assert.equal(v.relevant, false);
    assert.equal(v.reason, "hotel packages");
    assert.ok(v.costCents >= 0);
    assert.ok(v.model.includes("haiku"));
  });
  await check("classify fail-OPEN ($0) when there is no HTML to judge", async () => {
    let called = false;
    const client = { messages: { create: async () => { called = true; return toolMsg(false); } } };
    const v = await classifyHhRelevance(
      { pages: [{ url: "u", pdfBase64: "x" }], venueName: "V" },
      { client: client as unknown as ClassifyRelevanceOpts["client"] },
    );
    assert.equal(v.relevant, true);
    assert.equal(v.costCents, 0);
    assert.equal(called, false, "must not call the model when there's no HTML");
  });
  await check("classify fail-OPEN when the client throws", async () => {
    const client = { messages: { create: async () => { throw new Error("503"); } } };
    const v = await classifyHhRelevance(
      { pages: [{ url: "u", text: "ambiguous" }], venueName: "V" },
      { client: client as unknown as ClassifyRelevanceOpts["client"] },
    );
    assert.equal(v.relevant, true);
  });

  console.log(`\n✓ hh-relevance: ${passed} checks passed.`);
}
run().catch((e) => { console.error(e); process.exit(1); });
