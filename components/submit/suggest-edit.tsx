"use client";

import { useState } from "react";
import { SubmissionForm } from "./submission-form";

/**
 * A collapsible "Suggest an edit" trigger that reveals a SubmissionForm inline
 * (PRD §6.4). Used on venue pages for happy-hour and venue-level corrections.
 */
export function SuggestEdit({
  label = "Suggest an edit",
  ...formProps
}: React.ComponentProps<typeof SubmissionForm> & { label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-xs text-accent-cool hover:underline"
      >
        {open ? "Cancel" : label}
      </button>
      {open && (
        <div className="mt-3 rounded-lg border border-border bg-bg-surface p-4">
          <SubmissionForm {...formProps} />
        </div>
      )}
    </div>
  );
}
