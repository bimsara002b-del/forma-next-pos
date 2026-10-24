import { describe, expect, it } from "vitest";
import { resolveCheckoutScan,applyCheckoutScan,addOneToCheckoutCart } from "../src/lib/checkout-scanner";
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
  it("prioritizes an exact barcode over another product's colliding SKU", () => {
    const collision = [...catalog, {
      id: "d", name: "Other SKU", sku: "001234", barcode: null, stockQty: 1
    }];
    expect(resolveCheckoutScan("001234", collision, [])).toMatchObject({
      status: "matched", productId: "a"
    });
    expect(applyCheckoutScan("001234", collision, []).cart).toEqual([
      { productId: "a", quantity: 1 }
    ]);
  });
  it("rejects duplicate exact barcodes without guessing a product", () => {
    const duplicate = [...catalog, {
      id: "d", name: "Duplicate", sku: "OTHER", barcode: "001234", stockQty: 1
    }];
    expect(resolveCheckoutScan("001234", duplicate, []).status).toBe("ambiguous");
  });
  it("rejects ambiguous SKU fallback without an exact barcode hit", () => {
    const duplicate = [...catalog, {
      id: "d", name: "Duplicate SKU", sku: "tea-2", barcode: null, stockQty: 1
    }];
    expect(resolveCheckoutScan("TEA-2", duplicate, []).status).toBe("ambiguous");
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

describe("rapid scanning cannot overrun loaded stock",()=>{
 it("commits 3 back-to-back scans and rejects the fourth",()=>{
  let cart:{productId:string;quantity:number}[]=[];
  for(let i=1;i<=3;i++){
   const next=applyCheckoutScan("001234",catalog,cart);
   expect(next.result.status).toBe("matched");
   cart=next.cart;
   expect(cart).toEqual([{productId:"a",quantity:i}]);
  }
  const blocked=applyCheckoutScan("001234",catalog,cart);
  expect(blocked.result.status).toBe("stock-limit");
  expect(blocked.cart).toBe(cart);
 });
 it("never changes the cart on unknown or ambiguous scans",()=>{
  const cart=[{productId:"a",quantity:1}];
  expect(applyCheckoutScan("MIL",catalog,cart).cart).toBe(cart);
  const duplicate=[...catalog,{id:"d",name:"Dup",sku:"OTHER",barcode:"001234",stockQty:5}];
  expect(applyCheckoutScan("001234",duplicate,cart).result.status).toBe("ambiguous");
  expect(applyCheckoutScan("001234",duplicate,cart).cart).toBe(cart);
 });
 it("product card addition respects loaded stock cap",()=>{
  let cart:{productId:string;quantity:number}[]=[];
  for(let i=0;i<3;i++)cart=addOneToCheckoutCart(cart,catalog[0]).cart;
  expect(addOneToCheckoutCart(cart,catalog[0])).toEqual({cart,added:false});
  expect(addOneToCheckoutCart(cart,catalog[2]).added).toBe(false);
 });
});
