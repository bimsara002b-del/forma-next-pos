import {describe,it,expect} from "vitest";
import {reconcileShiftLedger} from "../src/lib/reports";
describe("closed shift ledger reconciliation (read-only)",()=>{
 it("counts refunds once as negative cash movements, never twice",()=>{
  const summary=reconcileShiftLedger({
   openingFloatCents:10000,cashSalesCents:50000,cashMovementsCents:-5500,
   recordedExpectedCents:54500,countedCashCents:54250,recordedVarianceCents:-250
  });
  expect(summary).toEqual({ledgerExpectedCents:54500,ledgerVarianceCents:-250,matchesClosingSnapshot:true});
 });
 it("flags mismatch against immutable closing snapshot without modifying it",()=>{
  const summary=reconcileShiftLedger({
   openingFloatCents:100,cashSalesCents:200,cashMovementsCents:-100,
   recordedExpectedCents:300,countedCashCents:190,recordedVarianceCents:-110
  });
  expect(summary.ledgerExpectedCents).toBe(200);
  expect(summary.ledgerVarianceCents).toBe(-10);
  expect(summary.matchesClosingSnapshot).toBe(false);
 });
 it("rejects unsafe integer arithmetic",()=>{
  expect(()=>reconcileShiftLedger({openingFloatCents:Number.MAX_SAFE_INTEGER,
   cashSalesCents:100,cashMovementsCents:0,
   recordedExpectedCents:0,countedCashCents:0,recordedVarianceCents:0})).toThrow();
 });
});
