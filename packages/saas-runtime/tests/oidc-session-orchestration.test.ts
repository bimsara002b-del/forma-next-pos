import {describe,it,expect,vi} from "vitest";
import {generateKeyPairSync,sign} from "node:crypto";
import {beginBrowserOidc} from "../src/oidc-browser-callback";
import {completeVerifiedOidcLogin} from "../src/oidc-session-orchestration";
import type {FlowStore,PendingFlow,OidcConfig} from "../src/oidc-pkce-flow";
const keys=generateKeyPairSync("rsa",{modulusLength:2048});
const config:OidcConfig={issuer:"https://login.example.test/tenant",
 authorizationEndpoint:"https://login.example.test/authorize",
 tokenEndpoint:"https://login.example.test/token",clientId:"forma-client",
 redirectUri:"https://pos.example.test/auth/callback"};
const trusted={issuer:config.issuer,clientId:config.clientId,
 jwks:{keys:[{...keys.publicKey.export({format:"jwk"}),kid:"k1",alg:"RS256",use:"sig"}]}};
const now=new Date("2026-10-24T12:00:00Z"), user="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
function fixture(){
 const rows=new Map<string,PendingFlow>();
 let nonce="";
 const store:FlowStore={
  async create(f){nonce=f.nonce;rows.set(f.digest,f);},
  async consume(k){const value=rows.get(k)??null;rows.delete(k);return value;}
 };
 const issueProviderSession=vi.fn(async()=>user);
 const writer={issueProviderSession};
 function transport(){
  const h=Buffer.from(JSON.stringify({alg:"RS256",kid:"k1"})).toString("base64url");
  const p=Buffer.from(JSON.stringify({iss:config.issuer,aud:config.clientId,
   sub:"linked-subject",nonce,iat:Math.floor(now.getTime()/1000)-2,
   exp:Math.floor(now.getTime()/1000)+180})).toString("base64url");
  const token=h+"."+p+"."+sign("RSA-SHA256",Buffer.from(h+"."+p),keys.privateKey).toString("base64url");
  return vi.fn(async()=>new Response(JSON.stringify({id_token:token,access_token:"opaque",token_type:"Bearer"}),
   {headers:{"content-type":"application/json"}}));
 }
 return {store,writer,issueProviderSession,transport};
}
describe("M30 opt-in verified provider session orchestration",()=>{
 it("issues only after signed, browser-bound one-time state",async()=>{
  const f=fixture(),started=await beginBrowserOidc(config,f.store,now.getTime());
  const query=new URLSearchParams({state:new URL(started.authorizationUrl).searchParams.get("state")!,code:"code"});
  const transport=f.transport();
  const response=await completeVerifiedOidcLogin(config,trusted,f.store,f.writer,query,
   started.setCookie.split(";")[0],{now,transport});
  expect(response.ok).toBe(true);
  if(response.ok){
   expect(response.setCookieHeaders[0]).toContain("Max-Age=0");
   expect(response.setCookieHeaders[1]).toContain("Secure; HttpOnly; SameSite=Lax");
   expect(response.setCookieHeaders[1]).toContain("__Host-forma_saas_session=");
   expect(response).not.toHaveProperty("token");
  }
  expect(f.issueProviderSession).toHaveBeenCalledWith(expect.objectContaining({
   issuer:config.issuer,clientId:config.clientId,subject:"linked-subject",
   tokenHash:expect.stringMatching(/^[a-f0-9]{64}$/)
  }));
  const replay=await completeVerifiedOidcLogin(config,trusted,f.store,f.writer,query,
   started.setCookie.split(";")[0],{now,transport});
  expect(replay).toMatchObject({ok:false,reason:"OIDC_LOGIN_REJECTED"});
  expect(f.issueProviderSession).toHaveBeenCalledTimes(1);
 });
 it("fails before issuer if browser binding is missing",async()=>{
  const f=fixture(),started=await beginBrowserOidc(config,f.store,now.getTime());
  const query=new URLSearchParams({state:new URL(started.authorizationUrl).searchParams.get("state")!,code:"code"});
  expect((await completeVerifiedOidcLogin(config,trusted,f.store,f.writer,query,null,
   {now,transport:f.transport()})).ok).toBe(false);
  expect(f.issueProviderSession).not.toHaveBeenCalled();
 });
 it("never returns cookie on DB writer failure",async()=>{
  const f=fixture(),started=await beginBrowserOidc(config,f.store,now.getTime());
  f.writer.issueProviderSession=vi.fn(async()=>{throw Error("DATABASE_PRIVATE_DETAILS")});
  const query=new URLSearchParams({state:new URL(started.authorizationUrl).searchParams.get("state")!,code:"code"});
  const outcome=await completeVerifiedOidcLogin(config,trusted,f.store,f.writer,query,
   started.setCookie.split(";")[0],{now,transport:f.transport()});
  expect(outcome).toMatchObject({ok:false,reason:"OIDC_LOGIN_REJECTED"});
  expect(JSON.stringify(outcome)).not.toContain("DATABASE_PRIVATE_DETAILS");
  expect(outcome.setCookieHeaders).toHaveLength(1);
 });
});
