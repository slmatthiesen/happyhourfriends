/**
 * Runnable unit checks for the pure site-health classifier (no DB/AI/network, $0).
 * Run: pnpm tsx scripts/test-site-health.ts — exits non-zero on any failure.
 */
import assert from "node:assert/strict";
import { classifySiteHealth, type ProbeOutcome } from "@/lib/places/siteHealth";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const probe = (o: Partial<ProbeOutcome>): ProbeOutcome => ({
  finalUrl: null,
  status: null,
  errorCode: null,
  ...o,
});

// The grounding case: Ernie's Inn — server is up, certificate lapsed.
check("expired cert → expired_cert (broken)", () => {
  const v = classifySiteHealth(probe({ errorCode: "CERT_HAS_EXPIRED" }), "http://www.erniesinn.com/");
  assert.equal(v.health, "expired_cert");
  assert.equal(v.broken, true);
});

check("self-signed / untrusted cert → invalid_cert", () => {
  assert.equal(classifySiteHealth(probe({ errorCode: "DEPTH_ZERO_SELF_SIGNED_CERT" }), "https://example.com").health, "invalid_cert");
  assert.equal(classifySiteHealth(probe({ errorCode: "ERR_TLS_CERT_ALTNAME_INVALID" }), "https://example.com").health, "invalid_cert");
});

check("DNS gone → dns_dead", () => {
  assert.equal(classifySiteHealth(probe({ errorCode: "ENOTFOUND" }), "https://gone.example").health, "dns_dead");
  assert.equal(classifySiteHealth(probe({ errorCode: "EAI_AGAIN" }), "https://gone.example").health, "dns_dead");
});

check("connection refused / reset / timeout → unreachable", () => {
  for (const code of ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT"]) {
    assert.equal(classifySiteHealth(probe({ errorCode: code }), "https://example.com").health, "unreachable", code);
  }
});

check("4xx / 5xx final response → http_error", () => {
  assert.equal(classifySiteHealth(probe({ status: 404, finalUrl: "https://example.com/" }), "https://example.com").health, "http_error");
  assert.equal(classifySiteHealth(probe({ status: 503, finalUrl: "https://example.com/" }), "https://example.com").health, "http_error");
});

check("bot wall 403/401/406/429 → blocked (NOT broken — real browser loads it)", () => {
  for (const status of [401, 403, 406, 429]) {
    const v = classifySiteHealth(probe({ status, finalUrl: "https://example.com/" }), "https://example.com");
    assert.equal(v.health, "blocked", `status ${status}`);
    assert.equal(v.broken, false, `status ${status} must not be flagged broken`);
  }
});

check("facebook page returning 400 → blocked, not broken (loads in a browser)", () => {
  const v = classifySiteHealth(
    probe({ status: 400, finalUrl: "https://www.facebook.com/pages/category/Bar/Foo-123/" }),
    "https://m.facebook.com/pages/category/Bar/Foo-123/",
  );
  assert.equal(v.health, "blocked");
  assert.equal(v.broken, false);
});

check("social-host match is strict — 'x.com' must NOT swallow 'phoenix.com'", () => {
  // phoenix.com contains the substring "x.com"; a strict suffix match must still treat its
  // 404 as a real broken page, not a social-host bot wall.
  const v = classifySiteHealth(probe({ status: 404, finalUrl: "https://phoenix.com/" }), "https://phoenix.com/");
  assert.equal(v.health, "http_error");
});

check("404 / 410 / 500 are still http_error (genuinely broken)", () => {
  assert.equal(classifySiteHealth(probe({ status: 404, finalUrl: "https://example.com/" }), "https://example.com").health, "http_error");
  assert.equal(classifySiteHealth(probe({ status: 500, finalUrl: "https://example.com/" }), "https://example.com").health, "http_error");
});

check("healthy 2xx → ok (not broken)", () => {
  const v = classifySiteHealth(probe({ status: 200, finalUrl: "https://example.com/" }), "https://example.com");
  assert.equal(v.health, "ok");
  assert.equal(v.broken, false);
});

check("200 but off-domain redirect to parking host → parked", () => {
  const v = classifySiteHealth(
    probe({ status: 200, finalUrl: "https://www.hugedomains.com/domain_profile.cfm?d=oldbar&e=com" }),
    "http://oldbar.com/",
  );
  assert.equal(v.health, "parked");
  assert.equal(v.broken, true);
});

check("parking-host substring on the SAME registrable domain is NOT parked", () => {
  // A legit venue whose own domain happens to contain a parking substring, no off-domain hop.
  const v = classifySiteHealth(
    probe({ status: 200, finalUrl: "https://above.com.myrestaurant.io/" }),
    "https://above.com.myrestaurant.io/",
  );
  assert.notEqual(v.health, "parked");
});

check("legit cross-domain redirect (brand → restaurant) is NOT parked", () => {
  const v = classifySiteHealth(
    probe({ status: 200, finalUrl: "https://thegoodrestaurant.com/" }),
    "http://goodbrand.com/",
  );
  assert.equal(v.health, "ok");
});

check("AbortError code maps to unreachable, not a crash", () => {
  assert.equal(classifySiteHealth(probe({ errorCode: "ABORT_ERR" }), "https://example.com").health, "unreachable");
});

console.log(`\n✓ site-health: ${passed} checks passed.`);
