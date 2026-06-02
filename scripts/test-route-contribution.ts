/**
 * Runnable truth-table checks for routeContribution — the load-bearing safety
 * decision. Run: npx tsx scripts/test-route-contribution.ts
 */
import assert from "node:assert/strict";
import { routeContribution, type ContributionRouteInput } from "@/lib/contribution/route";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const base: ContributionRouteInput = {
  firstParty: true,
  confidence: 0.95,
  submitterBanned: false,
  submitterTrustScore: 0,
  critical: false,
  autoApplyEnabled: true,
};

check("the one safe row auto-applies", () =>
  assert.equal(routeContribution(base), "auto_apply"));
check("flag off -> queue", () =>
  assert.equal(routeContribution({ ...base, autoApplyEnabled: false }), "queue"));
check("not first-party -> queue", () =>
  assert.equal(routeContribution({ ...base, firstParty: false }), "queue"));
check("low confidence -> queue", () =>
  assert.equal(routeContribution({ ...base, confidence: 0.5 }), "queue"));
check("banned submitter -> queue", () =>
  assert.equal(routeContribution({ ...base, submitterBanned: true }), "queue"));
check("negative trust -> queue", () =>
  assert.equal(routeContribution({ ...base, submitterTrustScore: -1 }), "queue"));
check("critical change never auto-applies", () =>
  assert.equal(routeContribution({ ...base, critical: true }), "queue"));
check("confidence exactly at threshold auto-applies", () =>
  assert.equal(routeContribution({ ...base, confidence: 0.85 }), "auto_apply"));

console.log(`\n${passed} checks passed.`);
