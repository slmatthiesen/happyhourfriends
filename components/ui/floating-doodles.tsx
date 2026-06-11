import { uiFlags } from "@/lib/ui/flags";

/* Decorative emoji drifting up behind all content (personality round).
   Pure CSS animation, no client JS. Negative delays stagger the loop so the
   field looks mid-flight on load instead of launching in formation. */
const DOODLES = [
  { emoji: "🍋", left: "8%", duration: "14s", delay: "0s", size: "22px" },
  { emoji: "🫒", left: "30%", duration: "18s", delay: "-7s", size: "20px" },
  { emoji: "🍸", left: "55%", duration: "16s", delay: "-11s", size: "24px" },
  { emoji: "🍻", left: "80%", duration: "20s", delay: "-4s", size: "24px" },
  { emoji: "✨", left: "92%", duration: "12s", delay: "-8s", size: "14px" },
];

export function FloatingDoodles() {
  if (!uiFlags.doodles) return null;
  return (
    <div className="doodle-field" aria-hidden="true">
      {DOODLES.map((d) => (
        <span
          key={d.emoji}
          style={{
            left: d.left,
            fontSize: d.size,
            animationDuration: d.duration,
            animationDelay: d.delay,
          }}
        >
          {d.emoji}
        </span>
      ))}
    </div>
  );
}
