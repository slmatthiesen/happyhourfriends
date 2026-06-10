// Browser Sentry init — no-op unless NEXT_PUBLIC_SENTRY_DSN is set. The SDK is
// imported dynamically so its ~140KB chunk never loads on visitors' first paint
// (and never loads at all when the DSN is unset — it was the single biggest
// "unused JavaScript" chunk in PageSpeed Insights).
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

const sentry = dsn
  ? import("@sentry/nextjs").then((Sentry) => {
      Sentry.init({ dsn, tracesSampleRate: 0.1 });
      return Sentry;
    })
  : null;

export function onRouterTransitionStart(href: string, navigationType: string): void {
  void sentry?.then((Sentry) => Sentry.captureRouterTransitionStart(href, navigationType));
}
