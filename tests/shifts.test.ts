import { describe, expect, it } from "vitest";
import { canManageShift, expectedCash, isValidCents, ShiftFailure } from "../src/lib/shifts";
describe("cash shift domain",()=>{
  it("computes signed movement reconciliation exactly",()=>{
    expect(expectedCash(10000,55000,-5000)).toBe(60000);
    expect(expectedCash(0,1000,250)).toBe(1250);
    expect(()=>expectedCash(0,100,-200)).toThrow(ShiftFailure);
  });
  it("restricts cash amounts and overflows",()=>{
    expect(isValidCents(0)).toBe(true);
    expect(isValidCents(-1)).toBe(false);
    expect(isValidCents(1.5)).toBe(false);
    expect(()=>expectedCash(2_000_000_000,1,0)).toThrow();
  });
  it("allows shift owner and store managers to reconcile",()=>{
    expect(canManageShift({id:"a",role:"CASHIER",displayName:"A"},"a")).toBe(true);
    expect(canManageShift({id:"b",role:"CASHIER",displayName:"B"},"a")).toBe(false);
    expect(canManageShift({id:"b",role:"MANAGER",displayName:"B"},"a")).toBe(true);
  });
});
