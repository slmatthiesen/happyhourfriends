"use client";

import { useState, useTransition } from "react";
import { revertAction } from "@/app/admin/actions";

export function RevertButton({ auditId }: { auditId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (done)
    return (
      <span className="inline-flex items-center gap-2 text-xs text-text-muted">
        reverted
        {warning && <span className="text-accent-warm">⚠ {warning}</span>}
      </span>
    );

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            setWarning(null);
            const res = await revertAction(auditId);
            if (res.ok) {
              if (res.warning) setWarning(res.warning);
              setDone(true);
            } else setError(res.error ?? "Revert failed");
          })
        }
        className="rounded-md border border-border px-2.5 py-1 text-xs text-accent-hot hover:bg-row-hover disabled:opacity-50"
      >
        {pending ? "Reverting…" : "Revert"}
      </button>
      {error && <span className="text-xs text-accent-hot">{error}</span>}
    </span>
  );
}
