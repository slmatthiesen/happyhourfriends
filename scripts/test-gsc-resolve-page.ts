/**
 * Runnable check: resolvePage maps GSC landing-page URLs to our route entities.
 * Run: tsx scripts/test-gsc-resolve-page.ts
 */
import assert from "node:assert";
import { resolvePage } from "@/lib/gsc/resolvePage";

let passed = 0;
function check(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

check("venue page", () => {
  assert.deepEqual(resolvePage("https://happyhourfriends.com/ca/oakland/venue/alamar"), {
    kind: "venue", stateSlug: "ca", citySlug: "oakland", slug: "alamar",
  });
});
check("city page", () => {
  assert.deepEqual(resolvePage("https://happyhourfriends.com/ca/oakland"), {
    kind: "city", stateSlug: "ca", citySlug: "oakland",
  });
});
check("neighborhood page", () => {
  assert.deepEqual(resolvePage("https://happyhourfriends.com/ca/oakland/temescal"), {
    kind: "neighborhood", stateSlug: "ca", citySlug: "oakland", neighborhoodSlug: "temescal",
  });
});
check("trailing slash + query string are ignored", () => {
  assert.deepEqual(resolvePage("https://happyhourfriends.com/ca/oakland/venue/alamar/?utm=x"), {
    kind: "venue", stateSlug: "ca", citySlug: "oakland", slug: "alamar",
  });
});
check("known static routes", () => {
  for (const p of ["/", "/about", "/faq", "/for-restaurants", "/submit", "/styleguide"]) {
    assert.equal(resolvePage(`https://happyhourfriends.com${p}`).kind, "static", p);
  }
});
check("admin/api/_next are static", () => {
  for (const p of ["/admin/stubs", "/api/flags", "/_next/static/x.js"]) {
    assert.equal(resolvePage(`https://happyhourfriends.com${p}`).kind, "static", p);
  }
});

console.log(`\n${passed} checks passed`);
