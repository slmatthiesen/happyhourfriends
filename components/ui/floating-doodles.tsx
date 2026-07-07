import type { CSSProperties } from "react";
import { uiFlags } from "@/lib/ui/flags";

/* Decorative emoji drifting up behind all content (personality round).
   Pure CSS animation, no client JS. Negative delays stagger the loop so the
   field looks mid-flight on load instead of launching in formation. */
const DOODLES = [
  { emoji: "🍸", left: "4%", duration: "16s", delay: "-11s", size: "24px" },
  { emoji: "🍤", left: "11%", duration: "15s", delay: "-3s", size: "22px" },
  { emoji: "🍷", left: "18%", duration: "18s", delay: "-7s", size: "22px" },
  { emoji: "🌮", left: "25%", duration: "17s", delay: "-9s", size: "22px" },
  { emoji: "🥂", left: "33%", duration: "19s", delay: "-5s", size: "22px" },
  { emoji: "🦪", left: "40%", duration: "16s", delay: "-2s", size: "20px" },
  { emoji: "🍹", left: "47%", duration: "17s", delay: "-12s", size: "22px" },
  { emoji: "🍔", left: "55%", duration: "15s", delay: "-6s", size: "22px" },
  { emoji: "🥃", left: "62%", duration: "18s", delay: "-8s", size: "22px" },
  { emoji: "🍢", left: "69%", duration: "16s", delay: "-1s", size: "22px" },
  { emoji: "🍻", left: "77%", duration: "20s", delay: "-4s", size: "24px" },
  { emoji: "🧀", left: "84%", duration: "17s", delay: "-10s", size: "20px" },
  { emoji: "🍾", left: "91%", duration: "19s", delay: "-7s", size: "22px" },
  { emoji: "✨", left: "97%", duration: "12s", delay: "-8s", size: "14px" },
];

export function FloatingDoodles() {
  if (!uiFlags.doodles) return null;
  return (
    <div className="doodle-field" aria-hidden="true">
      {DOODLES.map((d, i) => (
        <span
          key={i}
          // Every other doodle is desktop-only — the same 14 %-left offsets that read as
          // an airy field on a wide viewport pack ~2x tighter on a narrow one, so mobile
          // gets half the count. `--doodle-size` feeds the clamp() in globals.css that
          // scales the emoji itself down with viewport width instead of a fixed px.
          className={i % 2 === 1 ? "hidden sm:inline" : undefined}
          style={
            {
              left: d.left,
              "--doodle-size": d.size,
              animationDuration: d.duration,
              animationDelay: d.delay,
            } as CSSProperties
          }
        >
          {d.emoji}
        </span>
      ))}
    </div>
  );
}
