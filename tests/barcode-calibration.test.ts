import { describe, it, expect } from "vitest";
import { renderCalibration, TEST_CODE } from "../src/lib/barcode-calibration";
import { DEFAULT_PRINTER_PROFILE } from "../src/lib/barcode-label-sheet";
describe("print calibration",()=>{
 it("renders two thermal test labels",()=>{
  const html=renderCalibration("40x30",DEFAULT_PRINTER_PROFILE);
  expect(TEST_CODE).toBe("123456789012");
  expect((html.match(/class="label"/g)||[]).length).toBe(2);
  expect(html).toContain("size:40mm 30mm");
  expect(html).toContain("width:10mm");
 });
 it("renders eight A4 test labels",()=>{
  const html=renderCalibration("A4",DEFAULT_PRINTER_PROFILE);
  expect((html.match(/class="label"/g)||[]).length).toBe(8);
  expect(html).toContain("repeat(4,48mm)");
 });
 it("uses printer offsets and rejects invalid inputs",()=>{
  expect(renderCalibration("50x30",{...DEFAULT_PRINTER_PROFILE,offsetXmm:1.5})).toContain("translate(1.5mm,0mm)");
  expect(()=>renderCalibration("bad" as "50x30",DEFAULT_PRINTER_PROFILE)).toThrow();
 });
});