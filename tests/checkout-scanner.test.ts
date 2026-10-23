import { describe, expect, it } from "vitest";
import { resolveCheckoutScan } from "../src/lib/checkout-scanner";
const catalog = [
  { id: "a", name: "Milk", sku: "MILK-1", barcode: "001234", stockQty: 3 },
  { id: "b", name: "Tea", sku: "TEA-2", barcode: null, stockQty: 2 },
  { id: "c", name: "Empty", sku: "ZERO", barcode: "000000", stockQty: 0 }
];
describe("safe POS checkout barcode scans", () => {
  it("finds exact barcode with leading zeros and an Enter suffix", () => {
    expect(resolveCheckoutScan("001234\r\n", catalog, [])).toMatchObject({
      status: "matched", productId: "a"
    });
    expect(resolveCheckoutScan("1234", catalog, []).status).toBe("unknown");
    expect(resolveCheckoutScan("00123", catalog, []).status).toBe("unknown");
  });
  it("uses case-insensitive SKU fallback without fuzzy barcode matches", () => {
    expect(resolveCheckoutScan("tea-2", catalog, [])).toMatchObject({
      status: "matched", productId: "b"
    });
    expect(resolveCheckoutScan("MIL", catalog, []).status).toBe("unknown");
  });
  it("detects ambiguity between a barcode and another product SKU", () => {
    const duplicate = [...catalog, {
      id: "d", name: "Duplicate", sku: "001234", barcode: null, stockQty: 1
    }];
    expect(resolveCheckoutScan("001234", duplicate, []).status).toBe("ambiguous");
  });
  it("does not add out-of-stock products or exceed reserved cart stock", () => {
    expect(resolveCheckoutScan("000000", catalog, []).status).toBe("out-of-stock");
    expect(resolveCheckoutScan("001234", catalog, [{productId:"a", quantity:3}]).status).toBe("stock-limit");
    expect(resolveCheckoutScan("001234", catalog, [{productId:"a", quantity:2}]).status).toBe("matched");
  });
  it("rejects non-ASCII / control characters and does not strip spaces or leading zeroes", () => {
    expect(resolveCheckoutScan("", catalog, []).status).toBe("invalid");
    expect(resolveCheckoutScan("001234\t", catalog, []).status).toBe("invalid");
    expect(resolveCheckoutScan("é", catalog, []).status).toBe("invalid");
    expect(resolveCheckoutScan("a".repeat(81), catalog, []).status).toBe("invalid");
    expect(resolveCheckoutScan(" 001234", catalog, []).status).toBe("unknown");
  });
});
