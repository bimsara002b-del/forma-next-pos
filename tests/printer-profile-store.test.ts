import { describe,it,expect } from "vitest";
import { DEFAULT_PRINTER_PROFILE } from "../src/lib/barcode-label-sheet";
import { readNamedProfiles, upsertNamedProfile, deleteNamedProfile } from "../src/lib/printer-profile-store";
describe("saved local barcode printer profiles",()=>{
 it("saves and restores a validated named profile",()=>{
  const first=upsertNamedProfile([],"Thermal 50x30",{...DEFAULT_PRINTER_PROFILE,offsetXmm:1});
  expect(readNamedProfiles(JSON.stringify(first))).toEqual(first);
  const updated=upsertNamedProfile(first,"thermal 50x30",{...DEFAULT_PRINTER_PROFILE,offsetXmm:0.5});
  expect(updated).toHaveLength(1);
  expect(updated[0].settings.offsetXmm).toBe(0.5);
  expect(deleteNamedProfile(updated,"thermal 50x30")).toHaveLength(0);
 });
 it("discards corrupt, oversize and malformed data",()=>{
  expect(readNamedProfiles("{")).toEqual([]);
  expect(readNamedProfiles("x".repeat(15001))).toEqual([]);
  expect(readNamedProfiles(JSON.stringify([{name:"A",settings:DEFAULT_PRINTER_PROFILE}]))).toEqual([]);
  expect(readNamedProfiles(JSON.stringify([{name:"Good",settings:{...DEFAULT_PRINTER_PROFILE,offsetYmm:99}}]))).toEqual([]);
 });
 it("limits profile count and blocks control characters",()=>{
  let entries=upsertNamedProfile([],"Printer 0",DEFAULT_PRINTER_PROFILE);
  for(let i=1;i<10;i++)entries=upsertNamedProfile(entries,"Printer "+i,DEFAULT_PRINTER_PROFILE);
  expect(()=>upsertNamedProfile(entries,"Printer 11",DEFAULT_PRINTER_PROFILE)).toThrow();
  expect(()=>upsertNamedProfile([],"Bad"+String.fromCharCode(10)+"Name",DEFAULT_PRINTER_PROFILE)).toThrow();
 });
});
