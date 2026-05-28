/**
 * Email templates. Pure builders — they return { subject, html } and never send, so
 * they're trivial to unit-test and reuse. Sending is lib/email/client.ts.
 */

export type InterpretedVerdict = "confirmed" | "contradicted" | "unconfirmed";

export interface InterpretedChangeEmailArgs {
  venueName: string;
  /** The user's original free-text report. */
  note: string;
  /** One-line description of the concrete change the AI derived. */
  changeSummary: string;
  /** The structured proposal (before/after columns) for context. */
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  verdict: InterpretedVerdict;
  confidence: number; // 0..1
  /** Supporting evidence the verifier found (or the submitted photo URL). */
  evidenceUrl?: string | null;
  /** Absolute link to the admin queue. */
  adminUrl: string;
}

const VERDICT_COPY: Record<InterpretedVerdict, string> = {
  confirmed: "✅ AI recommends APPROVING (sources support the change)",
  contradicted: "⛔ AI recommends REJECTING (sources contradict the change)",
  unconfirmed: "❓ AI could not confirm — your call",
};

function esc(v: unknown): string {
  return String(v ?? "—")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function diffRows(
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
): string {
  return Object.keys(after)
    .map(
      (k) =>
        `<tr><td style="padding:4px 8px;color:#666">${esc(k)}</td>` +
        `<td style="padding:4px 8px;color:#999">${esc(before?.[k])}</td>` +
        `<td style="padding:4px 8px;color:#111"><b>${esc(after[k])}</b></td></tr>`,
    )
    .join("");
}

export function interpretedChangeEmail(args: InterpretedChangeEmailArgs): {
  subject: string;
  html: string;
} {
  const pct = Math.round(args.confidence * 100);
  const subject = `[HHF] ${args.venueName}: ${args.changeSummary}`;
  const html = `
  <div style="font-family:system-ui,sans-serif;max-width:560px">
    <h2 style="margin:0 0 4px">${esc(args.venueName)}</h2>
    <p style="margin:0 0 16px;color:#444">${esc(args.changeSummary)}</p>

    <p style="margin:0 0 8px;font-weight:600">${VERDICT_COPY[args.verdict]} · confidence ${pct}%</p>

    <p style="margin:16px 0 4px;color:#666;font-size:13px">What the visitor reported</p>
    <blockquote style="margin:0;padding:8px 12px;border-left:3px solid #ddd;color:#333">${esc(args.note)}</blockquote>

    <p style="margin:16px 0 4px;color:#666;font-size:13px">Proposed change</p>
    <table style="border-collapse:collapse;font-size:14px">
      <tr style="color:#999;font-size:12px"><th style="text-align:left;padding:4px 8px">Field</th><th style="text-align:left;padding:4px 8px">Current</th><th style="text-align:left;padding:4px 8px">Proposed</th></tr>
      ${diffRows(args.before, args.after)}
    </table>

    ${
      args.evidenceUrl
        ? `<p style="margin:16px 0 0"><a href="${esc(args.evidenceUrl)}">Evidence ↗</a></p>`
        : ""
    }

    <p style="margin:24px 0 0">
      <a href="${esc(args.adminUrl)}" style="background:#b4541f;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Review in admin queue →</a>
    </p>
    <p style="margin:12px 0 0;color:#999;font-size:12px">Nothing is live yet — this change is waiting for your manual approval.</p>
  </div>`;
  return { subject, html };
}
