/**
 * resolveCity — the ONE way scripts turn CLI args into a city row.
 *
 * `--state` is MANDATORY on every location-targeting script. Cities are unique by
 * (state, slug), NOT slug alone (see db/schema/core.ts `cities_state_slug_unique`), so a
 * bare slug like "hollywood" is ambiguous the moment Hollywood, CA and Hollywood, FL both
 * exist — and a slug-only lookup would silently operate on whichever the DB returned first.
 * Requiring state (and resolving on the pair) makes that impossible: wrong/missing input
 * fails loud instead of mutating the wrong city's data.
 */
import type { Sql } from "postgres";

export interface CityArgs {
  slug: string;
  state: string;
}

/**
 * Read `--city <slug>` and `--state <code>` from argv. Throws (with usage) unless BOTH are
 * present. Returns them lowercased. Pure — pass a custom argv in tests.
 */
export function requireCityArgs(argv: string[] = process.argv): CityArgs {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const slug = get("--city");
  const state = get("--state");
  if (!slug || !state) {
    throw new Error(
      "Both --city <slug> and --state <code> are required " +
        "(e.g. --city hollywood --state fl). State is mandatory because city slugs are " +
        "unique per state, not globally — a bare slug can match more than one city.",
    );
  }
  return { slug: slug.toLowerCase(), state: state.toLowerCase() };
}

export interface CityRow {
  id: string;
  name: string;
  slug: string;
  state: string;
}

/**
 * Resolve a (slug, state) pair to exactly one city, or throw. Case-insensitive on both.
 * (state, slug) is unique, so there is at most one match.
 */
export async function resolveCity(sql: Sql, slug: string, state: string): Promise<CityRow> {
  const rows = await sql<CityRow[]>`
    SELECT id, name, slug, state FROM cities
    WHERE lower(slug) = ${slug.toLowerCase()} AND lower(state) = ${state.toLowerCase()}
  `;
  if (rows.length === 0) {
    throw new Error(`No city found for --city '${slug}' --state '${state}'.`);
  }
  return rows[0];
}

/** Convenience: parse args + resolve in one call. */
export async function requireCity(sql: Sql, argv: string[] = process.argv): Promise<CityRow> {
  const { slug, state } = requireCityArgs(argv);
  return resolveCity(sql, slug, state);
}
