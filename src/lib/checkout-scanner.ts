/**
 * Barcode/SKU matching for a cashier scanner. Never use fuzzy product search
 * to infer a barcode; incorrect matches could result in the wrong sale.
 */
export type CheckoutScanProduct = {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  stockQty: number;
};
export type CheckoutScanCartLine = { productId: string; quantity: number };
export type CheckoutScanResult =
  | { status: "matched"; productId: string; name: string }
  | { status: "invalid" | "unknown" | "ambiguous" | "out-of-stock" | "stock-limit"; code: string };

export function resolveCheckoutScan(
  raw: string, products: CheckoutScanProduct[], cart: CheckoutScanCartLine[]
): CheckoutScanResult {
  const code = raw.replace(/\r\n$|\r$|\n$/, "");
  if (!code || code.length > 80 || !/^[\x20-\x7e]+$/.test(code))
    return { status: "invalid", code };
  // Preserve leading zeroes and barcode casing. SKUs are case-insensitive.
  const matches = products.filter(product =>
    product.barcode?.trim() === code || product.sku.toLowerCase() === code.toLowerCase()
  );
  if (matches.length === 0) return { status: "unknown", code };
  if (matches.length > 1) return { status: "ambiguous", code };
  const [product] = matches;
  if (product.stockQty <= 0) return { status: "out-of-stock", code };
  const reserved = cart.find(line => line.productId === product.id)?.quantity ?? 0;
  if (reserved >= product.stockQty) return { status: "stock-limit", code };
  return { status: "matched", productId: product.id, name: product.name };
}
