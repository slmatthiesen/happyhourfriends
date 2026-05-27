"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function SignOutButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await fetch("/api/admin/session", { method: "DELETE" });
          router.replace("/admin");
          router.refresh();
        })
      }
      className="rounded-md border border-border px-3 py-1 hover:bg-row-hover disabled:opacity-50"
    >
      Sign out
    </button>
  );
}
