/**
 * Canonical-name layer for Google-sourced neighborhoods. Google addressComponents spell
 * the same vernacular area inconsistently across venues ("Saint Philip's Plaza" /
 * "Saint Phillips Plaza", "Blvd" / "Boulevard", an official "X Village" vs the spoken
 * "X"), and stage 0 of assignNeighborhoods used to group by exact slug — every variant
 * that independently reached critical mass minted its own neighborhood row, splitting one
 * physical area across two filters.
 *
 * This module is the pure planning layer that fixes that:
 *   - canonicalNeighborhoodKey: spelling-insensitive grouping key (case, punctuation,
 *     diacritics, street-word abbreviations).
 *   - planNameClusters: groups a city's Google names into clusters (levenshtein-1 fold
 *     for residual typos), picks a display name, proposes synonym merges into coarse
 *     polygon districts ("Camelback East Village" → Camelback East, "Downtown Oakland" →
 *     Downtown), and applies curated overrides (lib/geo/neighborhoodOverrides.ts).
 *
 * Synonym proposals are NOT final: the caller must confirm the cluster's venues actually
 * sit inside the target polygon before merging (a name-only match like Tucson's "Catalina
 * Village" vs the town of Catalina 15 miles north must survive as its own area).
 * No I/O — unit-tested in scripts/test-neighborhood-canonical.ts.
 */

export interface GoogleNameCount {
  name: string;
  venues: number;
}

export interface DistrictRow {
  id: string;
  name: string;
  slug: string;
  tier: "fine" | "coarse";
  hasPolygon: boolean;
  source: string | null;
}

export interface CityNeighborhoodOverrides {
  /** canonical key (of any cluster member) → operator-curated display name. */
  display?: Record<string, string>;
  /** canonical key (of any cluster member) → slug of the district to merge into. */
  mergeIntoSlug?: Record<string, string>;
}

export interface PlannedCluster {
  /** Canonical key of the cluster's dominant variant. */
  key: string;
  /** Name to show in the UI: curated override, else the most frequent raw variant. */
  displayName: string;
  /** Raw google_neighborhood variants folded into this cluster. */
  names: string[];
  /** Total venues across all variants (critical mass is judged on this sum). */
  venues: number;
  /** Existing fine row this cluster should reuse instead of inserting a new one. */
  attachTo?: DistrictRow;
  /** Inferred synonym of a coarse polygon district — merge ONLY after the caller
   *  confirms the cluster's venues are contained by the district polygon. */
  synonymOf?: DistrictRow;
  /** Operator-curated merge target (overrides synonym inference; caller trusts it). */
  curatedInto?: DistrictRow;
}

/** Street-word abbreviations folded into their long forms (position-independent). */
const ABBREV: Record<string, string> = {
  blvd: "boulevard",
  ave: "avenue",
  hwy: "highway",
  pkwy: "parkway",
  mt: "mount",
  ft: "fort",
};

/** Tokens that cannot stand alone as a neighborhood base after a suffix strip. */
const ARTICLE_TOKENS = new Set(["the", "a", "an", "el", "la", "los", "las"]);

/** Keys shorter than this never fuzzy-fold — a 1-char edit on a short name is too
 *  likely to be a genuinely different place (Vail/Bail), not a typo. */
const MIN_FUZZY_KEY_LEN = 6;

function tokens(name: string): string[] {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Spelling-insensitive grouping key: lowercase, diacritics and punctuation stripped,
 * street-word abbreviations expanded. "St" is positional — leading = Saint, else Street.
 */
export function canonicalNeighborhoodKey(name: string): string {
  return tokens(name)
    .map((t, i) => (t === "st" ? (i === 0 ? "saint" : "street") : (ABBREV[t] ?? t)))
    .join("");
}

/** Standard DP levenshtein; only ever called on short keys so O(n·m) is fine. */
function levenshtein(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 1) return 2; // caller only cares about ≤1
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Candidate base keys a cluster might be a synonym of: the key itself, the key with a
 *  trailing "Village" dropped, and the key with the city name dropped from either end. */
function synonymBaseKeys(clusterTokens: string[], cityKey: string): string[] {
  const key = clusterTokens.join("");
  const out = [key];
  const last = clusterTokens[clusterTokens.length - 1];
  if (last === "village" && clusterTokens.length > 1) {
    const rest = clusterTokens.slice(0, -1);
    if (!(rest.length === 1 && ARTICLE_TOKENS.has(rest[0]))) out.push(rest.join(""));
  }
  if (cityKey) {
    if (key.startsWith(cityKey) && key.length > cityKey.length) out.push(key.slice(cityKey.length));
    if (key.endsWith(cityKey) && key.length > cityKey.length)
      out.push(key.slice(0, key.length - cityKey.length));
  }
  return [...new Set(out)];
}

interface Cluster {
  key: string;
  tokens: string[];
  members: GoogleNameCount[];
  venues: number;
}

/**
 * Group a city's Google neighborhood names into canonical clusters and propose how each
 * should land: its own row (possibly reusing an existing fine row), a containment-gated
 * synonym merge into a coarse district, or a curated merge. Clusters below `minVenues`
 * (summed across variants) are dropped — their venues fall through to polygon assignment.
 */
export function planNameClusters(opts: {
  cityName: string;
  minVenues: number;
  googleNames: GoogleNameCount[];
  districts: DistrictRow[];
  overrides?: CityNeighborhoodOverrides;
}): PlannedCluster[] {
  const { cityName, minVenues, googleNames, districts, overrides } = opts;

  // 1. Exact-key grouping.
  const byKey = new Map<string, Cluster>();
  for (const g of googleNames) {
    const toks = tokens(g.name).map((t, i) =>
      t === "st" ? (i === 0 ? "saint" : "street") : (ABBREV[t] ?? t),
    );
    const key = toks.join("");
    if (!key) continue;
    const c = byKey.get(key);
    if (c) {
      c.members.push(g);
      c.venues += g.venues;
    } else {
      byKey.set(key, { key, tokens: toks, members: [g], venues: g.venues });
    }
  }

  // 2. Fuzzy fold: levenshtein-1 between long-enough keys, smaller cluster into larger.
  const ordered = [...byKey.values()].sort(
    (a, b) => b.venues - a.venues || a.key.localeCompare(b.key),
  );
  const accepted: Cluster[] = [];
  for (const c of ordered) {
    const host = accepted.find(
      (h) =>
        h.key.length >= MIN_FUZZY_KEY_LEN &&
        c.key.length >= MIN_FUZZY_KEY_LEN &&
        levenshtein(h.key, c.key) <= 1,
    );
    if (host) {
      host.members.push(...c.members);
      host.venues += c.venues;
    } else {
      accepted.push(c);
    }
  }

  const cityKey = canonicalNeighborhoodKey(cityName);
  const districtByKey = new Map<string, DistrictRow[]>();
  for (const d of districts) {
    const k = canonicalNeighborhoodKey(d.name);
    const list = districtByKey.get(k);
    if (list) list.push(d);
    else districtByKey.set(k, [d]);
  }
  const districtBySlug = new Map(districts.map((d) => [d.slug, d]));

  const out: PlannedCluster[] = [];
  for (const c of accepted) {
    if (c.venues < minVenues) continue;

    const memberKeys = [...new Set(c.members.map((m) => canonicalNeighborhoodKey(m.name)))];

    // Display: curated override on any member key, else most frequent raw variant.
    let displayName: string | undefined;
    for (const k of memberKeys) {
      const o = overrides?.display?.[k];
      if (o) {
        displayName = o;
        break;
      }
    }
    if (!displayName) {
      displayName = [...c.members].sort(
        (a, b) => b.venues - a.venues || a.name.localeCompare(b.name),
      )[0].name;
    }

    const planned: PlannedCluster = {
      key: c.key,
      displayName,
      names: [...new Set(c.members.map((m) => m.name))],
      venues: c.venues,
    };

    // Curated merge wins over inferred synonyms.
    let curated: DistrictRow | undefined;
    for (const k of memberKeys) {
      const slug = overrides?.mergeIntoSlug?.[k];
      if (slug) {
        curated = districtBySlug.get(slug);
        break;
      }
    }
    if (curated) {
      planned.curatedInto = curated;
      out.push(planned);
      continue;
    }

    // Inferred synonym of a coarse polygon district (containment-gated by the caller).
    const bases = synonymBaseKeys(c.tokens, cityKey);
    for (const base of bases) {
      const match = districtByKey
        .get(base)
        ?.find((d) => d.tier === "coarse" && d.hasPolygon);
      if (match) {
        planned.synonymOf = match;
        break;
      }
    }

    // Existing fine row to reuse for the cluster's own row.
    if (!planned.synonymOf) {
      const displayKey = canonicalNeighborhoodKey(displayName);
      const candidates = [...new Set([c.key, displayKey, ...memberKeys])]
        .flatMap((k) => districtByKey.get(k) ?? [])
        .filter((d) => d.tier === "fine");
      planned.attachTo = candidates.sort((a, b) => {
        const nameEq = Number(b.name === displayName) - Number(a.name === displayName);
        if (nameEq) return nameEq;
        const poly = Number(b.hasPolygon) - Number(a.hasPolygon);
        if (poly) return poly;
        const imported = Number(a.source === "Google Places") - Number(b.source === "Google Places");
        if (imported) return imported;
        return a.slug.localeCompare(b.slug);
      })[0];
    }

    out.push(planned);
  }
  return out;
}
