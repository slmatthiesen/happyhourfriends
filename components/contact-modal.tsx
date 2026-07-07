"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const CONTACT_EMAIL = "hello@happyhourfriends.com";

export function ContactModal({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn("hover:text-text-primary", className)}
      >
        Contact
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-6"
          role="dialog"
          aria-modal="true"
          aria-label="Contact us"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-lg border border-border bg-bg-surface p-6 text-center shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              className="text-xl font-semibold text-text-primary"
              style={{ fontFamily: "var(--font-serif)" }}
            >
              Get in touch
            </h2>
            <p className="mt-2 text-sm text-text-muted">
              Questions, a dead link, a happy hour we're missing — just email:
            </p>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="mt-3 inline-block text-accent-cool hover:underline"
            >
              {CONTACT_EMAIL}
            </a>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="mt-6 block w-full rounded-md border border-border px-4 py-2 text-sm text-text-muted transition-colors hover:bg-row-hover"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
