import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { editSubmissions } from "@/db/schema";
import { verifyCaptcha } from "@/lib/captcha/hcaptcha";
import { enqueueClassify, enqueueInterpret } from "@/lib/jobs/queue";
import {
  SUBMISSION_TARGET_TYPES,
  type SubmissionPayload,
} from "@/lib/submit/payload";
import { saveEvidenceFile } from "@/lib/submit/evidenceStore";
import { checkSubmissionRateLimit } from "@/lib/trust/rateLimits";
import { ensureSubmitter, hashIp } from "@/lib/trust/submitter";
import { moderateImage } from "@/lib/moderation/safeSearch";

// Writes uploaded evidence photos to disk (lib/submit/evidenceStore) → needs Node.
export const runtime = "nodejs";

// Hard cap on the request body. An evidence image is capped at 6 MB of decoded bytes
// (lib/submit/payload), ~8 MB once base64-encoded into JSON, plus the diff envelope.
// 10 MB leaves headroom while rejecting payloads that would never be valid.
const MAX_BODY_BYTES = 10 * 1024 * 1024;

/**
 * POST /api/submissions — the anonymous correction/addition endpoint (PRD §6.4).
 * Honeypot + hCaptcha + coarse rate limit guard it; valid submissions land in
 * edit_submissions with status `pending` for the Phase 3 classifier (or, until then,
 * the admin queue). No data is applied here.
 */
export async function POST(req: Request) {
  // Reject oversized bodies before reading them into memory. Content-Length can be
  // spoofed/absent, so we also bound the actual bytes read below.
  const declaredLen = Number(req.headers.get("content-length") ?? 0);
  if (declaredLen > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  let body: SubmissionPayload;
  try {
    const raw = await req.arrayBuffer();
    if (raw.byteLength > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    }
    body = JSON.parse(Buffer.from(raw).toString("utf8")) as SubmissionPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Honeypot: a filled hidden field means a bot. Pretend success, store nothing.
  if (body.website && body.website.trim() !== "") {
    return NextResponse.json({ ok: true, status: "pending" }, { status: 202 });
  }

  // Shape validation.
  if (!SUBMISSION_TARGET_TYPES.includes(body.targetType)) {
    return NextResponse.json({ error: "Unknown target type" }, { status: 400 });
  }
  if (body.targetType !== "new_venue" && !body.targetId) {
    return NextResponse.json(
      { error: "target_id is required for this change" },
      { status: 400 },
    );
  }
  const after = body.diff?.after;
  if (!after || typeof after !== "object") {
    return NextResponse.json(
      { error: "Invalid change payload" },
      { status: 400 },
    );
  }
  // `new_happy_hour` may arrive with an empty `after` — the visitor might just
  // attach a menu photo and let the operator fill in the details. Every other
  // submission type needs at least one proposed value.
  if (body.targetType !== "new_happy_hour" && Object.keys(after).length === 0) {
    return NextResponse.json(
      { error: "Nothing to change — no proposed values" },
      { status: 400 },
    );
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

  // Rate limit (full PRD §5.1 matrix). A venue status change to closed/no_happy_hour
  // is a critical change and gets the tighter critical-per-day cap.
  const isCritical =
    body.targetType === "venue" &&
    typeof after.status === "string" &&
    (after.status === "closed" || after.status === "no_happy_hour");
  const limit = await checkSubmissionRateLimit({
    fingerprint,
    ipHash: ip ?? undefined,
    email: body.email?.trim() || undefined,
    critical: isCritical,
  });
  if (!limit.allowed) {
    return NextResponse.json({ error: limit.reason }, { status: 429 });
  }

  // Reject inappropriate images at upload — before storing anything.
  if (body.evidenceImage && body.evidenceImage.startsWith("data:image/")) {
    const comma = body.evidenceImage.indexOf(",");
    const base64 = comma >= 0 ? body.evidenceImage.slice(comma + 1) : "";
    const mimeMatch = /^data:(image\/[a-z+.-]+);base64,/i.exec(body.evidenceImage);
    const mime = mimeMatch?.[1] ?? "image/jpeg";
    if (base64) {
      const verdict = await moderateImage(base64, mime);
      if (!verdict.allowed) {
        return NextResponse.json(
          { error: verdict.reason ?? "That image can't be accepted." },
          { status: 400 },
        );
      }
    }
  }

  // Persist an uploaded menu photo or PDF, if any. The stored file's URL doubles as
  // the change's source when no link was supplied (operator decision: a photo/PDF OR
  // a URL satisfies the evidence requirement).
  const storedEvidence = await saveEvidenceFile(body.evidenceImage);
  const providedUrl = body.diff.sourceUrl?.trim() || null;
  const effectiveSourceUrl = providedUrl ?? storedEvidence?.url ?? null;

  // Every user-driven contribution must be backed by evidence — satisfied by EITHER a
  // source URL or an uploaded photo/PDF. That covers the free-text "report a change"
  // box (`intent`), explicit happy-hour / offering edits, and the "add the first happy
  // hour" path. If we're being told something we don't already have, there must be a
  // source to verify it against (operator decision 2026-06-07). The only path exempt is
  // `new_venue`, which gates evidence on its own HH/offering fields.
  const needsEvidence =
    body.targetType === "intent" ||
    body.targetType === "happy_hour" ||
    body.targetType === "offering" ||
    body.targetType === "new_happy_hour";
  if (needsEvidence && !effectiveSourceUrl) {
    return NextResponse.json(
      { error: "Add a link or a photo of the menu — we need a source to verify this update." },
      { status: 400 },
    );
  }

  // Record the submitter (banned submitters are still stored but never applied).
  await ensureSubmitter(fingerprint, ip ? hashIp(ip) : undefined);

  // "Add the first happy hour" submissions go straight to the admin queue: the visitor
  // is the source of truth (no prior data to verify against, and they may have only
  // attached a photo), so no AI classify/verify spend is warranted. The engine will
  // apply when the operator approves.
  const initialStatus =
    body.targetType === "new_happy_hour" ? "queued_admin" : "pending";

  const [row] = await db
    .insert(editSubmissions)
    .values({
      targetType: body.targetType,
      targetId: body.targetType === "new_venue" ? null : body.targetId,
      diffJsonb: {
        before: body.diff.before ?? null,
        after: body.targetType === "new_happy_hour"
          // Stamp the venue id onto the after blob so the engine has it without a
          // separate lookup (mirrors how new_offering carries happyHourId).
          ? { ...after, venueId: body.targetId }
          : after,
        sourceUrl: effectiveSourceUrl,
        summary: body.diff.summary ?? undefined,
      },
      aiEvidenceJsonb: storedEvidence
        ? { submittedFile: { url: storedEvidence.url, mime: storedEvidence.mime } }
        : undefined,
      submitterFingerprint: fingerprint,
      submitterIp: ip,
      submitterEmail: body.email?.trim() || null,
      status: initialStatus,
    })
    .returning({ id: editSubmissions.id, status: editSubmissions.status });

  // Kick off the pipeline. A free-text `intent` goes to the interpret stage (which
  // fans it out into concrete child submissions); everything else starts at classify.
  // `new_happy_hour` skips the pipeline — it's already in the queue.
  // Non-fatal: the submission is already stored and visible in the admin queue even if
  // the queue is unavailable.
  if (body.targetType !== "new_happy_hour") {
    try {
      if (body.targetType === "intent") await enqueueInterpret(row.id);
      else await enqueueClassify(row.id);
    } catch (e) {
      console.error("Failed to enqueue pipeline job", e);
    }
  }

  return NextResponse.json(
    { ok: true, id: row.id, status: row.status, statusUrl: `/submit/status/${row.id}` },
    { status: 201 },
  );
}
