import { describe, expect, it } from "vitest";
import { isStoreRole, wouldRemoveLastOwner, wouldDemoteLastOwner } from "../src/lib/platform-accounts";
describe("platform account role protections",()=>{
 it("accepts only store-level roles",()=>{
  expect(isStoreRole("OWNER")).toBe(true);
  expect(isStoreRole("MANAGER")).toBe(true);
  expect(isStoreRole("CASHIER")).toBe(true);
  expect(isStoreRole("SUPER_ADMIN")).toBe(false);
 });
 it("protects the last active owner",()=>{
  expect(wouldRemoveLastOwner("OWNER",true,"deactivate",1)).toBe(true);
  expect(wouldRemoveLastOwner("OWNER",true,"deactivate",2)).toBe(false);
  expect(wouldRemoveLastOwner("MANAGER",true,"deactivate",1)).toBe(false);
  expect(wouldRemoveLastOwner("OWNER",false,"activate",0)).toBe(false);
  expect(wouldDemoteLastOwner("OWNER",true,"CASHIER",1)).toBe(true);
  expect(wouldDemoteLastOwner("OWNER",true,"MANAGER",2)).toBe(false);
  expect(wouldDemoteLastOwner("OWNER",false,"MANAGER",0)).toBe(false);
  expect(wouldDemoteLastOwner("MANAGER",true,"CASHIER",0)).toBe(false);
 });
});
