/**
 * Interop-safe lazy access to the headless-render module.
 *
 * renderUrl.ts pulls in Playwright, so callers in the shared lib (extractHappyHours) must
 * load it via dynamic `import()` to keep Chromium out of the Next bundle. The catch: under
 * tsx (every CLI script), `await import("@/lib/verification/renderUrl")` returns a CJS-interop
 * namespace shaped `{ default: {...}, "module.exports": {...} }` — the NAMED exports live under
 * `.default`, so `(await import(...)).renderUrl` is `undefined`. The old call sites' try/catch
 * could not catch this (the import SUCCEEDS), so `render` silently became undefined and EVERY
 * script-run extraction was plain-fetch-only — no render for JS-SPA / robots-walled sites.
 *
 * These helpers normalise the namespace (`mod.x ?? mod.default?.x`) so the same code works under
 * tsx (CJS namespace) and Next/webpack (esModuleInterop). Import them STATICALLY — they only pull
 * renderUrl (and thus Playwright) inside the async body, so the bundle stays clean.
 */
type RenderUrlModule = typeof import("./renderUrl");

async function loadModule(): Promise<RenderUrlModule> {
  const mod = (await import("./renderUrl")) as RenderUrlModule & { default?: RenderUrlModule };
  const hasNamedExport = typeof (mod as Record<string, unknown>).renderUrl === "function";
  return hasNamedExport ? mod : (mod.default ?? mod);
}

/** The `renderUrl` function, resolved interop-safely. Throws only if the module itself fails to
 *  load (e.g. Playwright not installed) — callers should treat a throw as "no renderer". */
export async function loadRenderUrl(): Promise<RenderUrlModule["renderUrl"]> {
  return (await loadModule()).renderUrl;
}

/** Close the shared headless browser, interop-safe and never-throwing. Call once at the end of a
 *  batch/CLI run so the open Chromium doesn't keep the process alive. */
export async function closeRenderBrowserSafe(): Promise<void> {
  try {
    await (await loadModule()).closeRenderBrowser();
  } catch {
    /* never installed / already closed — nothing to free */
  }
}
