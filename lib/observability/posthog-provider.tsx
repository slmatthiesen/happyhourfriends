"use client";

import { useEffect } from "react";

/**
 * Boots PostHog after hydration. No-op (no init, no SDK download) when
 * NEXT_PUBLIC_POSTHOG_KEY is unset, so analytics is opt-in via env and never
 * blocks local dev or builds. The SDK is imported dynamically: posthog-js is
 * ~90KB gzipped and was flagged as unused JavaScript when bundled statically.
 * (No component reads usePostHog, so the react context provider is omitted.)
 */
let initialized = false;

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!key || initialized) return;
    initialized = true;
    void import("posthog-js").then(({ default: posthog }) => {
      posthog.init(key, {
        api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
        // The dated defaults bundle turns on history_change pageviews — without it an
        // App Router SPA only captures the initial load, not client-side navigations.
        // "2026-01-30" is the newest date the pinned posthog-js's ConfigDefaults
        // accepts (PostHog's onboarding snippet suggests dates newer than the SDK).
        defaults: "2026-01-30",
        capture_pageleave: true,
        // PostHog Error Tracking stands in for Sentry (operator call 2026-06-10).
        // Client-side only: server errors (API routes, workers) are not captured.
        capture_exceptions: true,
      });
    });
  }, []);

  return <>{children}</>;
}
