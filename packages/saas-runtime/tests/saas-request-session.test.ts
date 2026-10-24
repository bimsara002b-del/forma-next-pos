import {describe,it,expect,vi} from "vitest";
import {createSessionCredential,SAAS_SESSION_COOKIE} from "../src/session";
import {createSaasRequestSessionReader,readSaasSessionCookie} from "../src/saas-request-session";

const a=createSessionCredential().token,b=createSessionCredential().token;
const cookie=(token:string)=>SAAS_SESSION_COOKIE+"="+token;
describe("M30 strict request-scoped SaaS session reader",()=>{
 it("reads only exact host-only session name, ignoring demo and lookalikes",()=>{
  expect(readSaasSessionCookie("forma_pos_session="+a+"; "+cookie(a))).toBe(a);
  expect(readSaasSessionCookie(SAAS_SESSION_COOKIE+"_other="+a)).toBeNull();
  expect(readSaasSessionCookie("forma_pos_session="+a)).toBeNull();
 });
 it("rejects duplicate, invalid and encoded cookie values",()=>{
  for(const value of [
   cookie(a)+"; "+cookie(a),cookie(a)+"; "+cookie(b),
   cookie(a.toUpperCase()),cookie("invalid"),cookie("%"+a),
   cookie('"'+a+'"'),cookie(a)+"\r\nInjected: true",
   "invalid",null,"a".repeat(8193)
  ])expect(readSaasSessionCookie(value)).toBeNull();
 });
 it("is scoped to an individual request, not a cached user across requests",async()=>{
  const first=createSaasRequestSessionReader({headers:new Headers({cookie:cookie(a)})});
  const second=createSaasRequestSessionReader({headers:new Headers({cookie:cookie(b)})});
  expect(await first()).toBe(a);
  expect(await second()).toBe(b);
  expect(await first()).toBe(a);
 });
 it("rereads current request header, and fails closed if the adapter throws",async()=>{
  const get=vi.fn().mockReturnValueOnce(cookie(a)).mockReturnValueOnce(cookie(b))
   .mockImplementation(()=>{throw Error("UNTRUSTED_HEADER");});
  const read=createSaasRequestSessionReader({headers:{get}});
  expect(await read()).toBe(a);
  expect(await read()).toBe(b);
  expect(await read()).toBeUndefined();
 });
});
