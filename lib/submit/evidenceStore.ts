/**
 * Server-side storage for uploaded evidence — a photo OR a PDF of the menu/sign that
 * stands in for a source URL (operator decision 2026-05). A change must carry one of
 * {source URL, photo, PDF}; the stored file's public path becomes the change's
 * source_url, so the audit trail and the AI verifier both have something to point at.
 * PDFs matter because they're the most common menu format restaurants publish.
 *
 * MVP storage: the local filesystem under `public/uploads/evidence`, served by Next
 * at `/uploads/evidence/<file>`. On a single droplet with a persistent disk this is
 * fine; for multi-node / object storage, point EVIDENCE_UPLOAD_DIR at a mounted
 * volume or swap this module for DO Spaces (the rest of the app only sees the URL).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { MAX_EVIDENCE_IMAGE_BYTES } from "./payload";
import type { EvidenceMedia } from "@/lib/ai/verifier";

/** Image media types Claude's vision API can read. */
export type VisionMime = "image/jpeg" | "image/png" | "image/gif" | "image/webp";
const VISION_MIME = new Set<string>(["image/jpeg", "image/png", "image/gif", "image/webp"]);

// %PDF — the required leading magic bytes for any real PDF. We never trust the
// declared data-url MIME; the bytes have to back it up.
const PDF_MAGIC = Buffer.from("%PDF-", "latin1");

export interface StoredEvidence {
  /** Public URL, e.g. /uploads/evidence/ab12.jpg — used as the change's source_url. */
  url: string;
  mime: string;
  bytes: number;
}

const PUBLIC_BASE = process.env.EVIDENCE_PUBLIC_BASE ?? "/uploads/evidence";

// Resolved lazily (not at module load) so Next's file tracer doesn't treat a
// build-time process.cwd() as a reason to bundle the whole project.
function uploadDir(): string {
  return (
    process.env.EVIDENCE_UPLOAD_DIR ??
    join(/* turbopackIgnore: true */ process.cwd(), "public", "uploads", "evidence")
  );
}

/**
 * Decode a `data:<mime>;base64,...` URL (image or PDF), validate the *actual bytes*
 * (not the declared MIME), strip any embedded payload, and persist it. Returns null
 * for anything that isn't a real image/PDF within the size cap; throws only on a real
 * write failure.
 *
 * Security model — we never trust user-supplied content served from our own origin:
 *   • Images are fully re-encoded through sharp. This proves the bytes decode as an
 *     image (a disguised HTML/script "image" throws), normalizes the format to a
 *     model-readable one (JPEG/PNG), and DROPS all metadata — EXIF GPS, maker notes,
 *     any appended polyglot payload. `.rotate()` bakes in EXIF orientation first so
 *     the visible image isn't flipped after the metadata is gone.
 *   • PDFs are validated by magic bytes (we can't safely re-encode them); they're
 *     stored as-is and MUST be served with nosniff + a sandbox CSP + attachment
 *     disposition (see next.config.ts) so an embedded /JS action can't run in-origin.
 * The stored MIME/ext come from what we actually wrote, not from the client.
 */
export async function saveEvidenceFile(
  dataUrl: string | null | undefined,
): Promise<StoredEvidence | null> {
  if (!dataUrl || typeof dataUrl !== "string") return null;
  const match =
    /^data:(image\/[a-z0-9.+-]+|application\/pdf);base64,([A-Za-z0-9+/=]+)$/i.exec(
      dataUrl.trim(),
    );
  if (!match) return null;

  const declaredMime = match[1].toLowerCase();
  const raw = Buffer.from(match[2], "base64");
  if (raw.byteLength === 0 || raw.byteLength > MAX_EVIDENCE_IMAGE_BYTES) return null;

  let out: { buf: Buffer; mime: string; ext: string };

  if (declaredMime === "application/pdf") {
    // Magic-byte check — the bytes must actually be a PDF, not just claim to be.
    if (!raw.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) return null;
    out = { buf: raw, mime: "application/pdf", ext: "pdf" };
  } else {
    // Re-encode the image. sharp throws on non-image bytes; default limitInputPixels
    // guards against decompression bombs. Metadata is dropped (no .withMetadata()).
    let clean: { data: Buffer; format: string };
    try {
      const pipeline = sharp(raw, { failOn: "error" }).rotate();
      const meta = await pipeline.metadata();
      clean =
        meta.format === "png"
          ? { data: await pipeline.png().toBuffer(), format: "png" }
          : { data: await pipeline.jpeg({ quality: 82, mozjpeg: true }).toBuffer(), format: "jpeg" };
    } catch {
      return null; // not a decodable image
    }
    out =
      clean.format === "png"
        ? { buf: clean.data, mime: "image/png", ext: "png" }
        : { buf: clean.data, mime: "image/jpeg", ext: "jpg" };
    // A re-encode shouldn't exceed the cap, but guard anyway.
    if (out.buf.byteLength > MAX_EVIDENCE_IMAGE_BYTES) return null;
  }

  const name = `${randomUUID()}.${out.ext}`;
  const dir = uploadDir();
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name), out.buf);

  return { url: `${PUBLIC_BASE}/${name}`, mime: out.mime, bytes: out.buf.byteLength };
}

/**
 * Load a previously stored evidence file as base64 for the model — an image block for
 * photos, a document block for PDFs. Returns null for unsupported types or a missing
 * file (the change still has the file URL as its source — we just skip the read).
 */
export async function readEvidenceForModel(
  url: string,
  mime: string,
): Promise<EvidenceMedia | null> {
  const isPdf = mime === "application/pdf";
  if (!isPdf && !VISION_MIME.has(mime)) return null;
  const name = url.split("/").pop();
  if (!name) return null;
  try {
    const buf = await readFile(join(uploadDir(), name));
    const base64 = buf.toString("base64");
    return isPdf
      ? { kind: "document", base64 }
      : { kind: "image", base64, mediaType: mime as VisionMime };
  } catch {
    return null;
  }
}
