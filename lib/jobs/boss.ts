import { PgBoss } from "pg-boss";

/**
 * pg-boss singleton (PRD §2 — Postgres-native queue, no Redis). Lazily started so
 * importing job modules during `next build` never opens a connection; the actual
 * start happens on first enqueue or when the worker boots (instrumentation.ts).
 */
let boss: PgBoss | undefined;
let starting: Promise<PgBoss> | undefined;

export async function getBoss(): Promise<PgBoss> {
  if (boss) return boss;
  if (starting) return starting;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  starting = (async () => {
    const instance = new PgBoss(url);
    instance.on("error", (e: unknown) => console.error("pg-boss error", e));
    await instance.start();
    boss = instance;
    return instance;
  })();
  return starting;
}
