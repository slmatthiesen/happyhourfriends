import "dotenv/config";
import { sendEmail, adminRecipients } from "@/lib/email/client";

async function main() {
  const argv = process.argv.slice(2);
  const toArg = argv.find((a) => a.startsWith("--to="))?.slice("--to=".length);
  const recipients = toArg ? [toArg] : adminRecipients();

  if (recipients.length === 0) {
    console.error("No recipient. Set ADMIN_EMAIL in .env or pass --to=you@example.com");
    process.exit(1);
  }
  if (!process.env.RESEND_API_KEY) {
    console.error("RESEND_API_KEY is not set in .env — sendEmail will no-op.");
    process.exit(1);
  }

  console.log(`from: ${process.env.RESEND_FROM ?? "(fallback)"}  to: ${recipients.join(", ")}`);

  const ok = await sendEmail({
    to: recipients,
    subject: "Happy Hour Friends — Resend smoke test",
    html: `<p>If you can read this, Resend + DNS for <code>${
      process.env.RESEND_FROM ?? "the configured sender"
    }</code> is working.</p><p>Sent ${new Date().toISOString()}</p>`,
  });

  console.log(ok ? "✅ accepted by Resend" : "❌ failed (see log above)");
  process.exit(ok ? 0 : 1);
}

main();
