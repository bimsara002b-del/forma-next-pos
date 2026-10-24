import { describe,it,expect } from "vitest";
import { validProviderClientId } from "../src/identity-db-writer";

describe("M30 provider session Client ID validation regression",()=>{
 it("accepts ordinary valid OIDC client IDs containing s, x and numerals",()=>{
  for(const clientId of ["forma-oidc","pos-client","saas-pos","x-client-123","client_001"])
   expect(validProviderClientId(clientId)).toBe(true);
 });
 it("rejects whitespace, controls, non-strings and abnormal length",()=>{
  for(const clientId of ["","ab","has space","line\nbreak","tab\tinside","control\u0000byte","a".repeat(257),null,42])
   expect(validProviderClientId(clientId)).toBe(false);
 });
});
