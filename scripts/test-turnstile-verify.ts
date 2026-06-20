/**
 * Runnable unit checks for the Turnstile server-side verifier.
 * Run: npx tsx scripts/test-turnstile-verify.ts
 *
 * fetch is stubbed so the suite is hermetic (no network, no real keys).
 */
import assert from "node:assert/strict";
import { verifyCaptcha, isCaptchaEnforced } from "@/lib/captcha/turnstile";

let passed = 0;
function check(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve(fn()).then(() => {
    passed++;
    console.log(`  ✓ ${name}`);
  });
}

const realFetch = globalThis.fetch;
const realSecret = process.env.TURNSTILE_SECRET_KEY;
const realNodeEnv = process.env.NODE_ENV;

// NODE_ENV is typed read-only; cast to a mutable view to drive the env-dependent branches.
const mutableEnv = process.env as Record<string, string | undefined>;

/** Replace fetch with a stub that records its call and returns the given JSON body. */
function stubFetch(body: unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return { json: async () => body } as Response;
  }) as typeof fetch;
  return calls;
}

async function run() {
  // --- unset secret: posture by environment ---
  delete process.env.TURNSTILE_SECRET_KEY;

  await check("unset secret in dev → allow (skip)", async () => {
    mutableEnv.NODE_ENV = "development";
    assert.equal(await verifyCaptcha("anything"), true);
    assert.equal(isCaptchaEnforced(), false);
  });

  await check("unset secret in production → fail closed", async () => {
    mutableEnv.NODE_ENV = "production";
    assert.equal(await verifyCaptcha("anything"), false);
  });

  // --- secret present: real verification path ---
  process.env.TURNSTILE_SECRET_KEY = "test-secret";
  mutableEnv.NODE_ENV = "production";

  await check("enforced when secret is set", () => {
    assert.equal(isCaptchaEnforced(), true);
  });

  await check("missing token → false (no network call)", async () => {
    const calls = stubFetch({ success: true });
    assert.equal(await verifyCaptcha(undefined), false);
    assert.equal(await verifyCaptcha(null), false);
    assert.equal(calls.length, 0);
  });

  await check("siteverify success:true → true, hits Cloudflare endpoint with secret+response", async () => {
    const calls = stubFetch({ success: true });
    assert.equal(await verifyCaptcha("tok", "1.2.3.4"), true);
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    );
    const sent = new URLSearchParams(String(calls[0].init?.body));
    assert.equal(sent.get("secret"), "test-secret");
    assert.equal(sent.get("response"), "tok");
    assert.equal(sent.get("remoteip"), "1.2.3.4");
  });

  await check("siteverify success:false → false", async () => {
    stubFetch({ success: false });
    assert.equal(await verifyCaptcha("tok"), false);
  });

  await check("network throw → false (fail closed)", async () => {
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    assert.equal(await verifyCaptcha("tok"), false);
  });
}

run()
  .then(() => {
    console.log(`\n${passed} checks passed.`);
  })
  .finally(() => {
    globalThis.fetch = realFetch;
    if (realSecret === undefined) delete process.env.TURNSTILE_SECRET_KEY;
    else process.env.TURNSTILE_SECRET_KEY = realSecret;
    mutableEnv.NODE_ENV = realNodeEnv;
  });
