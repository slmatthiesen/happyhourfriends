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
  const client = globalForDb.__hhfClient ?? postgres(url, { max: 10 });
  const database = drizzle(client, { schema });
  if (process.env.NODE_ENV !== "production") {
    globalForDb.__hhfClient = client;
    globalForDb.__hhfDb = database;
  }
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
