/**
 * stubCleanup — the keep / hide / delete classifier behind `pnpm cleanup:stubs`.
 *
 * Decides one no-HH stub's fate from its discovery + site signals, given a policy. Pure and
 * hermetic (no DB/I/O) so the rule has one home and a fast unit test. Reuses the existing
 * predicates: hasAlcoholSignal (the bar bet — keyed on type/name, the same signal the url-less
 * delete review used), isMenuPlatformWebsite, and ZERO_HH_TYPES.
 *
 *   - keep   → stays visible as a help-wanted stub
 *   - hide   → venues.status='no_happy_hour' (reversible; persist/apply revives on HH insert)
 *   - delete → venues.deleted_at=now() (soft; google_place_id stays as re-discovery guard)
 *
 * The DELETE set is policy-independent (true junk only). `--policy` controls ONE thing: whether
 * a good-site restaurant (no alcohol evidence, live site) is kept visible or hidden.
 */
import { hasAlcoholSignal } from "@/lib/places/chainDenylist";
import { isMenuPlatformWebsite } from "@/lib/places/menuPlatform";
import { ZERO_HH_TYPES } from "@/lib/places/stubGate";

export type StubCleanupPolicy = "alcohol-or-site" | "alcohol-only";
export type StubAction = "keep" | "hide" | "delete";

/**
 * site_health values that mean the site is dead/unusable (lib/places/siteHealth). `blocked`
 * (bot-wall — the page may still serve HH) and `ok` count as ALIVE; `null` (never probed) is
 * treated as alive too, so an unprobed site never gets deleted (conservative).
 */
export const DEAD_SITE_HEALTH: ReadonlySet<string> = new Set([
  "dns_dead", "parked", "expired_cert", "invalid_cert", "http_error", "unreachable",
]);

export interface StubSignal {
  name: string | null;
  /** seed_candidates.primary_type */
  primaryType: string | null;
  /** seed_candidates.types */
  types: string[] | null;
  /** venues.website_url */
  websiteUrl: string | null;
  /** venues.site_health (free text typed by lib/places/siteHealth); null = never probed */
  siteHealth: string | null;
}

export interface StubVerdict { action: StubAction; reason: string; }

export function classifyStub(sig: StubSignal, policy: StubCleanupPolicy): StubVerdict {
  const alcoholPositive = hasAlcoholSignal(sig.name, sig.primaryType, sig.types);
  const hasSite = sig.websiteUrl != null && sig.websiteUrl.trim() !== "";
  const menuPlatformOnly = hasSite && isMenuPlatformWebsite(sig.websiteUrl);
  const deadSite = hasSite && sig.siteHealth != null && DEAD_SITE_HEALTH.has(sig.siteHealth);
  const zeroHhType = sig.primaryType != null && ZERO_HH_TYPES.has(sig.primaryType);

  // 1. DELETE — true junk (policy-independent).
  if (menuPlatformOnly) return { action: "delete", reason: "menu-platform-only site" };
  if (!alcoholPositive && (!hasSite || deadSite)) {
    return { action: "delete", reason: hasSite ? "no alcohol signal + dead site" : "no alcohol signal + no site" };
  }

  // 2. KEEP — the alcohol-positive crowdsource bet (bars/pubs/breweries by type or name).
  if (alcoholPositive) return { action: "keep", reason: "alcohol-positive" };

  // 3. HIDE — zero-HH cuisine. Hard delete of these stays in delete-empty-cuisine-stubs.ts.
  if (zeroHhType) return { action: "hide", reason: `zero-HH cuisine (${sig.primaryType})` };

  // 4. Good-site restaurant (no alcohol evidence, live non-platform site): policy decides.
  // Exhaustive by construction — every venue not deleted/kept/hidden above has a live site
  // (step 1 deletes no-site/dead-site no-alcohol venues), so this fork always applies.
  return policy === "alcohol-or-site"
    ? { action: "keep", reason: "restaurant w/ working site (recall-miss candidate)" }
    : { action: "hide", reason: "restaurant w/ working site (alcohol-only policy)" };
}
