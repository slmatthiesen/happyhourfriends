import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { communityFlags } from "@/db/schema";
import { verifyCaptcha } from "@/lib/captcha/turnstile";
import { checkBasicRateLimit, ensureSubmitter, hashIp } from "@/lib/trust/submitter";

const FLAG_TARGET_TYPES = ["venue", "happy_hour"] as const;
const FLAG_TYPES = [
  "discontinued",
  "price_increase",
  "hours_changed",
  "closed",
  "other",
] as const;
const VOTE_VALUES = ["confirm", "deny"] as const;

type FlagTargetType = (typeof FLAG_TARGET_TYPES)[number];
type FlagTypeValue = (typeof FLAG_TYPES)[number];
type VoteValueType = (typeof VOTE_VALUES)[number];

interface FlagBody {
  targetType: FlagTargetType;
  targetId: string;
  flagType: FlagTypeValue;
  voteValue: VoteValueType;
  fingerprint: string;
  reason?: string;
  captchaToken?: string;
  website?: string; // honeypot
}

/**
 * POST /api/flags — community flag / vote endpoint (PRD §5.2, §3.10).
 * Honeypot + Turnstile + coarse rate limit guard it; valid votes land in
 * community_flags (unresolved). Duplicate votes (same target+flagType+fingerprint,
 * unresolved) are detected and return 200 { ok:true, duplicate:true }.
 */
export async function POST(req: Request) {
  let body: FlagBody;
  try {
    body = (await req.json()) as FlagBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Honeypot: filled → pretend success, store nothing.
  if (body.website && body.website.trim() !== "") {
    return NextResponse.json({ ok: true }, { status: 202 });
  }

  // Shape validation.
  if (!FLAG_TARGET_TYPES.includes(body.targetType)) {
    return NextResponse.json({ error: "Unknown target type" }, { status: 400 });
  }
  if (!FLAG_TYPES.includes(body.flagType)) {
    return NextResponse.json({ error: "Unknown flag type" }, { status: 400 });
  }
  if (!VOTE_VALUES.includes(body.voteValue)) {
    return NextResponse.json({ error: "Unknown vote value" }, { status: 400 });
  }
  if (!body.targetId?.trim()) {
    return NextResponse.json({ error: "targetId is required" }, { status: 400 });
  }
  const fingerprint = (body.fingerprint ?? "").trim();
  if (!fingerprint) {
    return NextResponse.json({ error: "Missing fingerprint" }, { status: 400 });
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    null;

  // Captcha.
  if (!(await verifyCaptcha(body.captchaToken, ip))) {
    return NextResponse.json({ error: "Captcha verification failed" }, { status: 400 });
  }

  // Rate limit (coarse check).
  const limit = await checkBasicRateLimit({ fingerprint, ip });
  if (!limit.allowed) {
    return NextResponse.json({ error: limit.reason }, { status: 429 });
  }

  // Record the submitter.
  await ensureSubmitter(fingerprint, ip ? hashIp(ip) : undefined);

  // Prevent duplicate vote: same targetId + flagType + fingerprint, unresolved.
  const existing = await db
    .select({ id: communityFlags.id })
    .from(communityFlags)
    .where(
      and(
        eq(communityFlags.targetId, body.targetId),
        eq(communityFlags.flagType, body.flagType),
        eq(communityFlags.submitterFingerprint, fingerprint),
        isNull(communityFlags.resolvedAt),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    return NextResponse.json({ ok: true, duplicate: true }, { status: 200 });
  }

  await db.insert(communityFlags).values({
    targetType: body.targetType,
    targetId: body.targetId,
    flagType: body.flagType,
    voteValue: body.voteValue,
    submitterFingerprint: fingerprint,
    submitterIp: ip,
    reason: body.reason?.trim() || null,
  });

  return NextResponse.json({ ok: true }, { status: 201 });
}
