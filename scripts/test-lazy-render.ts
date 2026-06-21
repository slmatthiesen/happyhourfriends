/**
 * Regression guard for the tsx CJS-interop trap that silently disabled headless render.
 *
 * `(await import("@/lib/verification/renderUrl")).renderUrl` is `undefined` under tsx — the
 * named exports sit under `.default`. lazyRender normalises that. If someone reverts to the raw
 * dynamic import (or breaks the interop), loadRenderUrl() returns undefined and render dies
 * silently across enrich/reextract/audit/adjudicate. This asserts it resolves to a function.
 */
import { loadRenderUrl, closeRenderBrowserSafe } from "@/lib/verification/lazyRender";

async function main() {
  // Prove the raw trap still exists (so this test stays meaningful) …
  const raw = (await import("@/lib/verification/renderUrl")) as Record<string, unknown>;
  const rawDirect = typeof raw.renderUrl;

  // … and prove lazyRender works around it.
  const render = await loadRenderUrl();
  if (typeof render !== "function") {
    throw new Error(`loadRenderUrl() must return a function, got ${typeof render} (raw .renderUrl was ${rawDirect})`);
  }
  // Never throws even with no browser launched.
  await closeRenderBrowserSafe();

  console.log(`✓ lazy-render interop OK (raw dynamic .renderUrl = ${rawDirect}, loadRenderUrl = function)`);
}

main().catch((e) => {
  console.error("✗ lazy-render test failed:", e.message);
  process.exit(1);
});
