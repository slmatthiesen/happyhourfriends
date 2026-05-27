"use client";

// Apple Maps on Apple devices, Google Maps elsewhere (PRD §6.3). We deep-link
// rather than embed a map (a v1 non-goal).
export function DirectionsButton({ address }: { address: string }) {
  function open() {
    const isApple = /iPhone|iPad|iPod|Mac/.test(navigator.userAgent);
    const url = isApple
      ? `https://maps.apple.com/?q=${encodeURIComponent(address)}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }
  return (
    <button
      type="button"
      onClick={open}
      className="rounded-md bg-accent-warm px-4 py-2 text-sm font-medium text-bg-deep transition-opacity hover:opacity-90"
    >
      Get directions
    </button>
  );
}
