"use client";

import { useSyncExternalStore } from "react";

/**
 * Lets the operator flip between the candidate palettes live (the color direction was
 * left open — "add selectors for all of these"). The choice is written to
 * <html data-theme> and persisted in localStorage; an inline script in the root
 * layout applies it before first paint so there's no flash.
 *
 * Backed by useSyncExternalStore so the persisted value is read without a
 * setState-in-effect, and SSR renders the default ("warm") cleanly.
 */
const THEMES = [
  { key: "warm", label: "Warm" },
  { key: "twilight", label: "Twilight" },
  { key: "teal", label: "Teal" },
  { key: "sunset", label: "Sunset" },
  { key: "slate", label: "Slate" },
] as const;

type ThemeKey = (typeof THEMES)[number]["key"];

export const THEME_STORAGE_KEY = "hhf_theme";

let listeners: (() => void)[] = [];

function subscribe(cb: () => void): () => void {
  listeners.push(cb);
  return () => {
    listeners = listeners.filter((l) => l !== cb);
  };
}

function getSnapshot(): ThemeKey {
  try {
    return (localStorage.getItem(THEME_STORAGE_KEY) as ThemeKey) || "warm";
  } catch {
    return "warm";
  }
}

function getServerSnapshot(): ThemeKey {
  return "warm";
}

function applyTheme(key: ThemeKey) {
  const el = document.documentElement;
  if (key === "warm") el.removeAttribute("data-theme");
  else el.setAttribute("data-theme", key);
}

export function ThemeSwitcher() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function choose(key: ThemeKey) {
    applyTheme(key);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, key);
    } catch {
      /* ignore */
    }
    for (const l of listeners) l();
  }

  return (
    <div className="fixed bottom-3 right-3 z-50 flex items-center gap-1 rounded-full border border-border bg-bg-surface/90 px-1.5 py-1 shadow-md backdrop-blur">
      <span className="px-1 text-[10px] uppercase tracking-wide text-text-muted">
        Theme
      </span>
      {THEMES.map((t) => (
        <button
          key={t.key}
          onClick={() => choose(t.key)}
          aria-pressed={theme === t.key}
          className={`rounded-full px-2 py-0.5 text-xs transition-colors ${
            theme === t.key
              ? "bg-accent-cool text-white"
              : "text-text-muted hover:text-text-primary"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
