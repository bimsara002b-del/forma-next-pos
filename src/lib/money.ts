export function parseMoney(value: string): number | null {
  const input = value.trim();
  if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(input)) return null;
  const [whole, fraction = ""] = input.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}
export function formatMoney(cents: number): string {
  return "Rs. " + (cents / 100).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export function sumLines(lines: { unitPriceCents: number; quantity: number }[]): number {
  const total = lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);
  if (!Number.isSafeInteger(total) || total < 0 || total > 2_000_000_000) throw new Error("TOTAL_EXCEEDED");
  return total;
}
