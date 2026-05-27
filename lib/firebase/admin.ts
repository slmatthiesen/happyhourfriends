import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

let app: App | undefined;

export function isFirebaseConfigured(): boolean {
  return Boolean(
    process.env.FIREBASE_PROJECT_ID &&
      process.env.FIREBASE_CLIENT_EMAIL &&
      process.env.FIREBASE_PRIVATE_KEY,
  );
}

function getAdminApp(): App {
  if (app) return app;
  if (!isFirebaseConfigured()) {
    throw new Error("Firebase admin is not configured (FIREBASE_* env missing)");
  }
  app =
    getApps()[0] ??
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        // Env stores the key with literal \n; restore real newlines.
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      }),
    });
  return app;
}

function adminEmails(): string[] {
  return (process.env.ADMIN_EMAIL ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export interface AdminUser {
  uid: string;
  email: string;
}

/**
 * Verify a Firebase ID token and require the email be on the admin allowlist.
 * Returns null when unconfigured, token invalid, or email not allowlisted.
 */
export async function verifyAdmin(idToken: string): Promise<AdminUser | null> {
  if (!isFirebaseConfigured()) return null;
  try {
    const decoded = await getAuth(getAdminApp()).verifyIdToken(idToken);
    const email = (decoded.email ?? "").toLowerCase();
    if (!email || !adminEmails().includes(email)) return null;
    return { uid: decoded.uid, email };
  } catch {
    return null;
  }
}
