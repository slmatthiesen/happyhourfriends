"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  isFirebaseClientConfigured,
  signInWithGoogleIdToken,
} from "@/lib/firebase/client";

/** Admin Google sign-in button. Exchanges an ID token for a session cookie via
 *  /api/admin/session, then refreshes so the gated layout re-evaluates. */
export function AdminSignIn() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isFirebaseClientConfigured()) {
    return (
      <p className="mt-4 text-text-muted">
        Admin auth is not configured. Set the FIREBASE_* / NEXT_PUBLIC_FIREBASE_*
        env vars and ADMIN_EMAIL, then reload.
      </p>
    );
  }

  async function onSignIn() {
    setBusy(true);
    setError(null);
    try {
      const idToken = await signInWithGoogleIdToken();
      const res = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Sign-in failed.");
        setBusy(false);
        return;
      }
      router.replace("/admin");
      router.refresh();
    } catch {
      setError("Sign-in was cancelled or failed.");
      setBusy(false);
    }
  }

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={onSignIn}
        disabled={busy}
        className="rounded-md bg-accent-warm px-5 py-2.5 font-medium text-bg-deep transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "Signing in…" : "Sign in with Google"}
      </button>
      {error && <p className="mt-3 text-sm text-accent-hot">{error}</p>}
    </div>
  );
}
