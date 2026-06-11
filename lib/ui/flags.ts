/* Kill switches for the personality round (2026-06-11). Each feature must
   disappear cleanly when its flag is false — the operator wants this round
   easy to disable while reviewing on-branch.
   Spec: docs/superpowers/specs/2026-06-11-site-personality-design.md */
export const uiFlags = {
  aurora: true,
  doodles: true,
  copyLink: true,
} as const;
