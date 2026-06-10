/**
 * Unit tests for the pure pieces of lib/audit/adjudicateFlag — source classification,
 * deterministic venue screens, tool-call parsing, and verdict→action mapping. Cases
 * mirror the 2026-06-10 operator review corpus. Pure logic, no DB/API — runs in CI.
 */
import assert from "node:assert/strict";
import type { Message } from "@anthropic-ai/sdk/resources/messages";
import {
  classifySourceUrl,
  screenVenue,
  parseAdjudication,
  recommendAction,
  type AdjudicationInput,
  type StoredWindow,
} from "@/lib/audit/adjudicateFlag";

let passed = 0;
function check(name: string) {
  passed++;
  console.log(`  ✓ ${name}`);
}

function win(partial: Partial<StoredWindow>): StoredWindow {
  return {
    daysOfWeek: [1, 2, 3, 4, 5],
    startTime: "15:00",
    endTime: "18:00",
    allDay: false,
    sourceUrl: null,
    notes: null,
    offerings: [],
    ...partial,
  };
}

function input(partial: Partial<AdjudicationInput>): AdjudicationInput {
  return {
    venueName: "Test Venue",
    websiteUrl: "https://testvenue.com/",
    address: "123 Main St, Tucson, AZ",
    windows: [],
    pages: [],
    ...partial,
  };
}

// ── classifySourceUrl ─────────────────────────────────────────────────────────
{
  const site = "https://www.veroamorepizza.com/?utm_source=google";
  assert.equal(classifySourceUrl("https://veroamorepizza.com/page/happy-hour", site), "own");
  check("same registrable domain (www/query noise) → own");
  assert.equal(classifySourceUrl("https://catering.veroamorepizza.com/", site), "own_subdomain");
  check("catering subdomain → own_subdomain (Vero Amore pattern)");
  assert.equal(
    classifySourceUrl("https://cheerhop.com/tacoma/wooden-city-tacoma", "http://woodencitytacoma.com/"),
    "denylisted_aggregator",
  );
  check("cheerhop → denylisted_aggregator (Wooden City pattern)");
  assert.equal(
    classifySourceUrl("https://www.instagram.com/p/DQX2JrGAaO4/", "https://www.todosbuenos.com/"),
    "social",
  );
  check("instagram → social (Todos pattern)");
  assert.equal(
    classifySourceUrl(
      "https://www.blancococinacantina.com/locations/paradise-valley/",
      "http://blancotacostequila.com/",
    ),
    "third_party",
  );
  check("sibling-brand domain → third_party (Blanco airport pattern)");
}

// ── screenVenue ───────────────────────────────────────────────────────────────
{
  const blanco = screenVenue(
    input({
      venueName: "Blanco Tacos and Tequilas",
      address: "3400 Sky Hbr Blvd, Phoenix, AZ 85034, USA",
      websiteUrl: "http://blancotacostequila.com/",
      windows: [win({ sourceUrl: "https://www.blancococinacantina.com/locations/paradise-valley/" })],
    }),
  );
  assert.ok(blanco.policyHits.some((f) => f.includes("airport")));
  check("Sky Harbor address → airport policy hit");
  assert.ok(blanco.findings.some((f) => f.includes("third-party domain")));
  check("sibling-brand source surfaces as a third-party finding");

  const wolf = screenVenue(
    input({
      venueName: "WOLF Pool - Caesars Republic Scottsdale Resort",
      windows: [
        win({ sourceUrl: "https://www.caesarsrepublicscottsdale.com/group-wedding-event-rooms-scottsdale" }),
      ],
    }),
  );
  assert.ok(wolf.policyHits.some((f) => f.includes("resort")));
  check("resort token in name → policy hit");
  assert.ok(wolf.findings.some((f) => f.includes("event/group page")));
  check("wedding/event source path flagged");

  const nickel = screenVenue(
    input({
      windows: [
        win({
          offerings: [
            { kind: "drink", category: "beer", name: "Draft beers", priceCents: 200, description: null },
            { kind: "drink", category: "beer", name: "Domestic bottles", priceCents: 200, description: null },
            { kind: "drink", category: "spirit", name: "Well drinks", priceCents: 200, description: null },
          ],
        }),
      ],
    }),
  );
  assert.ok(nickel.findings.some((f) => f.includes("identical and ≤$3")));
  check("uniform $2-everything pricing flagged (Wooden Nickel pattern)");

  const clean = screenVenue(
    input({
      windows: [
        win({
          sourceUrl: "https://testvenue.com/happy-hour",
          offerings: [
            { kind: "drink", category: "beer", name: "Drafts", priceCents: 500, description: null },
            { kind: "food", category: "appetizer", name: "Wings", priceCents: 800, description: null },
          ],
        }),
      ],
    }),
  );
  assert.equal(clean.findings.length, 0);
  assert.equal(clean.policyHits.length, 0);
  check("own-sourced sane venue produces zero findings");
}

// ── parseAdjudication ─────────────────────────────────────────────────────────
{
  const msg = (inputObj: unknown): Message =>
    ({
      content: [{ type: "tool_use", id: "t", name: "record_adjudication", input: inputObj }],
    }) as unknown as Message;

  const ok = parseAdjudication(
    msg({ verdict: "corrected", site_schedule: "Mon-Fri 14:00-17:00", evidence: "2PM - 5PM", reason: "end differs" }),
  );
  assert.equal(ok.verdict, "corrected");
  assert.equal(ok.siteSchedule, "Mon-Fri 14:00-17:00");
  check("valid tool call parses");

  assert.equal(parseAdjudication(msg({ verdict: "definitely-fine", reason: "?" })).verdict, "unclear");
  check("unknown verdict value → unclear");
  assert.equal(parseAdjudication({ content: [] } as unknown as Message).verdict, "unclear");
  check("missing tool call → unclear");
}

// ── recommendAction ───────────────────────────────────────────────────────────
{
  const none = { findings: [], policyHits: [] };
  assert.equal(recommendAction("confirmed", none), "keep");
  assert.equal(recommendAction("corrected", none), "reextract");
  assert.equal(recommendAction("no_mention", none), "hide");
  assert.equal(recommendAction("unclear", none), "operator_review");
  check("verdicts map to the operator's review-corpus actions");
  assert.equal(recommendAction("confirmed", { findings: [], policyHits: ["airport"] }), "remove_venue");
  check("policy hit overrides any verdict → remove_venue");
}

console.log(`\n✓ ${passed} adjudicate-flag assertions passed.`);
