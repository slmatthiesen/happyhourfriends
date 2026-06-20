import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { venueSignals } from "@/db/schema";
import { hitSignalLimit } from "@/lib/trust/signalRateLimit";
import { parseSignalBody } from "@/lib/trust/signalRequest";

function clientIp(req: Request): string | null {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    null
  );
}

async function countSignals(venueId: string, kind: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(venueSignals)
    .where(and(eq(venueSignals.venueId, venueId), eq(venueSignals.kind, kind)));
  return Number(r?.n ?? 0);
}

/**
 * POST = add a signal, DELETE = remove it. Both return the authoritative
 * { ok, count, tapped } so the client self-heals against localStorage/DB drift.
 * Anti-abuse: honeypot + in-memory sliding-window rate limit (fingerprint + IP).
 * No Turnstile — too heavy for a one-tap gesture, and the count can't be inflated
 * (per-fingerprint toggle, one row max).
 */
async function handle(req: Request, op: "add" | "remove") {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = parseSignalBody(raw);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { venueId, kind, fingerprint, website } = parsed.body;

  // Honeypot: filled → pretend success, store nothing.
  if (website && website.trim() !== "") {
    return NextResponse.json(
      { ok: true, count: await countSignals(venueId, kind), tapped: op === "add" },
      { status: 202 },
    );
  }

  const ip = clientIp(req);
  const limited =
    hitSignalLimit(`fp:${fingerprint}`) || (ip ? hitSignalLimit(`ip:${ip}`) : false);
  if (limited) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  if (op === "add") {
    await db
      .insert(venueSignals)
      .values({ venueId, kind, submitterFingerprint: fingerprint, submitterIp: ip })
      .onConflictDoNothing();
  } else {
    await db
      .delete(venueSignals)
      .where(
        and(
          eq(venueSignals.venueId, venueId),
          eq(venueSignals.kind, kind),
          eq(venueSignals.submitterFingerprint, fingerprint),
        ),
      );
  }

  const count = await countSignals(venueId, kind);
  return NextResponse.json({ ok: true, count, tapped: op === "add" }, { status: 200 });
}

export const POST = (req: Request) => handle(req, "add");
export const DELETE = (req: Request) => handle(req, "remove");
