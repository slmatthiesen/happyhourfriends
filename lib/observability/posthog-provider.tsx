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
        capture_pageview: true,
        capture_pageleave: true,
      });
    });
  }, []);

  return <>{children}</>;
}
