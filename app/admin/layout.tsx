import Link from "next/link";
import { AdminSignIn } from "@/components/admin/sign-in";
import { SignOutButton } from "@/components/admin/sign-out";
import { getAdmin } from "@/lib/admin/auth";

/**
 * Auth gate for all /admin routes. Resolves the Firebase session cookie to an
 * allowlisted admin; renders the sign-in screen otherwise. Mutating actions
 * re-check auth via requireAdmin (the layout does not protect server actions).
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await getAdmin();

  if (!admin) {
    return (
      <main className="mx-auto w-full max-w-md px-6 py-24 text-center">
        <h1
          className="text-3xl text-text-primary"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          Admin
        </h1>
        <p className="mt-4 text-text-muted">Sign in to manage submissions.</p>
        <AdminSignIn />
      </main>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      <header className="flex items-center justify-between border-b border-border pb-4">
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/admin" className="text-text-primary hover:text-accent-cool">
            Queue
          </Link>
          <Link
            href="/admin/audit"
            className="text-text-primary hover:text-accent-cool"
          >
            Audit log
          </Link>
          <Link
            href="/admin/budget"
            className="text-text-primary hover:text-accent-cool"
          >
            Budget
          </Link>
          <Link
            href="/admin/promotions"
            className="text-text-primary hover:text-accent-cool"
          >
            Promotions
          </Link>
          <Link
            href="/admin/stubs"
            className="text-text-primary hover:text-accent-cool"
          >
            Stubs
          </Link>
          <Link
            href="/admin/flags"
            className="text-text-primary hover:text-accent-cool"
          >
            Flags
          </Link>
        </nav>
        <div className="flex items-center gap-3 text-sm text-text-muted">
          <span>{admin.email}</span>
          <SignOutButton />
        </div>
      </header>
      {children}
    </div>
  );
}
