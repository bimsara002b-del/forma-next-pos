import { describe, expect, it } from "vitest";
import { nextPurchaseStatus, outstandingCount, validatePurchaseLines, ProcurementFailure } from "../src/lib/procurement";
describe("purchase order validation",()=>{
  it("detects order lifecycle from received quantities",()=>{
    expect(nextPurchaseStatus([{quantityOrdered:5,quantityReceived:0}])).toBe("ORDERED");
    expect(nextPurchaseStatus([{quantityOrdered:5,quantityReceived:2}])).toBe("PARTIALLY_RECEIVED");
    expect(nextPurchaseStatus([{quantityOrdered:5,quantityReceived:5}])).toBe("RECEIVED");
    expect(outstandingCount([{quantityOrdered:5,quantityReceived:2}])).toBe(3);
    expect(()=>nextPurchaseStatus([{quantityOrdered:2,quantityReceived:3}])).toThrow(ProcurementFailure);
  });
  it("validates duplicate product and order totals",()=>{
    expect(validatePurchaseLines([{productId:"p",quantityOrdered:2,unitCostCents:350}])).toBe(700);
    expect(()=>validatePurchaseLines([{productId:"p",quantityOrdered:1,unitCostCents:1},{productId:"p",quantityOrdered:1,unitCostCents:1}])).toThrow();
    expect(()=>validatePurchaseLines([{productId:"p",quantityOrdered:100000,unitCostCents:100000000}])).toThrow();
  });
});
