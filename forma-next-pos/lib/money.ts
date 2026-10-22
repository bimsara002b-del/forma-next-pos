export function formatMoney(cents: number) {
  return `Rs. ${(cents / 100).toLocaleString("en-LK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function moneyInputToCents(raw: string): number | null {
  const clean = raw.trim().replace(/,/g, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(clean)) return null;
  const [whole, decimal = ""] = clean.split(".");
  const cents = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : null;
}
