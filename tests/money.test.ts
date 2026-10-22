import { describe, expect, it } from "vitest";
import { formatMoney, parseMoney, sumLines } from "../src/lib/money";

describe("currency safety", () => {
  it("parses rupee values into integer cents", () => {
    expect(parseMoney("120.50")).toBe(12050);
    expect(parseMoney("1")).toBe(100);
    expect(parseMoney("0.1")).toBe(10);
  });
  it("rejects ambiguous or excessive amounts", () => {
    for (const bad of ["-1", "1.999", "1e9", "12abc", "1000000000", "", "12,000"]) expect(parseMoney(bad)).toBeNull();
  });
  it("calculates integer totals safely", () => {
    expect(sumLines([{ unitPriceCents: 15025, quantity: 2 }, { unitPriceCents: 99, quantity: 3 }])).toBe(30347);
    expect(() => sumLines([{ unitPriceCents: 2_000_000_000, quantity: 2 }])).toThrow();
  });
  it("formats money for Sri Lankan billing", () => {
    expect(formatMoney(123450)).toContain("1,234.50");
  });
});
