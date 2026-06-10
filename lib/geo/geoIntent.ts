/**
 * One-shot "use my location" handoff between pages. The landing page's CityPicker
 * sets the flag right before navigating to the nearest city; the city page's venue
 * table consumes it on mount and auto-requests geolocation, so the visitor doesn't
 * have to click "Use my location" twice. The browser permission was granted moments
 * earlier, so the second request resolves silently (no re-prompt).
 *
 * Only the INTENT is stored — coordinates never touch storage
 * (see lib/geo/useGeolocation.ts). sessionStorage scopes it to the tab.
 */
const KEY = "hhf-geo-intent";

export function setGeoIntent(): void {
  try {
    sessionStorage.setItem(KEY, "1");
  } catch {
    // Storage unavailable (private mode / blocked) — the visitor just clicks again.
  }
}

export function consumeGeoIntent(): boolean {
  try {
    if (sessionStorage.getItem(KEY) !== "1") return false;
    sessionStorage.removeItem(KEY);
    return true;
  } catch {
    return false;
  }
}
