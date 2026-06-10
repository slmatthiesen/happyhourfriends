/**
 * Runnable check: evidence-file retention policy (lib/submit/evidenceCleanup).
 * Live citations + non-dead submissions are always kept; dead-referenced and orphan
 * files only age out past their grace windows.
 *
 * Run: tsx scripts/test-evidence-cleanup.ts
 */
import assert from "node:assert";
import { decideEvidenceFile, type EvidenceFileFacts } from "@/lib/submit/evidenceCleanup";

let passed = 0;
function check(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

const NOW = new Date("2026-06-10T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

function facts(partial: Partial<EvidenceFileFacts>): EvidenceFileFacts {
  return {
    name: "f.jpg",
    citedByLiveRow: false,
    submissionStatuses: [],
    newestReferenceAt: null,
    fileModifiedAt: daysAgo(100),
    ...partial,
  };
}

check("cited by a live row → keep forever, even with dead submissions", () => {
  const v = decideEvidenceFile(
    facts({ citedByLiveRow: true, submissionStatuses: ["rejected"], newestReferenceAt: daysAgo(400) }),
    NOW,
  );
  assert.equal(v.action, "keep");
});

check("pending / queued / applied submissions → keep", () => {
  for (const status of ["pending", "classifying", "verifying", "queued_admin", "queued_outreach", "applied", "auto_applied", "budget_exhausted"]) {
    const v = decideEvidenceFile(facts({ submissionStatuses: [status], newestReferenceAt: daysAgo(365) }), NOW);
    assert.equal(v.action, "keep", `${status} should keep`);
  }
});

check("mixed dead + alive references → keep (any alive reference wins)", () => {
  const v = decideEvidenceFile(
    facts({ submissionStatuses: ["rejected", "queued_admin"], newestReferenceAt: daysAgo(90) }),
    NOW,
  );
  assert.equal(v.action, "keep");
});

check("only rejected/reverted references → delete after the grace period", () => {
  const old = decideEvidenceFile(
    facts({ submissionStatuses: ["rejected", "reverted"], newestReferenceAt: daysAgo(31) }),
    NOW,
  );
  assert.equal(old.action, "delete");
  const recent = decideEvidenceFile(
    facts({ submissionStatuses: ["rejected"], newestReferenceAt: daysAgo(5) }),
    NOW,
  );
  assert.equal(recent.action, "keep");
});

check("orphan → delete after orphan grace, keep within it", () => {
  const old = decideEvidenceFile(facts({ fileModifiedAt: daysAgo(8) }), NOW);
  assert.equal(old.action, "delete");
  const fresh = decideEvidenceFile(facts({ fileModifiedAt: daysAgo(1) }), NOW);
  assert.equal(fresh.action, "keep");
});

check("custom grace windows are honored", () => {
  const v = decideEvidenceFile(
    facts({ submissionStatuses: ["rejected"], newestReferenceAt: daysAgo(10) }),
    NOW,
    7, // graceDays
  );
  assert.equal(v.action, "delete");
  const orphan = decideEvidenceFile(facts({ fileModifiedAt: daysAgo(2) }), NOW, 30, 1);
  assert.equal(orphan.action, "delete");
});

console.log(`\n${passed} checks passed.`);
