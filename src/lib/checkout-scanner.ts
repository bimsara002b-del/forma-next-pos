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
  // Exact barcode takes precedence over an unrelated product SKU collision.
  // Duplicate exact barcodes remain ambiguous; never guess a product.
  const barcodeMatches = products.filter(product => product.barcode === code);
  const matches = barcodeMatches.length > 0 ? barcodeMatches :
    products.filter(product => product.sku.toLowerCase() === code.toLowerCase());
  if (matches.length === 0) return { status: "unknown", code };
  if (matches.length > 1) return { status: "ambiguous", code };
  const [product] = matches;
  if (product.stockQty <= 0) return { status: "out-of-stock", code };
  const reserved = cart.find(line => line.productId === product.id)?.quantity ?? 0;
  if (reserved >= product.stockQty) return { status: "stock-limit", code };
  return { status: "matched", productId: product.id, name: product.name };
}

/** Apply each scanner event to the latest cart, never a stale rendered cart. */
export function addOneToCheckoutCart(cart:CheckoutScanCartLine[],product:CheckoutScanProduct){
 const previous=cart.find(x=>x.productId===product.id);
 if(!Number.isSafeInteger(product.stockQty)||product.stockQty<1||(previous?.quantity??0)>=product.stockQty)
   return {cart,added:false};
 return {added:true,cart:previous?cart.map(x=>x.productId===product.id?{...x,quantity:x.quantity+1}:x):
   [...cart,{productId:product.id,quantity:1}]};
}
export function applyCheckoutScan(raw:string,products:CheckoutScanProduct[],cart:CheckoutScanCartLine[]){
 const result=resolveCheckoutScan(raw,products,cart);
 if(result.status!=="matched")return {cart,result};
 const item=products.find(p=>p.id===result.productId);
 if(!item)return {cart,result:{status:"unknown" as const,code:raw}};
 const updated=addOneToCheckoutCart(cart,item);
 return updated.added?{cart:updated.cart,result}:
   {cart,result:{status:"stock-limit" as const,code:raw}};
}
