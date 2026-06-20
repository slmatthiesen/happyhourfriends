import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";

// Internal-only endpoint that performs on-demand cache invalidation in a valid
// (Route Handler) context on behalf of the apply engine — which runs in both an admin
// Server Action and a pg-boss worker, the latter having no request context where the
// Next revalidate APIs are callable. See lib/cache/revalidate.ts for the caller.
export const runtime = "nodejs";

/** Shared-secret gate. In production a missing secret fails closed (mirrors the
 *  Turnstile posture); in dev we allow it so the flow works without configuration. */
function authorized(req: NextRequest): boolean {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return req.headers.get("x-revalidate-secret") === secret;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const paths = asStringArray((body as { paths?: unknown }).paths);
  const tags = asStringArray((body as { tags?: unknown }).tags);
  // `all: true` is the bulk-sync escape hatch. A direct-to-DB data push (push:data /
  // push:data:additive) bypasses the apply engine, so nothing fires per-route
  // invalidation and the public pages serve stale until their ISR window lapses. It
  // touches far too many routes to enumerate, so purge everything: revalidatePath('/',
  // 'layout') invalidates every route nested under the root layout, and we expire the
  // day-cached landing counts (`cities-summary`) by tag.
  const all = (body as { all?: unknown }).all === true;

  if (all) revalidatePath("/", "layout");
  for (const path of paths) revalidatePath(path);
  // `{ expire: 0 }` is the documented form for route handlers driven by external/
  // background systems (immediate expiry → next visit recomputes). Our tagged data is
  // an `unstable_cache` entry, not a `use cache` function, so this just expires it.
  if (all) revalidateTag("cities-summary", { expire: 0 });
  for (const tag of tags) revalidateTag(tag, { expire: 0 });

  return NextResponse.json({ revalidated: { all, paths, tags } });
}
