/**
 * Backfill venues.type. Phase 1 (always): deterministic Google-type map + name-keyword
 * fallback via deriveVenueType. Phase 2 (default on, --no-ai to skip): a cheap Haiku
 * pass using NAME + Google types only (no web fetch) to upgrade obvious finer types.
 *
 *   npm run backfill:venue-types -- [--city <slug>] [--no-ai] [--dry-run] [--limit N]
 *
 * Idempotent. Phase 2 fails safe to the Phase-1 base (and skips entirely without
 * ANTHROPIC_API_KEY). Records Phase 2 spend to ai_usage_ledger (stage 'seed').
 */
import "dotenv/config";
import postgres from "postgres";
import { deriveVenueType, isVenueType, VENUE_TYPES } from "@/lib/places/venueType";
import { anthropic } from "@/lib/ai/anthropic";
import { MODELS } from "@/lib/ai/models";
import { costCents } from "@/lib/ai/pricing";
import { recordUsage } from "@/lib/ai/ledger";

type Sql = ReturnType<typeof postgres>;

function parseArgs() {
  const a = process.argv.slice(2);
  const get = (flag: string) => {
    const i = a.indexOf(flag);
    return i >= 0 ? a[i + 1] : undefined;
  };
  return {
    city: get("--city") ?? null,
    noAi: a.includes("--no-ai"),
    dryRun: a.includes("--dry-run"),
    limit: get("--limit") ? Number(get("--limit")) : null,
  };
}

interface Row {
  id: string;
  name: string;
  city_id: string;
  type: string | null;
  primary_type: string | null;
  types: string[] | null;
}

async function loadRows(sql: Sql, city: string | null, limit: number | null): Promise<Row[]> {
  const cityFilter = city
    ? sql`AND v.city_id = (SELECT id FROM cities WHERE slug = ${city})`
    : sql``;
  const limitClause = limit != null ? sql`LIMIT ${limit}` : sql``;
  return sql<Row[]>`
    SELECT v.id, v.name, v.city_id, v.type::text AS type,
           sc.primary_type, sc.types
    FROM venues v
    LEFT JOIN seed_candidates sc ON sc.google_place_id = v.google_place_id
    WHERE v.deleted_at IS NULL ${cityFilter}
    ORDER BY v.created_at ASC
    ${limitClause}
  `;
}

function distribution(rows: { type: string | null }[]): Record<string, number> {
  const d: Record<string, number> = {};
  for (const r of rows) {
    const k = r.type ?? "(null)";
    d[k] = (d[k] ?? 0) + 1;
  }
  return d;
}

async function phase1(sql: Sql, rows: Row[], dryRun: boolean): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  let writes = 0;
  for (const r of rows) {
    const t = deriveVenueType({ primaryType: r.primary_type, types: r.types, name: r.name });
    resolved.set(r.id, t);
    if (t !== r.type) {
      writes++;
      if (!dryRun) {
        await sql`UPDATE venues SET type = ${t}::venue_type, updated_at = now() WHERE id = ${r.id}`;
      }
    }
  }
  console.log(`Phase 1: ${writes} venue(s) ${dryRun ? "would change" : "updated"}.`);
  return resolved;
}

const REFINE_SYSTEM =
  "You categorize a bar/restaurant into exactly one type from a fixed list, using only " +
  "its name and Google place types. Reply with ONLY the single type token, nothing else. " +
  "Allowed: " + VENUE_TYPES.join(", ") + ". " +
  "Only choose a finer type (dive_bar, hotel_bar, sports_bar, cocktail_lounge, gastropub) " +
  "when the name/types make it obvious; otherwise repeat the base type you are given.";

async function refineOne(
  r: Row,
  base: string,
): Promise<{ type: string; inTok: number; outTok: number } | null> {
  const user =
    `Name: ${r.name}\n` +
    `Google primary type: ${r.primary_type ?? "(none)"}\n` +
    `Google types: ${(r.types ?? []).join(", ") || "(none)"}\n` +
    `Base type (your default if unsure): ${base}\n` +
    `Answer with one allowed type token.`;
  const resp = await anthropic().messages.create({
    model: MODELS.classifier,
    max_tokens: 16,
    system: REFINE_SYSTEM,
    messages: [{ role: "user", content: user }],
  });
  const text = resp.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim()
    .toLowerCase();
  const picked = isVenueType(text) ? text : base;
  return {
    type: picked,
    inTok: resp.usage.input_tokens,
    outTok: resp.usage.output_tokens,
  };
}

async function phase2(
  sql: Sql,
  rows: Row[],
  base: Map<string, string>,
  dryRun: boolean,
): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("Phase 2: skipped (no ANTHROPIC_API_KEY).");
    return;
  }
  let upgrades = 0;
  let inTok = 0;
  let outTok = 0;
  const cityIds = new Set<string>();
  for (const r of rows) {
    const b = base.get(r.id)!;
    let res: Awaited<ReturnType<typeof refineOne>> = null;
    try {
      res = await refineOne(r, b);
    } catch (err) {
      console.error(`  refine error for ${r.name}:`, err);
      continue; // fail safe: keep base
    }
    if (!res) continue;
    inTok += res.inTok;
    outTok += res.outTok;
    cityIds.add(r.city_id);
    if (res.type !== b) {
      upgrades++;
      console.log(`  ${r.name}: ${b} -> ${res.type}`);
      if (!dryRun) {
        await sql`UPDATE venues SET type = ${res.type}::venue_type, updated_at = now() WHERE id = ${r.id}`;
      }
    }
  }
  const cents = costCents(MODELS.classifier, { inputTokens: inTok, outputTokens: outTok });
  console.log(`Phase 2: ${upgrades} upgrade(s), ~${cents}¢ (${inTok}in/${outTok}out tokens).`);
  if (!dryRun && (inTok > 0 || outTok > 0)) {
    await recordUsage({
      stage: "seed",
      model: MODELS.classifier,
      usage: { inputTokens: inTok, outputTokens: outTok },
      costCents: cents,
      cityId: cityIds.size === 1 ? [...cityIds][0] : undefined,
    });
  }
}

async function main() {
  const args = parseArgs();
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
  const sql = postgres(process.env.DATABASE_URL);
  try {
    const rows = await loadRows(sql, args.city, args.limit);
    console.log(`Loaded ${rows.length} venue(s)${args.city ? ` for '${args.city}'` : ""}.`);
    console.log("Before:", distribution(rows));

    const base = await phase1(sql, rows, args.dryRun);
    if (!args.noAi) await phase2(sql, rows, base, args.dryRun);

    const after = await loadRows(sql, args.city, args.limit);
    console.log("After:", distribution(after));
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
