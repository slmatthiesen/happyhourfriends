/**
 * debug-extract — Phase-1 root-cause harness for the seed extractor. Runs the EXACT
 * enrich extract path on ONE venue and dumps every component boundary, with NO DB
 * writes. One model call (~3-5¢). Reveals WHERE happy-hour data is lost:
 *   triage → which pages discovered   |  fetch → which pages actually fed the model
 *   model  → raw record_happy_hours input (verbatim)
 *   normalise → rawWindowCount vs kept windows (so a §13/denylist drop is visible)
 *
 * Usage: tsx scripts/debug-extract.ts --url <site> --name "<venue>" [--type <primary_type>]
 *        tsx scripts/debug-extract.ts --candidate "North Italia" --city tucson
 */
import "dotenv/config";
import postgres from "postgres";
import type { Message, ToolUseBlock } from "@anthropic-ai/sdk/resources/messages";
import { anthropic } from "@/lib/ai/anthropic";
import { buildExtractRequest, parseRecordedExtract } from "@/lib/ai/extractHappyHours";
import { triageSite, resolveEnrichAction } from "@/lib/places/siteTriage";
import { hhLikelihood } from "@/lib/places/hhLikelihood";

function get(f: string) {
  const i = process.argv.indexOf(f);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  let name = get("--name");
  let url = get("--url") ?? null;
  let primaryType = get("--type") ?? null;
  let types: string[] | null = null;

  const candidateName = get("--candidate");
  if (candidateName) {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    const [city] = await sql<{ id: string }[]>`SELECT id FROM cities WHERE slug = ${get("--city") ?? "tucson"}`;
    const [c] = await sql<{ name: string; website_url: string | null; primary_type: string | null; types: string[] | null }[]>`
      SELECT name, website_url, primary_type, types FROM seed_candidates
      WHERE city_id = ${city.id} AND name ILIKE ${candidateName} LIMIT 1`;
    await sql.end();
    if (!c) throw new Error(`candidate '${candidateName}' not found`);
    name = c.name;
    url = c.website_url;
    primaryType = c.primary_type;
    types = c.types;
  }
  if (!name) throw new Error("need --name or --candidate");

  console.log(`\n══ DEBUG EXTRACT: ${name} ══`);
  console.log(`url: ${url ?? "(none)"}\n`);

  // ---- Boundary 1: triage (page discovery) ----
  const verdict = await triageSite({ websiteUri: url, name, cityName: null });
  const likelihood = hhLikelihood({ primaryType, types, name });
  const decided = resolveEnrichAction(verdict, likelihood);
  console.log("── triage ──");
  console.log(`  kind=${verdict.kind} decision=${verdict.decision} reach=${verdict.reachability}`);
  console.log(`  action=${decided.action}  hhSignalUrls(${verdict.hhSignalUrls.length}):`);
  verdict.hhSignalUrls.forEach((u) => console.log(`    • ${u}`));
  if (decided.action !== "extract") {
    console.log(`\n  → enrich would NOT call the model here (action=${decided.action}). Stopping.`);
    return;
  }

  // ---- Boundary 2: fetch (what the model is actually fed) ----
  const built = await buildExtractRequest({
    venueName: name,
    websiteUrl: verdict.kind === "real" ? verdict.url : null,
    otherUrl: null,
    cityName: null,
    priorityUrls: decided.priorityUrls,
  });
  console.log("\n── fetch (pages fed to model) ──");
  console.log(`  fetchedUrls(${built.fetchedUrls.length}):`);
  built.fetchedUrls.forEach((u) => console.log(`    • ${u}`));
  if (built.fetchedUrls.length === 0) {
    console.log("\n  → 0 pages fetched; model gets nothing. Loss is at the FETCH boundary.");
    return;
  }

  // Show whether the fed content even contains the words "happy hour".
  const fedText = built.params.messages
    .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("\n");
  const hhHit = fedText.match(/.{0,50}happy\s*hour.{0,50}/i);
  console.log(`  fed text length: ${fedText.length} chars`);
  console.log(`  contains "happy hour": ${hhHit ? `YES → …${hhHit[0].replace(/\s+/g, " ").trim()}…` : "no"}`);

  // ---- Boundary 3: model ----
  process.env.EXTRACT_DEBUG = "1";
  const response: Message = await anthropic().messages.create(built.params);
  console.log("\n── model ──");
  console.log(`  stop_reason=${response.stop_reason}  in=${response.usage.input_tokens} out=${response.usage.output_tokens}`);
  const toolCall = response.content.find((b): b is ToolUseBlock => b.type === "tool_use" && b.name === "record_happy_hours");
  console.log(`  record_happy_hours called: ${toolCall ? "yes" : "NO"}`);
  if (toolCall) {
    const raw = toolCall.input as { happyHours?: unknown[]; confidence?: number; summary?: string };
    console.log(`  raw confidence=${raw.confidence}  summary=${JSON.stringify(raw.summary)}`);
    console.log(`  raw happyHours (verbatim model output):`);
    console.log(JSON.stringify(raw.happyHours, null, 2).split("\n").map((l) => "    " + l).join("\n"));
  } else {
    const txt = response.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n");
    console.log(`  text reply (no tool call): ${txt.slice(0, 800)}`);
  }

  // ---- Boundary 4: normalise (§13 / denylist filtering) ----
  const parsed = parseRecordedExtract(response);
  console.log("\n── normalise (§13) ──");
  console.log(`  rawWindowCount(model proposed) = ${parsed.rawWindowCount}`);
  console.log(`  kept after §13 filtering       = ${parsed.happyHours.length}`);
  if (parsed.rawWindowCount > parsed.happyHours.length) {
    console.log(`  ⚠ ${parsed.rawWindowCount - parsed.happyHours.length} window(s) DROPPED by normalise — loss is at the NORMALISE boundary.`);
  }
  console.log(`  final windows: ${JSON.stringify(parsed.happyHours.map((h) => ({ days: h.daysOfWeek, start: h.startTime, end: h.endTime, allDay: h.allDay, src: h.sourceUrl })), null, 2).split("\n").map((l) => "    " + l).join("\n").trim()}`);

  console.log("\n══ VERDICT ══");
  if (parsed.happyHours.length > 0) console.log("  Extracted ≥1 window — NOT reproduced as a miss this run.");
  else if (parsed.rawWindowCount > 0) console.log("  Loss at NORMALISE: model found windows, §13 dropped them.");
  else if (toolCall) console.log("  Loss at MODEL: model was fed the page but recorded happyHours: [].");
  else console.log("  Loss at MODEL: no tool call at all.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
