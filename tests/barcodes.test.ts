import {describe,it,expect} from "vitest";
import {code128Symbols,code128Bars,fitsLabel} from "../src/lib/barcodes";
describe("Code128 labels",()=>{
 it("encodes B and computes weighted check",()=>{expect(code128Symbols("AB")).toEqual([104,33,34,102,106]);});
 it("encodes numeric pairs as Code C",()=>{expect(code128Symbols("1234")).toEqual([105,12,34,(105+12+68)%103,106]);});
 it("includes quiet zones and stop",()=>{const v=code128Bars("AB");expect(v.width).toBe(77);expect(v.bars[0].x).toBe(10);});
 it("rejects invalid values and too narrow paper",()=>{expect(()=>code128Bars("é")).toThrow();expect(()=>code128Bars("a".repeat(41))).toThrow();expect(fitsLabel("AB",40)).toBe(true);expect(fitsLabel("A".repeat(40),40)).toBe(false);});
});
