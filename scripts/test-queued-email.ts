/**
 * Runnable unit checks for the queued-for-review operator email (lib/jobs/queueForReview
 * + the queuedForReviewEmail template). Pure, $0 — uses an injected send fn, no DB
 * (new_venue submissions resolve their venue from the diff alone).
 * Run: pnpm tsx scripts/test-queued-email.ts — exits non-zero on any failure.
 */
import assert from "node:assert/strict";
import { queuedForReviewEmail } from "@/lib/email/templates";
import { notifyQueuedForReview } from "@/lib/jobs/queueForReview";
import type { SendEmailArgs } from "@/lib/email/client";

let passed = 0;
function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve(fn()).then(() => {
    passed++;
    console.log(`  ✓ ${name}`);
  });
}

const newVenueSub = {
  id: "00000000-0000-0000-0000-000000000001",
  targetType: "new_venue" as const,
  targetId: null,
  diffJsonb: {
    before: null,
    after: { name: "Tiny Tavern <& Co>", websiteUrl: "https://tiny.example.com" },
    summary: "Add Tiny Tavern",
  },
};

async function main() {
  process.env.ADMIN_EMAIL = "op@example.com, second@example.com";
  process.env.NEXT_PUBLIC_SITE_URL = "https://happyhourfriends.com";

  await check("template: subject carries venue name + summary", () => {
    const { subject } = queuedForReviewEmail({
      venueName: "Tiny Tavern",
      targetType: "happy_hour",
      summary: "Change Tuesday start to 4pm",
      reason: "Verifier unavailable: boom",
      queue: "queued_admin",
      adminUrl: "https://happyhourfriends.com/admin",
    });
    assert.match(subject, /Tiny Tavern/);
    assert.match(subject, /Change Tuesday start to 4pm/);
  });

  await check("template: html includes reason, admin link, and escapes html", () => {
    const { html } = queuedForReviewEmail({
      venueName: "Tiny Tavern <& Co>",
      targetType: "venue",
      summary: null,
      reason: "Classifier unavailable: <script>",
      queue: "queued_admin",
      adminUrl: "https://happyhourfriends.com/admin",
    });
    assert.match(html, /Classifier unavailable/);
    assert.match(html, /https:\/\/happyhourfriends\.com\/admin/);
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /Tiny Tavern &lt;&amp; Co&gt;/);
  });

  await check("template: outreach queue gets distinct wording", () => {
    const admin = queuedForReviewEmail({
      venueName: "V",
      targetType: "happy_hour",
      summary: null,
      reason: "r",
      queue: "queued_admin",
      adminUrl: "https://x/admin",
    });
    const outreach = queuedForReviewEmail({
      venueName: "V",
      targetType: "happy_hour",
      summary: null,
      reason: "r",
      queue: "queued_outreach",
      adminUrl: "https://x/admin",
    });
    assert.notEqual(admin.subject, outreach.subject);
    assert.match(outreach.subject.toLowerCase(), /outreach/);
  });

  await check("notify: sends to ADMIN_EMAIL recipients with venue from diff", async () => {
    const sent: SendEmailArgs[] = [];
    await notifyQueuedForReview(
      newVenueSub,
      { reason: "Submitter is banned — stored, never applied." },
      async (args) => {
        sent.push(args);
        return true;
      },
    );
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].to, ["op@example.com", "second@example.com"]);
    assert.match(sent[0].subject, /Tiny Tavern/);
    assert.match(sent[0].html, /banned/);
    assert.match(sent[0].html, /https:\/\/happyhourfriends\.com\/admin/);
  });

  await check("notify: never throws when send fails", async () => {
    await notifyQueuedForReview(newVenueSub, { reason: "r" }, async () => {
      throw new Error("resend down");
    });
  });

  console.log(`\n${passed} checks passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
