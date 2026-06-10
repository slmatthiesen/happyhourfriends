/**
 * Delete uploaded evidence files that nothing needs anymore — see
 * lib/submit/evidenceCleanup.ts for the retention policy (live citations and
 * non-dead submissions are always kept; only dead-referenced + orphan files age out).
 *
 * Usage:  tsx scripts/cleanup-evidence.ts                 # DRY RUN — prints verdicts
 *         tsx scripts/cleanup-evidence.ts --apply         # actually delete
 *         tsx scripts/cleanup-evidence.ts --grace-days 30 --orphan-days 7
 *
 * Run it against prod by pointing DATABASE_URL + EVIDENCE_UPLOAD_DIR at the droplet's
 * DB/disk (i.e. run it ON the droplet) — the files live next to the DB that references
 * them, so cleanup must run where the uploads are.
 */
import "dotenv/config";
import { readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";
import {
  decideEvidenceFile,
  DEFAULT_GRACE_DAYS,
  DEFAULT_ORPHAN_DAYS,
  type EvidenceFileFacts,
} from "@/lib/submit/evidenceCleanup";

const APPLY = process.argv.includes("--apply");

function intFlag(flag: string, fallback: number): number {
  const i = process.argv.indexOf(flag);
  if (i === -1 || !process.argv[i + 1]) return fallback;
  const n = parseInt(process.argv[i + 1], 10);
  if (Number.isNaN(n) || n < 0) {
    console.error(`Invalid value for ${flag}: ${process.argv[i + 1]}`);
    process.exit(1);
  }
  return n;
}

const GRACE_DAYS = intFlag("--grace-days", DEFAULT_GRACE_DAYS);
const ORPHAN_DAYS = intFlag("--orphan-days", DEFAULT_ORPHAN_DAYS);

const PUBLIC_BASE = process.env.EVIDENCE_PUBLIC_BASE ?? "/uploads/evidence";

function uploadDir(): string {
  return (
    process.env.EVIDENCE_UPLOAD_DIR ?? join(process.cwd(), "public", "uploads", "evidence")
  );
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("ERROR: DATABASE_URL is not set.");
    process.exit(1);
  }

  const dir = uploadDir();
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => !n.startsWith("."));
  } catch {
    console.log(`No evidence directory at ${dir} — nothing to clean.`);
    return;
  }
  if (names.length === 0) {
    console.log(`Evidence directory ${dir} is empty — nothing to clean.`);
    return;
  }

  const sql = postgres(dbUrl, { max: 1 });
  try {
    // One pass per source: collect every evidence URL the DB still points at.
    const pattern = `${PUBLIC_BASE}/%`;

    const cited = await sql<{ url: string }[]>`
      SELECT source_url AS url FROM happy_hours
        WHERE source_url LIKE ${pattern} AND deleted_at IS NULL
      UNION
      SELECT source_url AS url FROM offerings
        WHERE source_url LIKE ${pattern} AND deleted_at IS NULL
    `;
    const citedNames = new Set(cited.map((r) => r.url.split("/").pop()!));

    const subs = await sql<{ url: string; status: string; updated_at: Date }[]>`
      SELECT u.url, s.status, s.updated_at
      FROM edit_submissions s
      CROSS JOIN LATERAL (
        VALUES (s.diff_jsonb->>'sourceUrl'), (s.ai_evidence_jsonb#>>'{submittedFile,url}')
      ) AS u(url)
      WHERE u.url LIKE ${pattern}
    `;
    const subsByName = new Map<string, { statuses: string[]; newest: Date }>();
    for (const row of subs) {
      const name = row.url.split("/").pop()!;
      const entry = subsByName.get(name) ?? { statuses: [], newest: row.updated_at };
      entry.statuses.push(row.status);
      if (row.updated_at > entry.newest) entry.newest = row.updated_at;
      subsByName.set(name, entry);
    }

    const now = new Date();
    let kept = 0;
    let deleted = 0;
    for (const name of names) {
      const fileStat = await stat(join(dir, name));
      const subEntry = subsByName.get(name);
      const facts: EvidenceFileFacts = {
        name,
        citedByLiveRow: citedNames.has(name),
        submissionStatuses: subEntry?.statuses ?? [],
        newestReferenceAt: subEntry?.newest ?? null,
        fileModifiedAt: fileStat.mtime,
      };
      const verdict = decideEvidenceFile(facts, now, GRACE_DAYS, ORPHAN_DAYS);
      if (verdict.action === "delete") {
        deleted++;
        if (APPLY) {
          await unlink(join(dir, name));
          console.log(`  DELETED ${name} — ${verdict.reason}`);
        } else {
          console.log(`  would delete ${name} — ${verdict.reason}`);
        }
      } else {
        kept++;
        console.log(`  keep ${name} — ${verdict.reason}`);
      }
    }

    console.log(
      `\n${APPLY ? "Deleted" : "Would delete"} ${deleted}, kept ${kept} of ${names.length} file(s) in ${dir}.` +
        (APPLY ? "" : "  (dry run — pass --apply to delete)"),
    );
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
