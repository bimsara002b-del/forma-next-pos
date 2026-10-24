import { describe,expect,it } from "vitest";
import { parseReportWindow,ReportInputError,salesBySriLankaDay } from "../src/lib/reports";
import {sriLankaDate,dateDaysBefore,REPORT_TIMEZONE} from "../src/lib/report-calendar";
describe("Sri Lanka single-store reporting dates (Asia/Colombo)",()=>{
 it("rejects calendar errors and periods beyond 90 days",()=>{
  expect(()=>parseReportWindow("2026-02-30","2026-03-01")).toThrow(ReportInputError);
  expect(()=>parseReportWindow("2026-11-02","2026-11-01")).toThrow(ReportInputError);
  expect(()=>parseReportWindow("2026-01-01","2026-06-30")).toThrow(ReportInputError);
 });
 it("uses Sri Lankan midnight (+05:30), not UTC midnight",()=>{
  const w=parseReportWindow("2026-10-01","2026-10-02");
  expect(REPORT_TIMEZONE).toBe("Asia/Colombo");
  expect(w.from.toISOString()).toBe("2026-09-30T18:30:00.000Z");
  expect(w.toExclusive.toISOString()).toBe("2026-10-02T18:30:00.000Z");
  const daily=salesBySriLankaDay([
   {createdAt:new Date("2026-09-30T18:29:59Z"),totalCents:900},
   {createdAt:new Date("2026-09-30T18:30:00Z"),totalCents:100},
   {createdAt:new Date("2026-10-01T18:29:59Z"),totalCents:120},
   {createdAt:new Date("2026-10-01T18:30:00Z"),totalCents:300},
   {createdAt:new Date("2026-10-02T18:29:59Z"),totalCents:400},
   {createdAt:new Date("2026-10-02T18:30:00Z"),totalCents:999}
  ],w);
  expect(daily.map(x=>x.date)).toEqual(["2026-10-01","2026-10-02"]);
  expect(daily.map(x=>x.revenueCents)).toEqual([220,700]);
  expect(daily.map(x=>x.salesCount)).toEqual([2,2]);
 });
 it("defaults to the current Sri Lanka date around UTC midnight",()=>{
  const w=parseReportWindow(null,null,new Date("2026-10-24T20:00:00.000Z"));
  expect(w.toDate).toBe("2026-10-25");
  expect(w.fromDate).toBe("2026-09-26");
  expect(sriLankaDate(new Date("2026-10-24T18:29:59Z"))).toBe("2026-10-24");
  expect(sriLankaDate(new Date("2026-10-24T18:30:00Z"))).toBe("2026-10-25");
  expect(dateDaysBefore("2026-01-01",1)).toBe("2025-12-31");
 });
});
