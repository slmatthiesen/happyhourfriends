import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  inet,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { timestamps } from "./columns";
import {
  aiRiskLevel,
  aiVerdict,
  editTargetType,
  flagResolution,
  flagTargetType,
  flagType,
  submissionStatus,
  verificationSource,
  voteValue,
} from "./enums";

/**
 * edit_submissions — every anonymous correction/addition. AI pipeline writes risk,
 * verdict, and evidence back onto the row; status tracks it through the flow.
 */
export const editSubmissions = pgTable(
  "edit_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    targetType: editTargetType("target_type").notNull(),
    targetId: uuid("target_id"), // nullable for new_venue
    diffJsonb: jsonb("diff_jsonb").notNull(), // { before, after }
    submitterFingerprint: text("submitter_fingerprint"),
    submitterIp: inet("submitter_ip"),
    submitterEmail: text("submitter_email"),
    aiRiskScore: smallint("ai_risk_score"), // 0–100, Stage 1
    aiRiskLevel: aiRiskLevel("ai_risk_level"),
    aiVerdict: aiVerdict("ai_verdict"),
    aiClassifierReasoning: text("ai_classifier_reasoning"),
    aiEvidenceJsonb: jsonb("ai_evidence_jsonb"), // Stage 2 output
    status: submissionStatus("status").notNull().default("pending"),
    appliedBy: text("applied_by"), // 'ai' | 'admin' | fingerprint
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("edit_submissions_status_idx").on(t.status),
    index("edit_submissions_target_idx").on(t.targetType, t.targetId),
    index("edit_submissions_fingerprint_idx").on(t.submitterFingerprint),
  ],
);

export const verificationAttempts = pgTable("verification_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  submissionId: uuid("submission_id")
    .notNull()
    .references(() => editSubmissions.id),
  source: verificationSource("source").notNull(),
  url: text("url"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }),
  aiSummary: text("ai_summary"),
  supportsChange: boolean("supports_change"), // nullable
  confidence: numeric("confidence", { precision: 3, scale: 2 }),
  ...timestamps,
});

/**
 * community_flags — one row per vote. Resolution thresholds live in code
 * (lib/trust/flagThresholds.ts), not the DB.
 */
export const communityFlags = pgTable(
  "community_flags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    targetType: flagTargetType("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    flagType: flagType("flag_type").notNull(),
    voteValue: voteValue("vote_value").notNull(),
    submitterFingerprint: text("submitter_fingerprint"),
    submitterIp: inet("submitter_ip"),
    reason: text("reason"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolution: flagResolution("resolution"),
    ...timestamps,
  },
  (t) => [index("community_flags_target_idx").on(t.targetType, t.targetId)],
);

export const submitterTrust = pgTable("submitter_trust", {
  fingerprint: text("fingerprint").primaryKey(),
  ipHashes: text("ip_hashes").array(),
  submissionCount: integer("submission_count").notNull().default(0),
  accuracyCount: integer("accuracy_count").notNull().default(0),
  inaccuracyCount: integer("inaccuracy_count").notNull().default(0),
  trustScore: integer("trust_score").notNull().default(0), // -100..100
  firstSeen: timestamp("first_seen", { withTimezone: true }).notNull().defaultNow(),
  lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
  banned: boolean("banned").notNull().default(false),
  ...timestamps,
});
