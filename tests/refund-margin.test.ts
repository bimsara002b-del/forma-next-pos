import {describe,it,expect} from "vitest";
import {summarizeRefundMargin} from "../src/lib/refund-margin";
describe("refund-adjusted historical profit coverage",()=>{
 it("returns restocked original cost to inventory, and reduces revenue once",()=>{
  const x=summarizeRefundMargin([
   {quantity:2,refundCents:1000,restocked:true,unitCostCents:300}
  ]);
  expect(x).toMatchObject({
   knownCostLines:1,unknownCostLines:0,knownRefundCents:1000,
   restockedCostRecoveryCents:600,knownRefundMarginImpactCents:-400
  });
 });
 it("does not reverse cost when damaged items are not restocked",()=>{
  const x=summarizeRefundMargin([
   {quantity:2,refundCents:1000,restocked:false,unitCostCents:300}
  ]);
  expect(x.restockedCostRecoveryCents).toBe(0);
  expect(x.knownRefundMarginImpactCents).toBe(-1000);
 });
 it("marks legacy missing-cost refunds as unknown, never estimates recovery",()=>{
  const x=summarizeRefundMargin([
   {quantity:1,refundCents:500,restocked:true,unitCostCents:null},
   {quantity:1,refundCents:700,restocked:false,unitCostCents:400}
  ]);
  expect(x.unknownCostLines).toBe(1);
  expect(x.unknownRefundCents).toBe(500);
  expect(x.knownRefundCents).toBe(700);
  expect(x.restockedCostRecoveryCents).toBe(0);
  expect(x.totalLineRefundCents).toBe(1200);
 });
 it("accepts zero-cost snapshots, but rejects corrupt/unsafe historical values",()=>{
  expect(summarizeRefundMargin([
   {quantity:1,refundCents:500,restocked:true,unitCostCents:0}
  ]).unknownCostLines).toBe(0);
  expect(()=>summarizeRefundMargin([
   {quantity:-1,refundCents:500,restocked:true,unitCostCents:200}
  ])).toThrow();
  expect(()=>summarizeRefundMargin([
   {quantity:2,refundCents:500,restocked:true,unitCostCents:Number.MAX_SAFE_INTEGER}
  ])).toThrow();
 });
});
