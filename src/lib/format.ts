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
