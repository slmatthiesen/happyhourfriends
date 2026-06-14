import { uiFlags } from "@/lib/ui/flags";

/* Decorative emoji drifting up behind all content (personality round).
   Pure CSS animation, no client JS. Negative delays stagger the loop so the
   field looks mid-flight on load instead of launching in formation. */
const DOODLES = [
  { emoji: "🍋", left: "6%", duration: "14s", delay: "0s", size: "22px" },
  { emoji: "🍹", left: "18%", duration: "17s", delay: "-9s", size: "22px" },
  { emoji: "🫒", left: "30%", duration: "18s", delay: "-7s", size: "20px" },
  { emoji: "🍊", left: "42%", duration: "15s", delay: "-3s", size: "20px" },
  { emoji: "🍸", left: "55%", duration: "16s", delay: "-11s", size: "24px" },
  { emoji: "🥂", left: "68%", duration: "19s", delay: "-5s", size: "22px" },
  { emoji: "🍻", left: "80%", duration: "20s", delay: "-4s", size: "24px" },
  { emoji: "✨", left: "92%", duration: "12s", delay: "-8s", size: "14px" },
];

export function FloatingDoodles() {
  if (!uiFlags.doodles) return null;
  return (
    <div className="doodle-field" aria-hidden="true">
      {DOODLES.map((d, i) => (
        <span
          key={i}
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
