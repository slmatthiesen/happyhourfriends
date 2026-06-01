"use client";

import { useCallback, useState } from "react";
import type { LatLng } from "@/lib/geo/distance";

export type GeoStatus =
  | "idle"
  | "prompting"
  | "granted"
  | "denied"
  | "unavailable";

export interface UseGeolocation {
  coords: LatLng | null;
  status: GeoStatus;
  request: () => void;
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

  const request = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("unavailable");
      return;
    }
    setStatus("prompting");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setStatus("granted");
      },
      () => setStatus("denied"),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  }, []);

  const clear = useCallback(() => {
    setCoords(null);
    setStatus("idle");
  }, []);

  return { coords, status, request, clear };
}
