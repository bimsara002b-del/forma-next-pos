import {describe,it,expect} from "vitest";
import { DEFAULT_PRINTER_PROFILE,renderLabelSheet,validatePrinterProfile } from "../src/lib/barcode-label-sheet";
const product={id:"one",name:"<Gift & Co>",sku:"SKU-01",barcode:"123456",priceCents:120000};
const lines=[{product,copies:2}];
const opts={showName:true,showPrice:true,showCode:true};
describe("label template and calibration",()=>{
 it("preserves default label compatibility",()=>{
  expect(renderLabelSheet(lines,"A4",opts)).toBe(renderLabelSheet(lines,"A4",opts,DEFAULT_PRINTER_PROFILE));
 });
 it("supports price first, store branding and bounded offsets",()=>{
  const html=renderLabelSheet(lines,"50x30",opts,{template:"price-first",storeName:"<My Shop>",barcodeHeightMm:10,offsetXmm:1,offsetYmm:-0.5});
  expect(html).toContain("template-price-first");
  expect(html).toContain("&lt;My Shop&gt;");
  expect(html).toContain("height:10mm");
  expect(html).toContain("left:1mm");
  expect((html.match(/<article class="label/g)||[]).length).toBe(2);
 });
 it("accepts normal shop names and blocks control characters",()=>{
  expect(()=>validatePrinterProfile({...DEFAULT_PRINTER_PROFILE,storeName:"My Shop 24"})).not.toThrow();
  expect(()=>validatePrinterProfile({...DEFAULT_PRINTER_PROFILE,storeName:"<My Shop>"})).not.toThrow();
  expect(()=>validatePrinterProfile({...DEFAULT_PRINTER_PROFILE,storeName:"Shop"+String.fromCharCode(10)+"Name"})).toThrow();
 });
 it("rejects out-of-range settings",()=>{
  expect(()=>validatePrinterProfile({...DEFAULT_PRINTER_PROFILE,offsetXmm:10})).toThrow();
  expect(()=>validatePrinterProfile({...DEFAULT_PRINTER_PROFILE,barcodeHeightMm:4})).toThrow();
  expect(()=>validatePrinterProfile({...DEFAULT_PRINTER_PROFILE,storeName:"x".repeat(37)})).toThrow();
 });
});
