const ENDPOINT = "https://vision.googleapis.com/v1/images:annotate";
const BLOCK = new Set(["LIKELY", "VERY_LIKELY"]);

export interface SafeSearchAnnotation {
  adult?: string;
  violence?: string;
  racy?: string;
  medical?: string;
  spoof?: string;
}

/** Pure verdict: reject when adult/violence/racy is LIKELY+. Missing fields = safe. */
export function isSafe(a: SafeSearchAnnotation): boolean {
  return !(
    BLOCK.has(a.adult ?? "") ||
    BLOCK.has(a.violence ?? "") ||
    BLOCK.has(a.racy ?? "")
  );
}

export interface ModerationResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Run Google Cloud Vision SafeSearch on a base64 image. Fails CLOSED in production
 * (errors → rejected) so unmoderated content can't slip through; allows in dev when
 * the key is unset or the call errors.
 */
export async function moderateImage(base64: string, _mime: string): Promise<ModerationResult> {
  const key = process.env.GOOGLE_VISION_API_KEY;
  if (!key) {
    // No SafeSearch key configured → SKIP moderation rather than reject every upload.
    // A missing optional key must never silently swallow legitimate submissions: evidence
    // images only reach the admin queue, and the AI relevance gate + human review still
    // apply. Set GOOGLE_VISION_API_KEY to enable SafeSearch screening. (A key that IS
    // present but errors still fails closed in prod — see the catch below.)
    if (process.env.NODE_ENV === "production") {
      console.warn("GOOGLE_VISION_API_KEY unset — skipping SafeSearch; submission allowed.");
    }
    return { allowed: true };
  }
  try {
    const res = await fetch(`${ENDPOINT}?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [{ image: { content: base64 }, features: [{ type: "SAFE_SEARCH_DETECTION" }] }],
      }),
    });
    if (!res.ok) {
      return process.env.NODE_ENV === "production"
        ? { allowed: false, reason: "Image moderation failed." }
        : { allowed: true };
    }
    const json = (await res.json()) as {
      responses?: { safeSearchAnnotation?: SafeSearchAnnotation }[];
    };
    const annotation = json.responses?.[0]?.safeSearchAnnotation ?? {};
    return isSafe(annotation)
      ? { allowed: true }
      : { allowed: false, reason: "That image looks inappropriate. Please upload a photo of the menu." };
  } catch {
    return process.env.NODE_ENV === "production"
      ? { allowed: false, reason: "Image moderation failed." }
      : { allowed: true };
  }
}
