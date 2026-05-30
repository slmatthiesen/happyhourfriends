/**
 * Minimal Resend email client (PRD §5 outreach / operator notifications).
 *
 * Calls the Resend REST API directly via fetch — no SDK dependency. Degrades
 * gracefully: with no RESEND_API_KEY set it logs and no-ops (so dev and the CI build
 * never require a key), matching the rest of the app's "works without keys" posture.
 * Never throws; returns whether the send succeeded so callers can stay best-effort.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export interface SendEmailArgs {
  to: string | string[];
  subject: string;
  html: string;
  from?: string;
}

/** Recipients for operator notifications — the ADMIN_EMAIL allowlist (comma-separated). */
export function adminRecipients(): string[] {
  return (process.env.ADMIN_EMAIL ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function sendEmail(args: SendEmailArgs): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const to = Array.isArray(args.to) ? args.to : [args.to];
  if (!key) {
    console.warn(
      `[email] RESEND_API_KEY unset — skipping "${args.subject}" to ${to.join(", ") || "(no recipients)"}`,
    );
    return false;
  }
  if (to.length === 0) {
    console.warn(`[email] no recipients for "${args.subject}" — skipping`);
    return false;
  }
  const from = args.from ?? process.env.RESEND_FROM ?? "help@friend.happyhourfriends.com";
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject: args.subject, html: args.html }),
    });
    if (!res.ok) {
      console.error(`[email] send failed (${res.status}): ${await res.text()}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[email] send error", e);
    return false;
  }
}
