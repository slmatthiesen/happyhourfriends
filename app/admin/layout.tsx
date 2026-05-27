import { cookies } from "next/headers";
import { isFirebaseConfigured, verifyAdmin } from "@/lib/firebase/admin";

/**
 * Auth gate for all /admin routes. Reads the Firebase session token from a cookie
 * and requires an allowlisted admin email. The interactive sign-in UI (Firebase
 * client SDK) lands with the Phase 2 admin queue; the gate + verification is wired
 * now so admin pages are never publicly reachable.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const token = (await cookies()).get("hhf_admin_token")?.value;
  const admin = token ? await verifyAdmin(token) : null;

  if (!admin) {
    return (
      <main className="mx-auto w-full max-w-md px-6 py-24 text-center">
        <h1
          className="text-3xl text-text-primary"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          Admin
        </h1>
        <p className="mt-4 text-text-muted">
          {isFirebaseConfigured()
            ? "Please sign in. (Sign-in UI ships with the Phase 2 admin queue.)"
            : "Admin auth is not configured. Set FIREBASE_* and ADMIN_EMAIL, then reload."}
        </p>
      </main>
    );
  }

  return <>{children}</>;
}
