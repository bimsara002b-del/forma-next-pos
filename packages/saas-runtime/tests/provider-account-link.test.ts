import {describe,it,expect,vi} from "vitest";
import {mapVerifiedProviderAccount} from "../src/provider-account-link";
const user="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",now=new Date("2026-10-24T12:00:00Z");
const verified={issuer:"https://login.example.test/tenant",clientId:"pos-client",subject:"provider-subject-not-email",verifiedAt:now};
describe("trusted provider subject account binding contract",()=>{
 it("maps only the exact provider identity via a server-provided lookup",async()=>{
  const lookup={resolveProviderSubject:vi.fn(async(input:typeof verified)=>input.issuer===verified.issuer&&
    input.clientId===verified.clientId&&input.subject===verified.subject?user:null)};
  expect(await mapVerifiedProviderAccount(lookup,verified,now)).toMatchObject({userId:user,authenticationMethod:"external-oidc"});
  for(const bad of [{...verified,subject:"other"},{...verified,clientId:"other-client"},
   {...verified,issuer:"https://attacker.example/tenant"}])
   await expect(mapVerifiedProviderAccount(lookup,bad,now)).rejects.toThrow("ACCOUNT_NOT_LINKED_OR_DISABLED");
 });
 it("fails closed for disabled/unlinked accounts and invalid dates",async()=>{
  const lookup={resolveProviderSubject:vi.fn(async()=>null)};
  await expect(mapVerifiedProviderAccount(lookup,verified,now)).rejects.toThrow();
  await expect(mapVerifiedProviderAccount(lookup,{...verified,verifiedAt:new Date(now.getTime()-301000)},now)).rejects.toThrow("UNVERIFIED_IDENTITY");
  expect(lookup.resolveProviderSubject).toHaveBeenCalledTimes(1);
 });
 it("rejects malformed subject and issuer, without using email claims",async()=>{
  const lookup={resolveProviderSubject:vi.fn(async()=>user)};
  for(const bad of [{...verified,subject:"a\nb"},{...verified,issuer:"http://login.example.test/tenant"},
   {...verified,clientId:"bad client"}])
   await expect(mapVerifiedProviderAccount(lookup,bad,now)).rejects.toThrow("INVALID_PROVIDER");
  expect(lookup.resolveProviderSubject).not.toHaveBeenCalled();
 });
});
