/**
 * Runnable check: the extractor request gives the model NO web tools and forces the
 * structured-output tool — i.e. the model can never run up web_search/web_fetch charges.
 * Uses .invalid hostnames so the internal fetch fails instantly (no network/timeouts).
 * Run: npx tsx scripts/test-extract-request.ts — exits non-zero on failure.
 */
import assert from "node:assert/strict";
import { buildExtractRequest } from "@/lib/ai/extractHappyHours";

let passed = 0;
function check(name: string) { passed++; console.log(`  ✓ ${name}`); }

async function main() {
  const req = await buildExtractRequest({
    venueName: "Brix",
    websiteUrl: "http://brix.invalid",
    otherUrl: null,
    cityName: "Phoenix",
    priorityUrls: ["http://brix.invalid/happy-hour", "http://brix.invalid/menus"],
  });

  const tools = req.params.tools ?? [];
  // Every tool-union member carries a `name`; only record_happy_hours should be present.
  const toolNames = tools.map((t) => t.name);
  assert.deepEqual(toolNames, ["record_happy_hours"]);
  check("only record_happy_hours is offered (no web_search / web_fetch)");

  // Belt-and-suspenders: no server-side web tool type anywhere in the request.
  assert.ok(!/web_(search|fetch)/.test(JSON.stringify(tools)));
  check("no server-side web tool declared");

  assert.deepEqual(req.params.tool_choice, { type: "tool", name: "record_happy_hours" });
  check("tool_choice forces record_happy_hours (single-shot)");

  // Unreachable .invalid hosts → nothing fetched → caller will stub without spending.
  assert.deepEqual(req.fetchedUrls, []);
  check("unreachable site yields no fetched content");

  console.log(`\n${passed} checks passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
