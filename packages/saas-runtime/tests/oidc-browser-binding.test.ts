import {describe,it,expect} from "vitest";
import {beginOidc,type FlowStore,type PendingFlow} from "../src/oidc-pkce-flow";
import {
 oidcBrowserCookie,clearOidcBrowserCookie,checkOidcBrowserBinding,
 OIDC_BROWSER_COOKIE
} from "../src/oidc-browser-binding";
const config={issuer:"https://id.example.test/tenant",
 authorizationEndpoint:"https://id.example.test/authorize",
 tokenEndpoint:"https://id.example.test/token",
 clientId:"forma-oidc",redirectUri:"https://pos.example.test/oidc/callback"};
function store():FlowStore{
 const records=new Map<string,PendingFlow>();
 return {
  async create(row){records.set(row.digest,row);},
  async consume(key){const value=records.get(key)??null;records.delete(key);return value;}
 };
}
describe("M30 OIDC browser callback binding",()=>{
 it("binds the same browser to its own authorization state",async()=>{
  const a=await beginOidc(config,store()),b=await beginOidc(config,store());
  const stateA=new URL(a.url).searchParams.get("state")!;
  const stateB=new URL(b.url).searchParams.get("state")!;
  const cookie=oidcBrowserCookie(stateA);
  const requestCookie=cookie.split(";")[0];
  expect(checkOidcBrowserBinding(new URLSearchParams({state:stateA}),requestCookie)).toBe(true);
  expect(checkOidcBrowserBinding(new URLSearchParams({state:stateB}),requestCookie)).toBe(false);
  expect(cookie).toContain("Secure; HttpOnly; SameSite=Lax");
  expect(cookie).not.toContain("Domain=");
  expect(cookie).not.toContain(stateA);
 });
 it("rejects missing, malformed and duplicated callback state or cookies",async()=>{
  const flow=await beginOidc(config,store());
  const state=new URL(flow.url).searchParams.get("state")!;
  const c=oidcBrowserCookie(state).split(";")[0];
  expect(checkOidcBrowserBinding(new URLSearchParams({state}),null)).toBe(false);
  expect(checkOidcBrowserBinding(new URLSearchParams(),c)).toBe(false);
  expect(checkOidcBrowserBinding(new URLSearchParams([
   ["state",state],["state",state]
  ]),c)).toBe(false);
  expect(checkOidcBrowserBinding(new URLSearchParams({state}),c+"; "+c)).toBe(false);
  expect(checkOidcBrowserBinding(new URLSearchParams({state}),
   OIDC_BROWSER_COOKIE+"=not-a-digest")).toBe(false);
  expect(()=>oidcBrowserCookie("weak")).toThrow("INVALID_OIDC_STATE");
 });
 it("provides a host-only expiry cookie for callback completion",()=>{
  const cleared=clearOidcBrowserCookie();
  expect(cleared).toContain("Max-Age=0");
  expect(cleared).toContain("Secure; HttpOnly; SameSite=Lax");
  expect(cleared).not.toContain("Domain=");
 });
});
