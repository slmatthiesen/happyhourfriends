import { cookies } from "next/headers";
import { verifyAdminSessionCookie, type AdminUser } from "@/lib/firebase/admin";

/** Name of the httpOnly session cookie set on admin sign-in. */
export const ADMIN_COOKIE = "hhf_admin_token";

/** Resolve the current admin from the session cookie, or null. */
export async function getAdmin(): Promise<AdminUser | null> {
  // Dev-only local admin: never in production, only when DEV_ADMIN_EMAIL is set.
  if (process.env.NODE_ENV !== "production" && process.env.DEV_ADMIN_EMAIL) {
    return { uid: "dev-local", email: process.env.DEV_ADMIN_EMAIL.toLowerCase() };
  }
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  return token ? verifyAdminSessionCookie(token) : null;
}

/**
 * Use inside server actions and route handlers — the layout gate does NOT protect
 * those, so every mutating admin entry point must re-check auth itself.
 */
export async function requireAdmin(): Promise<AdminUser> {
  const admin = await getAdmin();
  if (!admin) throw new Error("Not authorized");
  return admin;
}
