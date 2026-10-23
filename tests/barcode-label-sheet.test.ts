import { describe, expect, it } from "vitest";
import { barcodeValue, renderLabelSheet, validateLabelBatch } from "../src/lib/barcode-label-sheet";
const make = (id: string, code = "AB12") => ({ id, name: '<Milk & "Tea">', sku: "SKU-" + id, barcode: code, priceCents: 450 });
const opts = { showName: true, showPrice: true, showCode: true };
describe("bulk barcode label printing", () => {
  it("combines two products with different copy counts in one sheet", () => {
    const rows = [{ product: make("one"), copies: 2 }, { product: make("two", "123456"), copies: 3 }];
    expect(validateLabelBatch(rows, "A4")).toBe(5);
    const html = renderLabelSheet(rows, "A4", opts);
    expect((html.match(/<article class="label">/g) ?? []).length).toBe(5);
    expect(html).toContain("grid-template-columns:repeat(4,48mm)");
    expect(html).toContain("size:A4");
    expect(html).toContain("&lt;Milk &amp; &quot;Tea&quot;&gt;");
    expect(html).not.toContain('<Milk & "Tea">');
  });
  it("rejects duplicate products, excessive labels, and invalid quantities", () => {
    const product = make("a");
    expect(() => validateLabelBatch([{ product, copies: 1 }, { product, copies: 1 }], "A4")).toThrow();
    expect(() => validateLabelBatch([{ product, copies: 0 }], "A4")).toThrow();
    expect(() => validateLabelBatch([{ product, copies: 1.5 }], "A4")).toThrow();
    expect(() => validateLabelBatch([{ product: make("a"), copies: 101 }], "A4")).toThrow();
    expect(() => validateLabelBatch([
      { product: make("a"), copies: 100 },
      { product: make("b"), copies: 100 },
      { product: make("c"), copies: 1 }
    ], "A4")).toThrow();
  });
  it("rejects too-long codes and unsafe barcode characters without printing", () => {
    expect(() => validateLabelBatch([{ product: make("a", "A".repeat(40)), copies: 1 }], "40x30")).toThrow();
    expect(() => validateLabelBatch([{ product: make("a", "<script>"), copies: 1 }], "A4")).not.toThrow();
    expect(() => validateLabelBatch([{ product: make("a", "é"), copies: 1 }], "A4")).toThrow();
    expect(barcodeValue({ ...make("a"), barcode: "" })).toBe("SKU-a");
  });
  it("supports thermal label pagination and optional line text", () => {
    const html = renderLabelSheet([{ product: make("t"), copies: 1 }], "50x30", {
      showName: false, showPrice: false, showCode: false
    });
    expect(html).toContain("size:50mm 30mm");
    expect(html).not.toContain("Rs. 4.50");
    expect(html).not.toContain("<strong class=\"product-name\">");
  });
});
