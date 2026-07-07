"use client";

import { useCallback, useRef, useState } from "react";
import type { LatLng } from "@/lib/geo/distance";

const WATCHDOG_MS = 12_000;

export type GeoStatus =
  | "idle"
  | "prompting"
  | "granted"
  | "denied"
  | "unavailable";

export interface UseGeolocation {
  coords: LatLng | null;
  status: GeoStatus;
  request: (onLocated?: (coords: LatLng) => void) => void;
  clear: () => void;
}

/**
 * Thin wrapper over the browser Geolocation API. Coordinates live only in React
 * state — never written to storage, never sent over the network. If the visitor
 * previously granted permission, `request()` resolves silently (no re-prompt).
 */
export function useGeolocation(): UseGeolocation {
  const [coords, setCoords] = useState<LatLng | null>(null);
  const [status, setStatus] = useState<GeoStatus>("idle");
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current !== null) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  const request = useCallback((onLocated?: (coords: LatLng) => void) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("unavailable");
      return;
    }
    setStatus("prompting");
    clearWatchdog();
    // Firefox on macOS can silently hang past its own `timeout` option when
    // the OS-level Location Services permission (distinct from the
    // in-browser site permission) is off — no success or error callback
    // ever fires. This watchdog guarantees the UI recovers regardless.
    watchdogRef.current = setTimeout(() => {
      watchdogRef.current = null;
      setStatus("denied");
    }, WATCHDOG_MS);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearWatchdog();
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setCoords(next);
        setStatus("granted");
        onLocated?.(next);
      },
      () => {
        clearWatchdog();
        setStatus("denied");
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  }, [clearWatchdog]);

  const clear = useCallback(() => {
    clearWatchdog();
    setCoords(null);
    setStatus("idle");
  }, [clearWatchdog]);

  return { coords, status, request, clear };
}
