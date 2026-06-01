/**
 * Drives the contribution pipeline against the dev DB for a single case. Inserts an
 * `intent` submission, runs the interpret handler in-process, prints the children +
 * their statuses. NOTE: running this makes PAID Anthropic / web_fetch calls.
 *
 * Usage:
 *   npx tsx scripts/test-contribution-pipeline.ts <venueId> <text|photo|firstparty> [sourceUrl]
 *   - text       : free-text correction (note only)
 *   - firstparty : pass the venue's own HH menu URL as [sourceUrl]
 */
import { db } from "@/db/client";
import { editSubmissions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { handleInterpret } from "@/lib/jobs/handlers/interpret";

async function main() {
  const [venueId, kase, sourceUrlArg] = process.argv.slice(2);
  if (!venueId || !kase) {
    console.log(
      "usage: npx tsx scripts/test-contribution-pipeline.ts <venueId> <text|photo|firstparty> [sourceUrl]",
    );
    process.exit(1);
  }

  const note =
    kase === "text" ? "Happy hour is now 3-6 Mon-Fri, $5 drafts" : "See the menu at the link.";
  const sourceUrl = kase === "firstparty" ? (sourceUrlArg ?? null) : null;
  if (kase === "firstparty" && !sourceUrl) {
    console.log("firstparty case requires a [sourceUrl] argument (the venue's own HH page).");
    process.exit(1);
  }

  const [row] = await db
    .insert(editSubmissions)
    .values({
      targetType: "intent",
      targetId: venueId,
      diffJsonb: { before: null, after: { note }, sourceUrl, summary: "driver test" },
      submitterFingerprint: "driver-test",
      status: "pending",
    })
    .returning({ id: editSubmissions.id });
  console.log("parent:", row.id);

  await handleInterpret(row.id);

  const kids = await db
    .select()
    .from(editSubmissions)
    .where(eq(editSubmissions.parentSubmissionId, row.id));
  console.log(`children: ${kids.length}`);
  for (const k of kids) {
    const after = (k.diffJsonb as { after?: unknown }).after;
    console.log(`  - ${k.targetType} status=${k.status} after=${JSON.stringify(after)}`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
