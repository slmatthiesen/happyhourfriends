import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE } from "@/lib/admin/auth";
import { createAdminSession } from "@/lib/firebase/admin";

const EXPIRES_IN_MS = 5 * 24 * 60 * 60 * 1000; // 5 days

/** POST { idToken } → set the admin session cookie (allowlist enforced). */
export async function POST(req: Request) {
  let idToken: string | undefined;
  try {
    ({ idToken } = (await req.json()) as { idToken?: string });
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!idToken) {
    return NextResponse.json({ error: "Missing idToken" }, { status: 400 });
  }

  const cookie = await createAdminSession(idToken, EXPIRES_IN_MS);
  if (!cookie) {
    return NextResponse.json(
      { error: "This account is not an authorized admin." },
      { status: 403 },
    );
  }

  (await cookies()).set(ADMIN_COOKIE, cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: EXPIRES_IN_MS / 1000,
    path: "/",
  });
  return NextResponse.json({ ok: true });
}

/** DELETE → sign out. */
export async function DELETE() {
  (await cookies()).delete(ADMIN_COOKIE);
  return NextResponse.json({ ok: true });
}
