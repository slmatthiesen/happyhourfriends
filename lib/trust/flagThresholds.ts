/**
 * Per-flag-type resolution thresholds (PRD §5.3). The 5-confirm rule is the
 * default; each flag_type may override confirm/deny counts and expiry.
 */
export interface FlagThreshold {
  confirm: number;
  deny: number;
  expiryDays: number;
}

export const FLAG_THRESHOLDS: Record<string, FlagThreshold> = {
  discontinued: { confirm: 5, deny: 3, expiryDays: 14 },
  closed: { confirm: 5, deny: 3, expiryDays: 14 },
  price_increase: { confirm: 3, deny: 2, expiryDays: 21 },
  hours_changed: { confirm: 3, deny: 2, expiryDays: 21 },
  other: { confirm: 5, deny: 3, expiryDays: 14 },
};

export function thresholdFor(flagType: string): FlagThreshold {
  return FLAG_THRESHOLDS[flagType] ?? FLAG_THRESHOLDS.other;
}
