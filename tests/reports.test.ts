import { describe,expect,it } from "vitest";
import { parseReportWindow,ReportInputError,salesByUtcDay } from "../src/lib/reports";
describe("UTC reporting windows",()=>{
 it("rejects calendar errors and out-of-bounds periods",()=>{
  expect(()=>parseReportWindow("2026-02-30","2026-03-01")).toThrow(ReportInputError);
  expect(()=>parseReportWindow("2026-11-02","2026-11-01")).toThrow(ReportInputError);
  expect(()=>parseReportWindow("2026-01-01","2026-06-30")).toThrow(ReportInputError);
 });
 it("includes boundary dates exactly once",()=>{
  const w=parseReportWindow("2026-10-01","2026-10-02");
  expect(w.toExclusive.toISOString()).toBe("2026-10-03T00:00:00.000Z");
  const v=salesByUtcDay([
   {createdAt:new Date("2026-10-01T23:59:59Z"),totalCents:120},
   {createdAt:new Date("2026-10-02T00:00:00Z"),totalCents:300},
   {createdAt:new Date("2026-10-03T00:00:00Z"),totalCents:900}
  ],w);
  expect(v.map(x=>x.revenueCents)).toEqual([120,300]);
 });
});
