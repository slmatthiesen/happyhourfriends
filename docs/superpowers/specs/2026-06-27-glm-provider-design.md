# GLM provider — free Haiku-tier model for cheap iteration

**Date:** 2026-06-27
**Branch:** `feat/glm-provider`
**Status:** approved (brainstorm), implementing

## Goal

Add GLM (Zhipu, via z.ai's Anthropic-compatible endpoint) as a selectable model
provider so Haiku-tier AI stages — starting with the **extractor text path** — can run
on a **free** model. Primary value is removing the cost constraint on iteration: the
paid `eval:extractor` harness (~3–5¢/venue/run) and prompt tuning can run unlimited times
at $0. Secondary value: a possible ongoing production cost cut on extraction if GLM holds
recall.

Non-goal: replacing Anthropic for vision. GLM-4.5-Flash is text-tier; the extractor's
PDF/image/screenshot path stays on Anthropic (a GLM vision model is a separate future lever).

## Key facts (verified)

- z.ai Anthropic-compatible endpoint: `https://api.z.ai/api/anthropic`, auth via `GLM_API_KEY`.
  The Anthropic SDK works with just `baseURL` + `apiKey` swapped — existing `tools` /
  `tool_choice` / `ContentBlockParam` message shapes carry over unchanged.
- **Forced `tool_choice` works** (probed `scripts/probe-glm.ts`): both `glm-4.5-flash` and
  `glm-4.5-air` return a valid `record_happy_hours` tool_use block. `glm-4.5-air` normalized
  times to 24h ("16:00"); `glm-4.5-flash` returned "4:00 PM" on the simplified probe schema
  (the real schema's explicit 24h instruction should improve this — eval will confirm).
- GLM-4.5-Flash is text-only. Image/PDF content blocks must be stripped before a GLM-text call.

## Design

Model-id-prefixed client routing — minimal, keeps Anthropic SDK shapes everywhere.

1. **`lib/ai/anthropic.ts`** — add `clientForModel(model: string): Anthropic`. Returns a
   cached GLM client (`new Anthropic({ apiKey: GLM_API_KEY, baseURL: GLM_BASE_URL })`) when
   the model id starts with `glm`, else the default Anthropic client. `GLM_BASE_URL` env-
   overridable, defaults to `https://api.z.ai/api/anthropic`.
2. **`lib/ai/pricing.ts`** — add `{ match: "glm", inputPerM: 0, outputPerM: 0 }` (top of list)
   so GLM calls cost $0 in the ledger.
3. **`lib/ai/extractHappyHours.ts`** — route the extractor's `messages.create` through
   `clientForModel`. **Vision fallback (recall-safe):** a text-only GLM model reads pure-text
   venues for free, but whenever the fetched pages include an image/PDF the whole extraction is
   sent to the Anthropic vision model (`MODELS.visionFallback`, default Haiku) with the doc
   intact — never dropped.

   > **Rejected variant — GLM text-first escalation.** We tried reading page text with GLM first
   > and only escalating to the vision model when the text pass found no priced window. The eval
   > caught a regression: **windows 79% / deals 62%** (vs 100% / 96%). A partial text answer
   > ("resolved deals") pre-empted the menu-doc read on venues whose real deals lived in the
   > PDF/image (District Oakland, Milestone Tavern). Conclusion: **when a doc is present you must
   > read it** — GLM can't know the doc is redundant. Reverted; vision spend on doc venues is
   > unavoidable in a recall-first pipeline. GLM's production savings are therefore limited to
   > pure-text venues; the larger win is the free eval/iteration loop.
4. Model selection is already env-overridable via `ANTHROPIC_MODEL_EXTRACTOR`
   (`lib/ai/models.ts`). Setting it to `glm-4.5-flash` + routing = GLM extractor. No new wiring.

Other Haiku-tier stages (classifier, relevance, interpreter) become GLM-selectable for free
by switching their call sites to `clientForModel(model)` — same one-line change. Done
opportunistically "wherever it might save money" after the extractor result is in.

## Verification

- Unit: `clientForModel` returns GLM client for `glm-*`, default otherwise (no network).
- Probe (done): forced tool use returns parseable structured output on GLM.
- Eval (the real signal): `eval:extractor --runs 3` with `ANTHROPIC_MODEL_EXTRACTOR=glm-4.5-flash`
  (free) and `=glm-4.5-air` (free), vs the Haiku baseline (paid — quote before running).
  Compare mean window + offering recall and variance. Expect GLM≈0 on pure PDF/IMAGE goldens
  (text model can't read them) — judge on the text-extractable goldens.

## Decision rule

- GLM recall ≈ Haiku on text path → adopt GLM as the free iteration/dev model; consider
  production for text extraction.
- GLM recall notably worse → keep as a free draft model (iterate prompts on GLM, validate
  finals on Haiku). Either outcome delivers the free iteration loop.
