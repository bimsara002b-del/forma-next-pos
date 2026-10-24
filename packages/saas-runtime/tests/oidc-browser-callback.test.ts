import {describe,it,expect} from "vitest";
import {beginBrowserOidc,consumeBrowserOidc} from "../src/oidc-browser-callback";
import {type FlowStore,type PendingFlow} from "../src/oidc-pkce-flow";
const config={issuer:"https://identity.example.test/tenant",authorizationEndpoint:"https://identity.example.test/authorize",
 tokenEndpoint:"https://identity.example.test/token",clientId:"forma-client",redirectUri:"https://pos.example.test/auth/callback"};
function store(){
 const rows=new Map<string,PendingFlow>();let consumes=0;
 const api:FlowStore={
  async create(row){rows.set(row.digest,row);},
  async consume(key){consumes++;const row=rows.get(key)??null;rows.delete(key);return row;}
 };
 return {api,reads:()=>consumes};
}
describe("M30 browser-bound callback orchestration (no live login)",()=>{
 it("passes only a correctly bound single-use callback to the later verified exchange",async()=>{
  const s=store(),started=await beginBrowserOidc(config,s.api);
  const state=new URL(started.authorizationUrl).searchParams.get("state")!;
  const cookie=started.setCookie.split(";")[0];
  const query=new URLSearchParams({state,code:"server-side-authorization-code"});
  const accepted=await consumeBrowserOidc(config,s.api,query,cookie);
  expect(accepted.ok).toBe(true);
  if(accepted.ok)expect(accepted.exchange.code).toBe("server-side-authorization-code");
  expect(accepted.clearCookie).toContain("Max-Age=0");
  const replay=await consumeBrowserOidc(config,s.api,query,cookie);
  expect(replay).toMatchObject({ok:false,reason:"OIDC_CALLBACK_REJECTED"});
 });
 it("rejects cross-browser swap before consuming legitimate flow state",async()=>{
  const s=store(),a=await beginBrowserOidc(config,s.api),b=await beginBrowserOidc(config,s.api);
  const stateA=new URL(a.authorizationUrl).searchParams.get("state")!;
  const q=new URLSearchParams({state:stateA,code:"valid-code"});
  const rejected=await consumeBrowserOidc(config,s.api,q,b.setCookie.split(";")[0]);
  expect(rejected).toMatchObject({ok:false,reason:"INVALID_BROWSER_BINDING"});
  expect(s.reads()).toBe(0);
  expect((await consumeBrowserOidc(config,s.api,q,a.setCookie.split(";")[0])).ok).toBe(true);
 });
 it("fails closed on missing/duplicate cookie and denied provider callback",async()=>{
  const s=store(),a=await beginBrowserOidc(config,s.api);
  const state=new URL(a.authorizationUrl).searchParams.get("state")!;
  const q=new URLSearchParams({state,code:"code"});
  expect((await consumeBrowserOidc(config,s.api,q,null)).ok).toBe(false);
  expect((await consumeBrowserOidc(config,s.api,q,a.setCookie.split(";")[0]+"; "+a.setCookie.split(";")[0])).ok).toBe(false);
  const denied=await consumeBrowserOidc(config,s.api,new URLSearchParams({state,error:"access_denied"}),a.setCookie.split(";")[0]);
  expect(denied).toMatchObject({ok:false,reason:"OIDC_CALLBACK_REJECTED"});
  expect((await consumeBrowserOidc(config,s.api,q,a.setCookie.split(";")[0])).ok).toBe(false);
 });
});
