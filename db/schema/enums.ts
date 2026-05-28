import { pgEnum } from "drizzle-orm/pg-core";

// ── Cities (multi-city onboarding) ──────────────────────────────────────────
export const cityStatus = pgEnum("city_status", [
  "discovery",
  "enriching",
  "live",
  "paused",
]);

// ── Venues ──────────────────────────────────────────────────────────────────
export const venueType = pgEnum("venue_type", [
  "restaurant",
  "bar",
  "sports_bar",
  "pub",
  "dive_bar",
  "wine_bar",
  "brewery",
  "tasting_room",
  "cocktail_lounge",
  "gastropub",
  "club",
  "cafe",
  "hotel_bar",
  "pizzeria",
  "other",
]);

export const venueStatus = pgEnum("venue_status", [
  "active",
  "closed",
  "paused",
  "no_happy_hour",
]);

export const promotionTier = pgEnum("promotion_tier", [
  "none",
  "highlight",
  "pin",
  "banner",
]);

// stub | partial | complete | verified. `verified` is stored (set by verification
// jobs alongside last_verified_at) and downgraded to `complete` once it ages past
// 60 days. See PRD §3.1 + handoff decision.
export const dataCompleteness = pgEnum("data_completeness", [
  "stub",
  "partial",
  "complete",
  "verified",
]);

// ── Happy hours / offerings ──────────────────────────────────────────────────
export const locationWithinVenue = pgEnum("location_within_venue", [
  "bar",
  "patio",
  "dining",
  "all",
]);

export const hhExceptionType = pgEnum("hh_exception_type", ["closed", "modified"]);

export const offeringKind = pgEnum("offering_kind", ["food", "drink", "other"]);

export const offeringCategory = pgEnum("offering_category", [
  "beer",
  "wine",
  "cocktail",
  "spirit",
  "appetizer",
  "entree",
  "dessert",
  "other",
]);

// ── Tags ──────────────────────────────────────────────────────────────────────
export const tagCategory = pgEnum("tag_category", [
  "vibe",
  "amenity",
  "cuisine",
  "other",
]);

// ── Edit submissions / AI pipeline ───────────────────────────────────────────
// `intent` is the free-text "report a change" parent (a user describes a change in
// prose; the interpret stage fans it out into concrete child submissions).
// `new_offering` is server-created only — the interpreter proposes a brand-new
// offering attached to an existing happy hour (e.g. "they added $5 wings").
export const editTargetType = pgEnum("edit_target_type", [
  "venue",
  "happy_hour",
  "offering",
  "new_venue",
  "intent",
  "new_offering",
]);

export const aiRiskLevel = pgEnum("ai_risk_level", [
  "low",
  "medium",
  "high",
  "critical",
]);

export const aiVerdict = pgEnum("ai_verdict", [
  "auto_apply",
  "verify",
  "queue_outreach",
  "queue_admin",
  "reject",
]);

export const submissionStatus = pgEnum("submission_status", [
  "pending",
  "classifying",
  "verifying",
  "auto_applied",
  "queued_outreach",
  "queued_admin",
  "applied",
  "rejected",
  "reverted",
  "budget_exhausted",
  // Free-text "report a change" parent lifecycle: interpreting → interpreted once
  // it has fanned out into child submissions (the children carry the actionable work).
  "interpreting",
  "interpreted",
]);

export const verificationSource = pgEnum("verification_source", [
  "website",
  "facebook",
  "instagram",
  "google",
  "yelp",
  "other",
]);

export const aiStage = pgEnum("ai_stage", [
  "classify",
  "verify",
  "reverify_cron",
  "seed",
  "interpret",
]);

// ── Community flags ───────────────────────────────────────────────────────────
export const flagTargetType = pgEnum("flag_target_type", ["venue", "happy_hour"]);

export const flagType = pgEnum("flag_type", [
  "discontinued",
  "price_increase",
  "hours_changed",
  "closed",
  "other",
]);

export const voteValue = pgEnum("vote_value", ["confirm", "deny"]);

export const flagResolution = pgEnum("flag_resolution", [
  "confirmed",
  "rejected",
  "expired",
]);

// ── Seed pipeline ─────────────────────────────────────────────────────────────
export const seedOutcome = pgEnum("seed_outcome", [
  "confirmed_hh",
  "no_hh_found",
  "no_hh_explicit",
  "error",
]);
