"use client";

import { useEffect, useRef } from "react";

/**
 * Explicit-render hCaptcha widget (PRD §5.1.2). Renders only when
 * NEXT_PUBLIC_HCAPTCHA_SITE_KEY is set; otherwise shows a dev note and the form
 * submits with a null token (the server skips verification when unconfigured).
 */
interface HCaptchaApi {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      theme?: "dark" | "light";
      callback: (token: string) => void;
      "expired-callback"?: () => void;
      "error-callback"?: () => void;
    },
  ) => string;
  reset: (id?: string) => void;
}

declare global {
  interface Window {
    hcaptcha?: HCaptchaApi;
  }
}

let loadPromise: Promise<void> | null = null;

function loadHcaptcha(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.hcaptcha) return Promise.resolve();
  if (loadPromise) return loadPromise;
  loadPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://js.hcaptcha.com/1/api.js?render=explicit";
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("hCaptcha failed to load"));
    document.head.appendChild(s);
  });
  return loadPromise;
}

export function HCaptcha({
  onToken,
}: {
  onToken: (token: string | null) => void;
}) {
  const siteKey = process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY;
  const ref = useRef<HTMLDivElement>(null);
  const rendered = useRef(false);

  useEffect(() => {
    if (!siteKey || rendered.current) return;
    let cancelled = false;
    loadHcaptcha()
      .then(() => {
        if (cancelled || rendered.current || !ref.current || !window.hcaptcha) return;
        rendered.current = true;
        window.hcaptcha.render(ref.current, {
          sitekey: siteKey,
          theme: "dark",
          callback: (token) => onToken(token),
          "expired-callback": () => onToken(null),
          "error-callback": () => onToken(null),
        });
      })
      .catch(() => onToken(null));
    return () => {
      cancelled = true;
    };
  }, [siteKey, onToken]);

  if (!siteKey) {
    return (
      <p className="text-xs text-text-muted">
        Captcha is disabled in this environment.
      </p>
    );
  }
  return <div ref={ref} />;
}
