import * as Sentry from "@sentry/nextjs";

// Server/edge startup. Sentry init (no-op unless SENTRY_DSN is set) + booting the
// pg-boss job workers in the long-running node process (PRD §2 — Postgres queue).
export async function register() {
  const isNode = process.env.NEXT_RUNTIME === "nodejs";
  const dsn = process.env.SENTRY_DSN;

  if (dsn && (isNode || process.env.NEXT_RUNTIME === "edge")) {
    Sentry.init({ dsn, tracesSampleRate: 0.1 });
  }

  // Workers run only in the node runtime and only when a DB is configured.
  if (isNode && process.env.DATABASE_URL) {
    try {
      const { startWorkers } = await import("@/lib/jobs/worker");
      await startWorkers();
    } catch (e) {
      console.error("Failed to start job workers", e);
    }
  }
}

export const onRequestError = Sentry.captureRequestError;
