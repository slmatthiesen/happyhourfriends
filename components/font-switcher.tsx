"use client";

import { useSyncExternalStore } from "react";

const FONTS = [
  { key: "inter", label: "Inter", className: "font-[var(--font-inter)]" },
  { key: "bricolage", label: "Bricolage", className: "font-[var(--font-bricolage)]" },
  { key: "jakarta", label: "Jakarta", className: "font-[var(--font-jakarta)]" },
  { key: "space-grotesk", label: "Space", className: "font-[var(--font-space-grotesk)]" },
  { key: "manrope", label: "Manrope", className: "font-[var(--font-manrope)]" },
] as const;

type FontKey = (typeof FONTS)[number]["key"];

export const FONT_STORAGE_KEY = "hhf_font";

let listeners: (() => void)[] = [];

function subscribe(cb: () => void): () => void {
  listeners.push(cb);
  return () => {
    listeners = listeners.filter((l) => l !== cb);
  };
}

function getSnapshot(): FontKey {
  try {
    return (localStorage.getItem(FONT_STORAGE_KEY) as FontKey) || "jakarta";
  } catch {
    return "jakarta";
  }
}

function getServerSnapshot(): FontKey {
  return "jakarta";
}

function applyFont(key: FontKey) {
  const el = document.documentElement;
  if (key === "jakarta") el.removeAttribute("data-font");
  else el.setAttribute("data-font", key);
}

export function FontSwitcher() {
  const font = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function choose(key: FontKey) {
    applyFont(key);
    try {
      localStorage.setItem(FONT_STORAGE_KEY, key);
    } catch {
      /* ignore */
    }
    for (const l of listeners) l();
  }

  return (
    <div className="fixed bottom-12 right-3 z-50 flex items-center gap-1 rounded-full border border-border bg-bg-surface/90 px-1.5 py-1 shadow-md backdrop-blur">
      <span className="px-1 text-[10px] uppercase tracking-wide text-text-muted">
        Font
      </span>
      {FONTS.map((f) => (
        <button
          key={f.key}
          onClick={() => choose(f.key)}
          aria-pressed={font === f.key}
          style={{ fontFamily: `var(--font-${f.key})` }}
          className={`rounded-full px-2 py-0.5 text-xs transition-colors ${
            font === f.key
              ? "bg-accent-cool text-white"
              : "text-text-muted hover:text-text-primary"
          }`}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}
