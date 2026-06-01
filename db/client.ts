import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type DB = PostgresJsDatabase<typeof schema>;

const globalForDb = globalThis as unknown as {
  __hhfClient?: ReturnType<typeof postgres>;
  __hhfDb?: DB;
};

function init(): DB {
  if (globalForDb.__hhfDb) return globalForDb.__hhfDb;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const client =
    globalForDb.__hhfClient ??
    postgres(url, {
      max: 10,
      // Defense-in-depth against connection buildup: reap idle connections and
      // recycle long-lived ones so the pool can't sit at its ceiling forever.
      idle_timeout: 30, // seconds idle before a connection is closed
      max_lifetime: 60 * 30, // recycle a connection after 30 min
    });
  const database = drizzle(client, { schema });
  // Cache the single client + db on globalThis in ALL environments. The previous
  // code only cached outside production, so prod created a NEW 10-connection pool
  // on every query path — leaking ~80 idle connections until Postgres ran out of
  // non-superuser slots. `next start` is one long-lived process, so a process-wide
  // singleton is exactly right; the global also survives dev HMR module reloads.
  globalForDb.__hhfClient = client;
  globalForDb.__hhfDb = database;
  return database;
}

/**
 * Lazy DB handle. postgres.js connects on first query, and this proxy defers
 * `init()` until a property is accessed, so importing `db` during `next build`
 * (or in modules that never query) does not require DATABASE_URL to be set.
 */
export const db = new Proxy({} as DB, {
  get(_target, prop, receiver) {
    const real = init();
    const value = Reflect.get(real as object, prop, receiver);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export { schema };
