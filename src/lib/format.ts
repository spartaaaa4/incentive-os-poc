const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const integerFormatter = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 0,
});

export function formatInr(value: number): string {
  return inrFormatter.format(value);
}

export function formatNumber(value: number): string {
  return integerFormatter.format(value);
}

/** Compact Indian scale for subtitles (1 Cr = ₹1,00,00,000). */
export function formatInrScaleHint(value: number): string | null {
  const abs = Math.abs(value);
  if (abs >= 1e7) return `${(value / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `${(value / 1e5).toFixed(2)} L`;
  return null;
}

export function pctDelta(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}
