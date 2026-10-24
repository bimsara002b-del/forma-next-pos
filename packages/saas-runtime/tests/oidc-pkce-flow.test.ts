import {describe,it,expect} from "vitest";
import {beginOidc,consumeOidc,type OidcConfig,type PendingFlow,type FlowStore} from "../src/oidc-pkce-flow";
const config:OidcConfig={issuer:"https://login.example.test/tenant",
 authorizationEndpoint:"https://login.example.test/authorize",
 tokenEndpoint:"https://login.example.test/token",clientId:"pos-test-client",
 redirectUri:"https://pos.example.test/auth/callback"};
function store(){const data=new Map<string,PendingFlow>();const api:FlowStore={
 async create(x){if(data.has(x.digest))throw Error("DUPLICATE");data.set(x.digest,x);},
 async consume(key){const v=data.get(key)??null;data.delete(key);return v;}};return {data,api};}
describe("M30 OIDC single-use PKCE boundary",()=>{
 it("generates a PKCE code challenge and opaque state, not raw state in store",async()=>{
  const s=store(),result=await beginOidc(config,s.api,1000),u=new URL(result.url);
  expect(u.searchParams.get("code_challenge_method")).toBe("S256");
  expect(u.searchParams.get("state")).toMatch(/^[\w-]{43}$/);
  expect(s.data.size).toBe(1);
  expect(s.data.has(u.searchParams.get("state")!)).toBe(false);
 });
 it("consumes state once and rejects retry",async()=>{
  const s=store(),result=await beginOidc(config,s.api,1000),u=new URL(result.url);
  const q=new URLSearchParams({state:u.searchParams.get("state")!,code:"provider_code"});
  expect((await consumeOidc(config,s.api,q,2000)).code).toBe("provider_code");
  await expect(consumeOidc(config,s.api,q,2000)).rejects.toThrow();
 });
 it("rejects stale state and swapped client config",async()=>{
  const s=store(),result=await beginOidc(config,s.api,1000),u=new URL(result.url);
  const q=new URLSearchParams({state:u.searchParams.get("state")!,code:"provider_code"});
  await expect(consumeOidc({...config,clientId:"wrong"},s.api,q,2000)).rejects.toThrow();
  await expect(consumeOidc(config,s.api,q,2000)).rejects.toThrow();
  const r=await beginOidc(config,s.api,1000);
  await expect(consumeOidc(config,s.api,new URLSearchParams({state:new URL(r.url).searchParams.get("state")!,code:"abc"}),301001)).rejects.toThrow();
 });
 it("rejects nonHTTPS endpoints and client overrides",async()=>{
  await expect(beginOidc({...config,tokenEndpoint:"http://login.example.test/token"},store().api)).rejects.toThrow();
  await expect(beginOidc({...config,redirectUri:"https://evil.test/"},store().api)).rejects.toThrow();
 });
});
