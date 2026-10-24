import {describe,it,expect,vi} from "vitest";
import {generateKeyPairSync,sign} from "node:crypto";
import {exchangeVerifiedOidcCode,type ConsumedOidcCode} from "../src/oidc-token-exchange";
import type {OidcConfig} from "../src/oidc-pkce-flow";
import type {TrustedOidcConfig} from "../src/oidc-id-token";
const keys=generateKeyPairSync("rsa",{modulusLength:2048});
const jwk=keys.publicKey.export({format:"jwk"});
const config:OidcConfig={
 issuer:"https://identity.example.test/tenant",
 authorizationEndpoint:"https://identity.example.test/authorize",
 tokenEndpoint:"https://identity.example.test/token",
 clientId:"forma-test-client",
 redirectUri:"https://pos.example.test/auth/callback"
};
const trusted:TrustedOidcConfig={issuer:config.issuer,clientId:config.clientId,
 jwks:{keys:[{...jwk,kid:"k1",alg:"RS256",use:"sig"}]}};
const nonce="x".repeat(43),now=new Date("2026-10-24T12:00:00Z");
const consumed:ConsumedOidcCode={issuer:config.issuer,clientId:config.clientId,
 tokenEndpoint:config.tokenEndpoint,redirectUri:config.redirectUri,
 code:"once-only-code",codeVerifier:"v".repeat(43),expectedNonce:nonce};
function jwt(overrides:Record<string,unknown>={}){
 const payload={iss:config.issuer,aud:config.clientId,sub:"subject-001",nonce,
 iat:Math.floor(now.getTime()/1000)-15,exp:Math.floor(now.getTime()/1000)+300,...overrides};
 const head=Buffer.from(JSON.stringify({alg:"RS256",kid:"k1"})).toString("base64url");
 const body=Buffer.from(JSON.stringify(payload)).toString("base64url");
 return head+"."+body+"."+sign("RSA-SHA256",Buffer.from(head+"."+body),keys.privateKey).toString("base64url");
}
function respond(idToken=jwt(),opts:{status?:number;contentType?:string;extra?:Record<string,unknown>}={}){
 return new Response(JSON.stringify({id_token:idToken,access_token:"access-secret",token_type:"Bearer",...opts.extra}),
 {status:opts.status??200,headers:{"content-type":opts.contentType??"application/json"}});
}
describe("M30 isolated public-client OIDC code-to-verified-subject exchange",()=>{
 it("posts only to pinned endpoint using POST, PKCE and URL encoding",async()=>{
  const transport=vi.fn(async()=>respond());
  const verified=await exchangeVerifiedOidcCode(consumed,config,trusted,{transport,now});
  expect(verified).toMatchObject({issuer:config.issuer,clientId:config.clientId,subject:"subject-001"});
  expect(JSON.stringify(verified)).not.toContain("access-secret");
  const [url,init]=transport.mock.calls[0] as unknown as [string,RequestInit];
  expect(url).toBe(config.tokenEndpoint);
  expect(init).toMatchObject({method:"POST",redirect:"manual",cache:"no-store",credentials:"omit"});
  const params=new URLSearchParams(init.body as URLSearchParams);
  expect(params.get("code")).toBe(consumed.code);
  expect(params.get("code_verifier")).toBe(consumed.codeVerifier);
  expect(params.get("client_id")).toBe(config.clientId);
  expect(params.get("grant_type")).toBe("authorization_code");
  expect(params.get("client_secret")).toBeNull();
 });
 it("rejects config mismatches before any network requests",async()=>{
  const transport=vi.fn(async()=>respond());
  for(const altered of [
   {...consumed,tokenEndpoint:"https://attacker.test/token"},
   {...consumed,expectedNonce:"bad"},
   {...consumed,codeVerifier:"bad"},
   {...consumed,clientId:"attacker"},
   {...consumed,code:"bad code"},
  ])await expect(exchangeVerifiedOidcCode(altered,config,trusted,{transport,now}))
    .rejects.toThrow("OIDC_TOKEN_EXCHANGE_REJECTED");
  expect(transport).not.toHaveBeenCalled();
 });
 it("rejects redirects, provider errors, malformed JSON, missing bearer and excessive responses",async()=>{
  for(const response of [
   new Response(null,{status:302,headers:{Location:"https://attacker.test/"}}),
   new Response('{"error":"invalid_grant"}',{status:400,headers:{"content-type":"application/json"}}),
   new Response("not json",{status:200,headers:{"content-type":"application/json"}}),
   new Response("a".repeat(16385),{status:200,headers:{"content-type":"application/json"}}),
   respond(jwt(),{extra:{token_type:"mac"}}),
   respond(jwt(),{contentType:"text/html"})
  ])await expect(exchangeVerifiedOidcCode(consumed,config,trusted,{
    transport:async()=>response,now
  })).rejects.toThrow("OIDC_TOKEN_EXCHANGE_REJECTED");
 });
 it("never accepts a signed ID token for the wrong nonce, issuer or client",async()=>{
  for(const claims of [{nonce:"different"},{iss:"https://evil.test"},{aud:"evil-client"},{exp:1}]){
   await expect(exchangeVerifiedOidcCode(consumed,config,trusted,{
    transport:async()=>respond(jwt(claims)),now
   })).rejects.toThrow("OIDC_TOKEN_EXCHANGE_REJECTED");
  }
 });
 it("redacts thrown provider token and network failures",async()=>{
  await expect(exchangeVerifiedOidcCode(consumed,config,trusted,{
   transport:async()=>{throw Error("provider secret id_token");},now
  })).rejects.toThrow(/^OIDC_TOKEN_EXCHANGE_REJECTED$/);
 });
});
