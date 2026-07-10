/**
 * Pulsing live indicator, shared by the city grid ("Now" column) and the venue page
 * heading so both read identically. Open = solid accent dot with a soft glow + a Tailwind
 * `animate-ping` ripple radiating outward (classic broadcast LIVE feel). Closed = dim
 * hollow ring so a status column reads as a quiet field that lights up.
 */
export function NowBadge({
  open = true,
  className = "",
}: {
  open?: boolean;
  className?: string;
}) {
  if (open) {
    return (
      <span
        title="Happy hour happening now"
        aria-label="Happy hour happening now"
        className={`relative inline-flex h-2.5 w-2.5 align-middle ${className}`}
      >
        <span
          aria-hidden="true"
          className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-warm opacity-75"
        />
        <span
          aria-hidden="true"
          className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent-warm shadow-[0_0_8px_var(--accent-warm)]"
        />
      </span>
    );
  }
  return (
    <span
      title="Not happening right now — check the days and times"
      aria-label="Not happening right now"
      className={`inline-flex h-2.5 w-2.5 rounded-full border border-border bg-transparent align-middle ${className}`}
    />
  );
}
