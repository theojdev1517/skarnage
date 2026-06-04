/** Display chip amounts without a currency symbol (values are in cents). */
export function formatStack(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function dollarsToCents(value: string): number | null {
  const n = parseFloat(value.trim());
  if (Number.isNaN(n) || n < 0) return null;
  return Math.round(n * 100);
}