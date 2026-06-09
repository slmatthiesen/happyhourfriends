# Haiku HH-relevance gate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the brittle URL/keyword paid-vs-skip relevance heuristics with one cheap Haiku content read, placed at the single `extractHappyHours` chokepoint so `seed:enrich`, `reextract`, and audit escalation all stop paying the full extractor to read soft-404 catch-alls / covid / hours / hotel-package pages.

**Architecture:** New `lib/ai/hhRelevance.ts` (pure request/parse helpers + an injectable-client I/O shell). Wired as a 4th gate in `extractHappyHours` after the free deterministic parse: docs go straight to the extractor (a single vision call that returns `[]` on a junk doc — a separate vision relevance read would re-pay the expensive doc input), HTML is gated by the Haiku read. The audit's pure `routeEscalation` gains a `relevance-check` route resolved by the *same* classifier, so there is one relevance brain. `isDrinkOrHhPageUrl` and the `scoreHhUrl`-relevance plumbing are deleted; `scoreHhUrl` survives only for candidate *selection*.

**Tech Stack:** TypeScript (strict), `@anthropic-ai/sdk` (Haiku forced tool call), Drizzle/postgres.js (ledger), `tsx` test scripts (hermetic, no DB/network/keys), pnpm.

**Spec:** `docs/superpowers/specs/2026-06-09-hh-relevance-classifier-design.md`

**Branch:** `feat/hh-relevance-classifier` (already created off `feat/data-anomaly-audit` @ `55699c0`, in worktree `/Users/stevenmatthiesen/Personal/hhf-audit`).

**Cost-folding decision:** The relevance Haiku call's `usage`/`costCents` are FOLDED into the `ExtractResult` the chokepoint returns (and into the audit's `EscalationResult.costCents`). This guarantees no dollar is hidden from the existing ledger/report totals with zero caller-signature changes. A dedicated `relevance` ledger stage is deferred (YAGNI) — visibility, the operator's actual concern, is preserved by folding.

**Fail-open rule:** The relevance gate is a *cost optimizer, not a correctness gate*. Any error (API failure, malformed tool call, no HTML text to judge) resolves to `relevant: true` so a real happy hour is never dropped because the cheap classifier hiccuped.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/ai/models.ts` | add `relevance` model id (env-overridable) — MODIFY |
| `prompts/hh-relevance.md` | versioned relevance prompt (system + user, `{{venue_name}}`/`{{pages}}`) — CREATE |
| `lib/ai/hhRelevance.ts` | pure `buildRelevanceSnippet`/`buildRelevanceRequest`/`parseRelevanceVerdict`/`foldRelevanceCost` + I/O `classifyHhRelevance(injectable client)` — CREATE |
| `scripts/test-hh-relevance.ts` | hermetic unit tests for the above (mock client) — CREATE |
| `lib/ai/extractHappyHours.ts` | insert doc fast-path + Haiku gate before `runExtractModel`; fold cost — MODIFY |
| `lib/audit/renderEscalation.ts` | `routeEscalation` → add `relevance-check`, drop heuristic branch + `hhPageUrl` param, drop `isDrinkOrHhPageUrl`/`matchesHappyHour` imports — MODIFY |
| `scripts/audit-fix.ts` | resolve `relevance-check` via `classifyHhRelevance`; `--estimate` relevance bucket; fold cost — MODIFY |
| `lib/places/hhText.ts` | delete `isDrinkOrHhPageUrl` — MODIFY |
| `scripts/test-hh-text.ts` | remove `isDrinkOrHhPageUrl` cases — MODIFY |
| `scripts/test-render-escalation.ts` | update `routeEscalation` cases for `relevance-check` + docs-always-paid — MODIFY |
| `scripts/test-hh-signal-gate.ts` | add empty-page fixtures (Toast/About/no-menu) — MODIFY |
| `scripts/ci-tests.sh` | register `test:hh-relevance` — MODIFY |

---

## Task 1: Add the `relevance` model id + the versioned prompt

**Files:**
- Modify: `lib/ai/models.ts`
- Create: `prompts/hh-relevance.md`

- [ ] **Step 1: Add the model id**

In `lib/ai/models.ts`, add to the `MODELS` object (after `extractor`):

```ts
  // HH-relevance gate. A cheap content read — "is this a recurring happy hour?" — that
  // gates the (more expensive) extractor: kills wasted extractions of soft-404 catch-alls,
  // covid notices, operating hours, and hotel-package pages. Haiku by default.
  relevance: process.env.ANTHROPIC_MODEL_RELEVANCE ?? "claude-haiku-4-5",
```

- [ ] **Step 2: Create the prompt file**

Create `prompts/hh-relevance.md` exactly:

```markdown
---
prompt: hh-relevance
version: 1
model: claude-haiku-4-5
notes: Pinned via sha256 content hash recorded with the call. v1 — gate the paid HH
  extractor. Reads page CONTENT (never URLs) and answers a single yes/no — does this
  describe a recurring happy hour. Replaces brittle URL/keyword heuristics.
---

# System

You decide ONE thing: do the provided web-page excerpts describe a **recurring happy
hour** at this venue — discounted drinks and/or food offered at set times on an ongoing
basis (e.g. "Mon–Fri 4–6pm", "industry night Tuesdays", a drink menu that lists happy-hour
pricing)?

Answer YES when the content shows a recurring, time-bounded discount on food or drink —
even if exact prices are not listed (a stated day+time window is enough).

Answer NO for anything that is NOT a recurring happy hour, including:
- one-time or dated events ("New Year's Eve party", "live music this Friday")
- closure / covid / "we're hiring" / reservation notices
- hotel, spa, or party PACKAGES (bundled deals, not a recurring drink/food happy hour)
- plain operating hours ("Open Mon–Sun 11:30am–9pm")
- an online-ordering shell or landing page with no menu/specials content
- a generic food or dinner menu with no happy-hour pricing or window

Judge ONLY the content provided. Do NOT use the page URL or your prior knowledge of the
venue. When the excerpts are empty or unreadable, answer YES (let the extractor decide).

Call `record_relevance` exactly once with your verdict and a one-sentence reason.

# User

Venue: {{venue_name}}

Page excerpts:
{{pages}}
```

- [ ] **Step 3: Verify the prompt loads + hashes**

Run: `cd /Users/stevenmatthiesen/Personal/hhf-audit && pnpm tsx -e "import {loadPrompt,splitPrompt} from '@/lib/ai/promptHash'; const p=loadPrompt('hh-relevance.md'); const s=splitPrompt(p.content); console.log('hash',p.hash.slice(0,12)); console.log('system?',s.system.includes('recurring happy hour')); console.log('user?',s.user.includes('{{pages}}'));"`
Expected: prints a 12-char hash, `system? true`, `user? true`.

- [ ] **Step 4: Commit**

```bash
git add lib/ai/models.ts prompts/hh-relevance.md
git commit -m "feat(relevance): add relevance model id + versioned hh-relevance prompt"
```

---

## Task 2: `lib/ai/hhRelevance.ts` — pure helpers + injectable-client classifier (TDD)

**Files:**
- Create: `lib/ai/hhRelevance.ts`
- Create/Test: `scripts/test-hh-relevance.ts`

Pure pieces (`buildRelevanceSnippet`, `buildRelevanceRequest`, `parseRelevanceVerdict`, `foldRelevanceCost`) are unit-tested with no network. `classifyHhRelevance` takes an injectable `client` so the test drives it with a fake that returns a canned `Message` — no API key, no billing. The model's actual judgment (covid→no) is validated live in Task 9, not hermetically.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-hh-relevance.ts`:

```ts
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
      { client: client as unknown as Parameters<typeof classifyHhRelevance>[1]["client"] },
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
      { client: client as unknown as Parameters<typeof classifyHhRelevance>[1]["client"] },
    );
    assert.equal(v.relevant, true);
    assert.equal(v.costCents, 0);
    assert.equal(called, false, "must not call the model when there's no HTML");
  });
  await check("classify fail-OPEN when the client throws", async () => {
    const client = { messages: { create: async () => { throw new Error("503"); } } };
    const v = await classifyHhRelevance(
      { pages: [{ url: "u", text: "ambiguous" }], venueName: "V" },
      { client: client as unknown as Parameters<typeof classifyHhRelevance>[1]["client"] },
    );
    assert.equal(v.relevant, true);
  });

  console.log(`\n✓ hh-relevance: ${passed} checks passed.`);
}
run().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/stevenmatthiesen/Personal/hhf-audit && pnpm tsx scripts/test-hh-relevance.ts`
Expected: FAIL — `Cannot find module '@/lib/ai/hhRelevance'` (module not created yet).

- [ ] **Step 3: Implement `lib/ai/hhRelevance.ts`**

Create `lib/ai/hhRelevance.ts`:

```ts
/**
 * hhRelevance — the Haiku gate that decides whether a page is worth the (more expensive)
 * happy-hour extractor. It reads page CONTENT and answers one question: "does this describe
 * a recurring happy hour?" — replacing the brittle URL/keyword heuristics that paid to read
 * soft-404 catch-alls, covid notices, operating hours, and hotel-package pages.
 *
 * Pure pieces (snippet/request/parse/fold) are unit-tested; classifyHhRelevance is the only
 * I/O and takes an injectable client so tests run with no API key. The gate is a COST
 * optimizer, not a correctness gate: every failure path fails OPEN (relevant=true) so a real
 * happy hour is never dropped because the cheap classifier erred.
 */
import type {
  Message,
  MessageCreateParamsNonStreaming,
  ToolUnion,
  ToolChoiceTool,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";
import { anthropic, type Usage } from "@/lib/ai/anthropic";
import { costCents as calcCostCents } from "@/lib/ai/pricing";
import { MODELS } from "@/lib/ai/models";
import { loadPrompt, splitPrompt } from "@/lib/ai/promptHash";
import type { FetchedPage } from "@/lib/ai/siteContent";

/** Per-page and total caps on the text we feed Haiku — relevance needs a sample, not the
 *  whole site. Keeps the input cheap (this is the point of gating). */
const PER_PAGE_CHARS = 2_500;
const TOTAL_CHARS = 8_000;

export interface HhRelevanceVerdict {
  relevant: boolean;
  reason: string;
  usage: Usage;
  costCents: number;
  model: string;
  promptHash: string;
}

const RECORD_RELEVANCE: ToolUnion = {
  name: "record_relevance",
  description: "Record whether the provided page content describes a recurring happy hour.",
  input_schema: {
    type: "object",
    properties: {
      is_recurring_happy_hour: {
        type: "boolean",
        description: "True only for a recurring, time-bounded food/drink discount.",
      },
      reason: { type: "string", description: "One sentence justifying the verdict." },
    },
    required: ["is_recurring_happy_hour", "reason"],
  },
};

const FORCE_RELEVANCE: ToolChoiceTool = { type: "tool", name: "record_relevance" };

/** Build the labelled, capped text snippet from the HTML pages. null when there is no HTML
 *  text to judge (doc-only / empty) — the caller then fails open without a model call. */
export function buildRelevanceSnippet(pages: FetchedPage[]): string | null {
  const parts: string[] = [];
  let total = 0;
  for (const p of pages) {
    if (typeof p.text !== "string" || p.text.trim().length === 0) continue;
    if (total >= TOTAL_CHARS) break;
    const room = Math.min(PER_PAGE_CHARS, TOTAL_CHARS - total);
    const body = p.text.trim().slice(0, room);
    parts.push(`Source: ${p.url}\n${body}`);
    total += body.length;
  }
  return parts.length ? parts.join("\n\n---\n\n") : null;
}

export interface RelevanceRequest {
  params: MessageCreateParamsNonStreaming;
  promptHash: string;
  model: string;
}

/** Build the one-shot forced-tool request. null when there's no HTML text to judge. */
export function buildRelevanceRequest(
  pages: FetchedPage[],
  venueName: string,
): RelevanceRequest | null {
  const snippet = buildRelevanceSnippet(pages);
  if (snippet === null) return null;
  const loaded = loadPrompt("hh-relevance.md");
  const { system, user } = splitPrompt(loaded.content);
  const userText = user.replace("{{venue_name}}", venueName).replace("{{pages}}", snippet);
  return {
    params: {
      model: MODELS.relevance,
      max_tokens: 256,
      system,
      tools: [RECORD_RELEVANCE],
      tool_choice: FORCE_RELEVANCE,
      messages: [{ role: "user", content: userText }],
    },
    promptHash: loaded.hash,
    model: MODELS.relevance,
  };
}

/** Read the record_relevance tool call. Fail OPEN (relevant=true) on anything unexpected. */
export function parseRelevanceVerdict(message: Message): { relevant: boolean; reason: string } {
  const call = message.content.find(
    (b): b is ToolUseBlock => b.type === "tool_use" && b.name === "record_relevance",
  );
  if (!call) return { relevant: true, reason: "no tool call — fail open" };
  const input = call.input as { is_recurring_happy_hour?: unknown; reason?: unknown };
  // Only an explicit boolean false skips; anything else fails open.
  const relevant = input.is_recurring_happy_hour !== false;
  const reason = typeof input.reason === "string" ? input.reason : "";
  return { relevant, reason };
}

/** Add a relevance call's usage + cents onto a base extraction result's cost fields. */
export function foldRelevanceCost<T extends { usage: Usage; costCents: number }>(
  base: T,
  rel: { usage: Usage; costCents: number },
): T {
  return {
    ...base,
    usage: {
      inputTokens: base.usage.inputTokens + rel.usage.inputTokens,
      outputTokens: base.usage.outputTokens + rel.usage.outputTokens,
    },
    costCents: base.costCents + rel.costCents,
  };
}

const ZERO_USAGE: Usage = { inputTokens: 0, outputTokens: 0 };

/** A minimal structural type for the Anthropic client (injectable for tests). */
type AnthropicLike = { messages: { create: (p: MessageCreateParamsNonStreaming) => Promise<Message> } };

export interface ClassifyRelevanceInput {
  pages: FetchedPage[];
  venueName: string;
}

/**
 * The gate. Returns relevant=true at $0 (no model call) when there is no HTML to judge, and
 * fails open (relevant=true) on any model/parse error — never drop a real HH on a hiccup.
 */
export async function classifyHhRelevance(
  input: ClassifyRelevanceInput,
  opts: { client?: AnthropicLike } = {},
): Promise<HhRelevanceVerdict> {
  const req = buildRelevanceRequest(input.pages, input.venueName);
  if (req === null) {
    return { relevant: true, reason: "no HTML text to judge", usage: ZERO_USAGE, costCents: 0, model: MODELS.relevance, promptHash: "" };
  }
  const client = opts.client ?? (anthropic() as unknown as AnthropicLike);
  try {
    const message = await client.messages.create(req.params);
    const usage: Usage = {
      inputTokens: message.usage?.input_tokens ?? 0,
      outputTokens: message.usage?.output_tokens ?? 0,
    };
    const { relevant, reason } = parseRelevanceVerdict(message);
    return { relevant, reason, usage, costCents: calcCostCents(req.model, usage), model: req.model, promptHash: req.promptHash };
  } catch (e) {
    if (process.env.EXTRACT_DEBUG) console.error(`[relevance] fail-open: ${(e as Error).message}`);
    return { relevant: true, reason: "relevance call failed — fail open", usage: ZERO_USAGE, costCents: 0, model: req.model, promptHash: req.promptHash };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/stevenmatthiesen/Personal/hhf-audit && pnpm tsx scripts/test-hh-relevance.ts`
Expected: PASS — `✓ hh-relevance: 12 checks passed.`

- [ ] **Step 5: Typecheck**

Run: `cd /Users/stevenmatthiesen/Personal/hhf-audit && pnpm typecheck`
Expected: no new errors (the 2 pre-existing Phase-0 lint issues are unrelated).

- [ ] **Step 6: Commit**

```bash
git add lib/ai/hhRelevance.ts scripts/test-hh-relevance.ts
git commit -m "feat(relevance): Haiku HH-relevance classifier (pure helpers + injectable client) + hermetic tests"
```

---

## Task 3: Wire the gate into the `extractHappyHours` chokepoint

**Files:**
- Modify: `lib/ai/extractHappyHours.ts:619-631` (the tail after the `hasSignal` gate)

This is I/O-heavy (real fetch + model), so it is verified by typecheck + the pure tests in Tasks 2/4 + the live validation in Task 9 — not a new hermetic test (mocking the fetch+client through `buildExtractRequest` would test the SDK, not our logic). The folding math is already unit-tested via `foldRelevanceCost`.

- [ ] **Step 1: Add the import**

At the top of `lib/ai/extractHappyHours.ts`, after the `freeExtractFromPages` import (line ~38):

```ts
import { classifyHhRelevance, foldRelevanceCost } from "@/lib/ai/hhRelevance";
```

- [ ] **Step 2: Replace the free-first / paid tail**

Replace the current block (lines ~620-631):

```ts
  // Free deterministic parse: if the fetched HTML yields >=1 CLEAN happy-hour window,
  // take it for $0 and skip the paid model call entirely.
  // forcePaid bypasses this so audit render-escalation always reaches the model.
  if (!input.forcePaid) {
    const free = freeExtractFromPages(pages, { model: "deterministic-html-v1", promptHash });
    if (free) {
      if (process.env.EXTRACT_DEBUG) console.error(`[extract] free parse hit: ${free.happyHours.length} window(s), $0`);
      return free;
    }
  }

  return runExtractModel(built);
```

with:

```ts
  // forcePaid (audit render-escalation) skips every cost-optimization gate and goes
  // straight to the model — the caller already decided to spend.
  if (input.forcePaid) return runExtractModel(built);

  // Free deterministic parse: if the fetched HTML yields >=1 CLEAN happy-hour window,
  // take it for $0 and skip the paid model call entirely.
  const free = freeExtractFromPages(pages, { model: "deterministic-html-v1", promptHash });
  if (free) {
    if (process.env.EXTRACT_DEBUG) console.error(`[extract] free parse hit: ${free.happyHours.length} window(s), $0`);
    return free;
  }

  // Doc fast-path: a PDF/image IS the happy-hour lead. Send it straight to the (vision)
  // extractor — a separate vision relevance read would re-pay the expensive doc input on
  // every real menu, and the extractor itself returns [] on a junk doc.
  const hasDoc = pages.some((p) => p.pdfBase64 || p.imageBase64);
  if (hasDoc) return runExtractModel(built);

  // HTML-only Haiku relevance gate: the free parser found no clean window. Ask the cheap
  // model whether this is a recurring happy hour before paying the extractor. Not → skip
  // at the (tiny) relevance cost; yes → extract and fold the relevance cost into the total.
  const rel = await classifyHhRelevance({ pages, venueName: input.venueName });
  if (!rel.relevant) {
    if (process.env.EXTRACT_DEBUG) console.error(`[extract] relevance gate: skip (${rel.reason})`);
    return {
      ...EMPTY_PARSE,
      summary: `Relevance gate: not a recurring happy hour — skipped paid extraction (${rel.reason}).`,
      usage: rel.usage,
      costCents: rel.costCents,
      promptHash,
      model: rel.model,
    };
  }
  return foldRelevanceCost(await runExtractModel(built), rel);
```

- [ ] **Step 3: Typecheck**

Run: `cd /Users/stevenmatthiesen/Personal/hhf-audit && pnpm typecheck`
Expected: clean (no new errors). `EMPTY_PARSE` and `runExtractModel` are already in scope.

- [ ] **Step 4: Sanity-run the existing extract test**

Run: `cd /Users/stevenmatthiesen/Personal/hhf-audit && pnpm test:extract`
Expected: PASS (the all-day extract normalisation test is unaffected by the gate).

- [ ] **Step 5: Commit**

```bash
git add lib/ai/extractHappyHours.ts
git commit -m "feat(relevance): gate the paid extractor at the chokepoint — docs extract, HTML gated by Haiku"
```

---

## Task 4: `routeEscalation` — add `relevance-check`, drop the URL/keyword branch (TDD)

**Files:**
- Modify: `lib/audit/renderEscalation.ts:61-107`
- Test: `scripts/test-render-escalation.ts:85-129`

- [ ] **Step 1: Update the failing tests first**

In `scripts/test-render-escalation.ts`, replace the `routeEscalation` block (the cases at lines ~85-129) with these. The key changes: the old `isDrinkOrHhPageUrl`/`hhText` heuristic cases become `relevance-check`; any doc routes `paid`; `routeEscalation` no longer takes a 3rd `hhPageUrl` arg.

```ts
// --- routeEscalation: phase-2 STRUCTURAL routing (relevance now decided by the Haiku gate).
// free: clean stocked window | paid: doc OR clean-thin window | skip: no content |
// relevance-check: HTML with no clean window — caller asks classifyHhRelevance.
check("route paid: a PDF doc always extracts (single call returns [] on junk)", () =>
  assert.equal(routeEscalation([{ url: "https://v.com/Happy-Hour-Menu.pdf", pdfBase64: "JVBERi0=" }], null), "paid"));
check("route paid: an image doc always extracts", () =>
  assert.equal(routeEscalation([{ url: "https://v.com/menu.jpg", imageBase64: "abc", imageMediaType: "image/jpeg" }], null), "paid"));
check("route paid: a generic dinner-menu PDF also extracts (no filename rule anymore)", () =>
  assert.equal(routeEscalation([{ url: "https://v.com/Dinner-Menu.pdf", pdfBase64: "JVBERi0=" }], null), "paid"));
check("route relevance-check: HTML with no clean window → ask the Haiku gate", () =>
  assert.equal(routeEscalation([{ url: "h", text: "Our cocktail list and spirits." }], null), "relevance-check"));
check("route relevance-check: hotel-package HTML → ask the gate (no URL rule skips it)", () =>
  assert.equal(routeEscalation([{ url: "h", text: "Spa packages and a great dinner." }], null), "relevance-check"));
check("route paid: free parse found a clean but thin (no-offering) window → model finds offerings", () => {
  const pages = [{ url: "h", text: "happy hour 4-6" }];
  assert.equal(routeEscalation(pages, { happyHours: [{ suspect: false, offerings: [] }] }), "paid");
});
check("route free: free parse found a clean stocked window → $0", () => {
  const free = { happyHours: [{ suspect: false, offerings: [{}] }] };
  assert.equal(routeEscalation([{ url: "h", text: "real menu" }], free), "free");
});
check("route paid: suspect-only free window is ignored; a doc still extracts", () => {
  const free = { happyHours: [{ suspect: true, offerings: [{}] }] };
  assert.equal(routeEscalation([{ url: "h", pdfBase64: "JVBERi0=" }], free), "paid");
});
check("route relevance-check: suspect-only free window + HTML → ask the gate (never escalate on noise)", () => {
  const free = { happyHours: [{ suspect: true, offerings: [{}] }] };
  assert.equal(routeEscalation([{ url: "h", text: "Spa packages and dining specials." }], free), "relevance-check");
});
check("route skip: no usable content", () => {
  assert.equal(routeEscalation([], null), "skip");
  assert.equal(routeEscalation([{ url: "x" }], null), "skip");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/stevenmatthiesen/Personal/hhf-audit && pnpm test:render-escalation`
Expected: FAIL — current `routeEscalation` returns `"skip"`/`"paid"` for the cases now expecting `"relevance-check"`, and still has the 3rd param.

- [ ] **Step 3: Rewrite `routeEscalation`**

In `lib/audit/renderEscalation.ts`:

(a) Change the import line (12) from:
```ts
import { scoreHhUrl, matchesHappyHour, isDrinkOrHhPageUrl } from "@/lib/places/hhText";
```
to:
```ts
import { scoreHhUrl } from "@/lib/places/hhText";
```

(b) Change the `EscalationRoute` type (line 61) to add the new value:
```ts
export type EscalationRoute = "free" | "paid" | "skip" | "relevance-check";
```

(c) Replace the whole `routeEscalation` function (lines ~63-107) with:

```ts
/**
 * Phase-2 STRUCTURAL routing for a flagged venue's fetched HH pages. The paid-vs-skip
 * RELEVANCE judgment for ambiguous HTML is no longer made here (URL/keyword heuristics were
 * brittle) — it returns "relevance-check" and the async caller asks the Haiku gate
 * (classifyHhRelevance). Pure ($0, no DB/network/AI), so it stays unit-testable.
 *   - skip:            no usable page content was fetched.
 *   - free:            free parse yielded a clean, non-suspect window carrying >=1 offering.
 *   - paid:            a clean-but-thin (no-offering) window (model finds the offerings), OR
 *                      any PDF/image doc (a single vision call extracts, or returns [] on junk
 *                      — a separate relevance read would re-pay the doc input).
 *   - relevance-check: HTML with no clean window and no doc — let the Haiku gate decide.
 * Suspect-only free windows are parser NOISE and are ignored here (never an escalation signal).
 */
export function routeEscalation(
  pages: FetchedPage[],
  freeResult: { happyHours: { suspect?: boolean; offerings: unknown[] }[] } | null,
): EscalationRoute {
  const usable = pages.filter((p) => p.text || p.pdfBase64 || p.imageBase64);
  if (usable.length === 0) return "skip";
  const freeWindows = freeResult?.happyHours ?? [];
  // Free parse already found a clean window WITH offerings → take it for $0.
  if (freeWindows.some((w) => !w.suspect && w.offerings.length > 0)) return "free";
  // Clean but thin (no offerings) → the model may find the offerings (e.g. in a linked doc).
  if (freeWindows.some((w) => !w.suspect)) return "paid";
  // No clean window. A doc always extracts; ambiguous HTML goes to the Haiku relevance gate.
  const hasDoc = usable.some((p) => p.pdfBase64 || p.imageBase64);
  if (hasDoc) return "paid";
  return "relevance-check";
}
```

Note: `scoreHhUrl` is still imported because `needsRenderEscalation` (above, unchanged) uses it for candidate selection. `matchesHappyHour`/`isDrinkOrHhPageUrl` are no longer referenced here.

- [ ] **Step 4: Run to verify it passes**

Run: `cd /Users/stevenmatthiesen/Personal/hhf-audit && pnpm test:render-escalation`
Expected: PASS — all `needsRenderEscalation` cases (unchanged) + the rewritten `routeEscalation` cases.

- [ ] **Step 5: Commit**

```bash
git add lib/audit/renderEscalation.ts scripts/test-render-escalation.ts
git commit -m "feat(relevance): routeEscalation returns relevance-check; drop URL/keyword relevance branch"
```

---

## Task 5: Resolve `relevance-check` in `scripts/audit-fix.ts`

**Files:**
- Modify: `scripts/audit-fix.ts` — `fetchAndRoute` (call site of `routeEscalation`), `extractAndDiff` (route handling), and the `--estimate` loop.

- [ ] **Step 1: Add the import**

In `scripts/audit-fix.ts`, add to the imports:

```ts
import { classifyHhRelevance, foldRelevanceCost } from "@/lib/ai/hhRelevance";
```

- [ ] **Step 2: Resolve `relevance-check` inside `fetchAndRoute`**

`fetchAndRoute` returns `{ built, free, route }`. Drop the 3rd arg to `routeEscalation` and resolve a `relevance-check` into `paid`/`skip` by asking the gate, returning the verdict so the caller can fold its cost. Replace the tail of `fetchAndRoute` (the `const route = routeEscalation(...)` line and the return):

```ts
  const free = freeExtractFromPages(built.pages, extractorMetadata());
  let route = routeEscalation(built.pages, free);
  let relevance: Awaited<ReturnType<typeof classifyHhRelevance>> | null = null;
  if (route === "relevance-check") {
    relevance = await classifyHhRelevance({ pages: built.pages, venueName: c.v.name });
    route = relevance.relevant ? "paid" : "skip";
  }
  return { built, free, route, relevance };
```

Update the function's return-type annotation to include `relevance`:

```ts
): Promise<{
  built: Awaited<ReturnType<typeof buildExtractRequest>>;
  free: ExtractResult | null;
  route: EscalationRoute;
  relevance: Awaited<ReturnType<typeof classifyHhRelevance>> | null;
}> {
```

- [ ] **Step 3: Fold the relevance cost in `extractAndDiff`**

In `extractAndDiff`, the destructure becomes `const { built, free, route, relevance } = await fetchAndRoute(cityName, c);`. After `extracted` is assigned in the `route === "paid"` / `"free"` / else branches, fold the relevance cost so the report/spend totals include the gate's tiny cost. Immediately after the `if (route === ...) { ... } else { ... }` block that sets `extracted`, add:

```ts
  if (relevance) extracted = foldRelevanceCost(extracted, relevance);
```

(`ExtractResult` has `usage` + `costCents`, so `foldRelevanceCost` applies directly. When `route` resolved to `skip`, `extracted` is the zero-cost skip object and folding records just the relevance cost — correct: we DID spend on the gate.)

- [ ] **Step 4: Handle `relevance-check` in the `--estimate` loop (keep it $0)**

`--estimate` must not spend. In the estimate loop (lines ~122-153), `fetchAndRoute` would now call the Haiku gate for `relevance-check` venues — which costs money. Keep estimate at $0 by NOT calling `fetchAndRoute` for routing there; instead route structurally and bucket `relevance-check` separately. Replace the estimate loop body's routing with the pure structural route + a render/free-parse that does NOT resolve relevance:

```ts
      for (const c of toEscalate) {
        // Structural route only — do NOT resolve relevance-check here (that would spend).
        let route: EscalationRoute = "paid";
        try {
          const verdict = await triageSite({ websiteUri: c.v.website_url!, name: c.v.name, cityName: city.name });
          const decided = resolveEnrichAction(verdict, hhLikelihood({ primaryType: null, types: null, name: c.v.name }));
          const confirmedMinusHh = decided.confirmedHhUrls.filter((u) => u !== c.hhPage);
          const built = await buildExtractRequest({
            venueName: c.v.name,
            websiteUrl: c.hhPage,
            otherUrl: verdict.kind === "real" ? verdict.url : c.v.website_url,
            cityName: city.name,
            priorityUrls: confirmedMinusHh,
          });
          const free = freeExtractFromPages(built.pages, extractorMetadata());
          route = routeEscalation(built.pages, free);
        } catch {
          route = "skip"; // fetch/render failed → no content → $0
        }
        if (route === "paid") {
          billable++;
          console.log(`  $ ${c.v.name}: BILLABLE (route=paid — PDF/image or free-parse miss at ${c.hhPage})`);
        } else if (route === "relevance-check") {
          relevanceGated.push(c.v.name);
        } else {
          freeList.push(`${c.v.name} [${route}]`);
        }
      }
```

Add `const relevanceGated: string[] = [];` next to `const freeList: string[] = [];`, and extend the estimate summary print:

```ts
    console.log(`BILLABLE (route=paid → ~$0.03–0.05 each): ${billable}  → est $${lo}–$${hi}`);
    console.log(`RELEVANCE-GATED (HTML, Haiku ~\$0.00X decides paid-vs-skip at run time): ${relevanceGated.length}`);
    console.log(`FREE/SKIP (route=free|skip → $0, model skipped): ${freeList.length}`);
    if (relevanceGated.length) console.log(`\nWill ask the relevance gate (a subset become paid):\n${relevanceGated.map((n) => `  - ${n}`).join("\n")}`);
```

(This keeps `--estimate` at $0 and honest: the relevance-gated bucket is an upper bound on additional paid calls, most of which the gate will cut.)

- [ ] **Step 5: Typecheck**

Run: `cd /Users/stevenmatthiesen/Personal/hhf-audit && pnpm typecheck`
Expected: clean. Confirm `EscalationRoute` is already imported in `audit-fix.ts` (it is, line 27).

- [ ] **Step 6: Run the audit-fix hermetic test**

Run: `cd /Users/stevenmatthiesen/Personal/hhf-audit && pnpm test:audit-fix`
Expected: PASS (if it references `routeEscalation` with the old 3-arg signature, update those call sites to 2 args as part of this step, then re-run to green).

- [ ] **Step 7: Commit**

```bash
git add scripts/audit-fix.ts
git commit -m "feat(relevance): audit resolves relevance-check via the Haiku gate; \$0 estimate buckets it separately"
```

---

## Task 6: Delete `isDrinkOrHhPageUrl` and its tests

**Files:**
- Modify: `lib/places/hhText.ts:37-46` (delete the function)
- Modify: `scripts/test-hh-text.ts:43-54` (delete its cases)

- [ ] **Step 1: Confirm there are no remaining references**

Run: `cd /Users/stevenmatthiesen/Personal/hhf-audit && grep -rn "isDrinkOrHhPageUrl" --include="*.ts" lib scripts`
Expected: only `lib/places/hhText.ts` (definition) and `scripts/test-hh-text.ts` (its tests). If anything else appears, STOP — a caller was missed in Task 4/5.

- [ ] **Step 2: Delete the function**

In `lib/places/hhText.ts`, remove the entire `isDrinkOrHhPageUrl` block (the doc comment lines ~37-42 and the function lines ~43-46).

- [ ] **Step 3: Delete its tests**

In `scripts/test-hh-text.ts`, remove the `isDrinkOrHhPageUrl` import token and the two `check(...)` cases that exercise it (the "isDrinkOrHhPageUrl true/false" cases, ~lines 43-54). Leave the `matchesHappyHour`/`scoreHhUrl` cases.

- [ ] **Step 4: Run the hh-text test**

Run: `cd /Users/stevenmatthiesen/Personal/hhf-audit && pnpm test:hh-text`
Expected: PASS (remaining `matchesHappyHour`/`scoreHhUrl` cases).

- [ ] **Step 5: Typecheck**

Run: `cd /Users/stevenmatthiesen/Personal/hhf-audit && pnpm typecheck`
Expected: clean — no dangling imports of the deleted function.

- [ ] **Step 6: Commit**

```bash
git add lib/places/hhText.ts scripts/test-hh-text.ts
git commit -m "refactor(relevance): delete isDrinkOrHhPageUrl — relevance is now a content read, not a URL rule"
```

---

## Task 7: Free pre-filter review — empty-page fixtures + optional hardening decision

**Files:**
- Modify: `scripts/test-hh-signal-gate.ts` (add empty-page fixtures)
- Possibly modify: `lib/ai/siteContent.ts` (`pagesHaveExtractableSignal`) — ONLY if a clearly-empty class trips the gate.

This is the operator's explicit ask: confirm the truly-empty page classes (Toast/Clover online-ordering shells, empty About pages, no-menu-link homepages) fall through the FREE gate (`pagesHaveExtractableSignal === false`) so we never even pay Haiku for them.

- [ ] **Step 1: Inspect the current test + add fixtures (failing first)**

Open `scripts/test-hh-signal-gate.ts` and add these cases (import `pagesHaveExtractableSignal` from `@/lib/ai/siteContent` if not already imported):

```ts
// Empty-page classes the operator named — these must be caught FREE (skip before any model
// call). hasSignal=false means "no HH/deal wording and no PDF/image" → $0 skip.
check("toast online-ordering shell with no menu → no signal (skip free)", () =>
  assert.equal(pagesHaveExtractableSignal([
    { url: "https://v.com", text: "Order online for pickup or delivery. Powered by Toast. View location. Sign in." },
  ]), false));
check("empty about page → no signal (skip free)", () =>
  assert.equal(pagesHaveExtractableSignal([
    { url: "https://v.com/about", text: "About us. Family owned since 1998. Come visit us!" },
  ]), false));
check("no-menu-link homepage with generic copy → no signal (skip free)", () =>
  assert.equal(pagesHaveExtractableSignal([
    { url: "https://v.com", text: "Welcome. Reservations recommended. Contact us. Follow us on Instagram." },
  ]), false));
// Positive control: a real HH page DOES trip the gate (so we don't over-tighten).
check("a real happy-hour line → has signal (do NOT skip)", () =>
  assert.equal(pagesHaveExtractableSignal([
    { url: "https://v.com/hh", text: "Happy Hour Mon-Fri 4-6pm: $5 wells." },
  ]), true));
```

- [ ] **Step 2: Run the test**

Run: `cd /Users/stevenmatthiesen/Personal/hhf-audit && pnpm test:hh-signal-gate`
Expected: the three empty-page cases PASS (they contain no HH/deal words → false) and the positive control PASSES. If an empty-page case FAILS (returns true), it means `DEAL_RE` over-tripped on boilerplate (e.g. the word "specials"/"daily" in footer copy).

- [ ] **Step 3: Record the finding and decide on hardening**

- If all four pass: the free gate already catches the named empty classes. **No code change.** Document in the commit message: "free gate already skips Toast/About/no-menu pages; permissive DEAL_RE false-positives are now absorbed cheaply by the Haiku gate."
- If an empty case trips `DEAL_RE`: implement the **optional online-ordering-shell hardening** — in `lib/ai/siteContent.ts`, before the `hasHhOrDealSignal` check, treat a page as no-signal when it is a dominant online-ordering shell with negligible real content. Add a guard inside `pagesHaveExtractableSignal`:

```ts
/** Online-ordering platform shells (Toast/Clover/etc.) often render only a thin "order here"
 *  page that trips the permissive deal regex on boilerplate. When a page is dominated by such
 *  an embed and carries little real text, it has no extractable HH — skip it free. */
function isOnlineOrderingShell(p: FetchedPage): boolean {
  if (typeof p.text !== "string") return false;
  const t = p.text.toLowerCase();
  const orderingHost = /toasttab\.com|order\.online|clover\.com|chownow|toast\b/.test(t);
  return orderingHost && p.text.trim().length < 600;
}
```

and change the `.some(...)` predicate to `(p) => !isOnlineOrderingShell(p) && (Boolean(p.pdfBase64) || Boolean(p.imageBase64) || (typeof p.text === "string" && hasHhOrDealSignal(p.text)))`. **Ship this ONLY if it does not flip the positive control or any real-HH fixture to false.** Re-run the test to confirm.

- [ ] **Step 4: Commit**

```bash
git add scripts/test-hh-signal-gate.ts lib/ai/siteContent.ts
git commit -m "test(relevance): free-gate fixtures for empty pages (Toast/About/no-menu); [+ ordering-shell guard if needed]"
```

---

## Task 8: Register the new test + full hermetic suite green

**Files:**
- Modify: `scripts/ci-tests.sh` (add `test:hh-relevance`), `package.json` (add the `test:hh-relevance` script)

- [ ] **Step 1: Add the package.json script**

In `package.json` scripts, add next to the other `test:*` entries:

```json
    "test:hh-relevance": "tsx scripts/test-hh-relevance.ts",
```

- [ ] **Step 2: Register it in the CI suite**

In `scripts/ci-tests.sh`, add `test:hh-relevance` to the `TESTS=(...)` array (near `test:render-escalation` / `test:hh-text`).

- [ ] **Step 3: Run the FULL hermetic suite**

Run: `cd /Users/stevenmatthiesen/Personal/hhf-audit && pnpm test`
Expected: `✓ all N hermetic test suites passed.` (N increments by 1). In particular `test:hh-relevance`, `test:render-escalation`, `test:hh-text`, `test:hh-signal-gate`, `test:audit-fix`, `test:extract` all green.

- [ ] **Step 4: Typecheck + lint**

Run: `cd /Users/stevenmatthiesen/Personal/hhf-audit && pnpm typecheck && pnpm lint`
Expected: typecheck clean; lint shows only the 2 pre-existing Phase-0 issues (`db/schema/moderation.ts`, `scripts/import-neighborhoods.ts`) — no new ones.

- [ ] **Step 5: Commit**

```bash
git add package.json scripts/ci-tests.sh
git commit -m "test(relevance): register test:hh-relevance in the hermetic CI suite"
```

---

## Task 9: Live validation (operator-gated spend)

**Files:** none (validation only). Requires `ANTHROPIC_API_KEY` + `GOOGLE_PLACES_API_KEY` and a live local DB. **Get explicit go-ahead before any command that spends** (`--preview` spends; `--estimate` is $0).

- [ ] **Step 1: $0 estimate on Five Cities**

Run: `cd /Users/stevenmatthiesen/Personal/hhf-audit && pnpm audit:fix --city five-cities --state ca --escalate-paid --estimate`
Expected: prints BILLABLE / RELEVANCE-GATED / FREE-SKIP buckets, total estimate, and "this estimate cost $0." Giuseppe's (covid) + Marisol (packages) should appear under RELEVANCE-GATED or FREE/SKIP, not BILLABLE.

- [ ] **Step 2: (gated) Preview on Five Cities to confirm the gate's judgment**

Get go-ahead, then run: `pnpm audit:fix --city five-cities --state ca --escalate-paid --preview`
Expected (the smart-not-rules proof): Giuseppe's covid + Marisol packages → **skipped by the relevance gate** (route resolved to skip, $0 extraction); Mason (cocktails) + Zorro's (drinks image, a doc → paid) → extracted. Review `docs/five-cities-escalation-review-<date>.md`.

- [ ] **Step 3: (gated) Regression-check Oakland keeps its wins**

Get go-ahead, then run: `pnpm audit:fix --city oakland --state ca --escalate-paid --preview`
Expected: alaMar + Oeste still recover (Oeste's PDF route = paid; alaMar times). Compare against the cached `docs/audit-escalation/oakland-2026-06-09.json`. Confirm the ~62 soft-404 HTML pages that previously paid-and-found-nothing now resolve to `relevance-check → skip` (visible as a large RELEVANCE-GATED→skip count, near-$0).

- [ ] **Step 4: Record results in the spec's validation section / a short note**

Append a "Validation results (<date>)" note to `docs/superpowers/specs/2026-06-09-hh-relevance-classifier-design.md` with the actual Five Cities + Oakland numbers (billable before vs after, recoveries kept). Commit.

```bash
git add docs/superpowers/specs/2026-06-09-hh-relevance-classifier-design.md
git commit -m "docs(relevance): record live validation results (Five Cities + Oakland)"
```

---

## Self-Review

**Spec coverage:**
- New `lib/ai/hhRelevance.ts` Haiku classifier → Task 2. ✓
- Versioned prompt + prompt_hash → Task 1. ✓
- `MODELS.relevance` env-overridable → Task 1. ✓
- Chokepoint gate (hasSignal → free parse → doc fast-path → Haiku) → Task 3. ✓
- Docs always extract (cost reasoning) → Task 3 (chokepoint) + Task 4 (audit route). ✓
- Audit `relevance-check` route + shared classifier → Tasks 4–5. ✓
- `scoreHhUrl` kept for selection; `isDrinkOrHhPageUrl` deleted → Tasks 4 & 6. ✓
- Cost folded (no hidden spend) → `foldRelevanceCost` Tasks 2/3/5. ✓
- Fail-open → Task 2 (`classifyHhRelevance`/`parseRelevanceVerdict`). ✓
- Free pre-filter review + optional hardening → Task 7. ✓
- Hermetic tests + CI registration → Tasks 2,4,7,8. ✓
- Live validation (Five Cities/Oakland) → Task 9. ✓
- `--estimate` stays $0 → Task 5 Step 4. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. The only conditional is Task 7 Step 3 (hardening ships only if a fixture fails) — both branches are fully specified.

**Type consistency:** `HhRelevanceVerdict`, `classifyHhRelevance(input, opts)`, `foldRelevanceCost(base, rel)`, `buildRelevanceRequest(pages, venueName)`, `parseRelevanceVerdict(message)`, `EscalationRoute` (now 4 values), `routeEscalation(pages, freeResult)` (2 args) are used identically across Tasks 2–6. `FetchedPage` fields (`text`/`pdfBase64`/`imageBase64`/`url`) match `lib/ai/siteContent.ts`. `ExtractResult` has `usage`+`costCents` (confirmed) so `foldRelevanceCost` applies.
