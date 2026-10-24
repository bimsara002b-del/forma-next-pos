import {describe,it,expect} from "vitest";
import {generateKeyPairSync,sign} from "node:crypto";
import {verifyOidcIdToken,type TrustedOidcConfig} from "../src/oidc-id-token";
const {publicKey,privateKey}=generateKeyPairSync("rsa",{modulusLength:2048});
const jwk=publicKey.export({format:"jwk"});
const settings:TrustedOidcConfig={issuer:"https://login.example.test/tenant",
 clientId:"pos-client",jwks:{keys:[{...jwk,kid:"test-key",alg:"RS256",use:"sig"}]}};
const nonce="x".repeat(43),now=new Date("2026-10-24T12:00:00Z");
const base={iss:settings.issuer,aud:settings.clientId,sub:"external-user-123",
 nonce,iat:Math.floor(now.getTime()/1000)-15,exp:Math.floor(now.getTime()/1000)+300};
function jwt(payload:Record<string,unknown>,header:Record<string,unknown>={alg:"RS256",kid:"test-key"}){
 const a=Buffer.from(JSON.stringify(header)).toString("base64url");
 const b=Buffer.from(JSON.stringify(payload)).toString("base64url");
 return a+"."+b+"."+sign("RSA-SHA256",Buffer.from(a+"."+b),privateKey).toString("base64url");
}
describe("pinned OIDC ID-token signature and claims verifier",()=>{
 it("verifies a valid RS256 signature, nonce and pinned issuer/audience",async()=>{
  expect(await verifyOidcIdToken(jwt(base),nonce,settings,now)).toMatchObject({
   subject:"external-user-123",issuer:settings.issuer,clientId:"pos-client"});
 });
 it("rejects signature forgery, wrong issuer/audience/nonce, expired or future tokens",async()=>{
  for(const p of [
   {...base,iss:"https://fake.example"}, {...base,aud:"another-client"},
   {...base,nonce:"a".repeat(43)}, {...base,exp:1},
   {...base,iat:Math.floor(now.getTime()/1000)+90}
  ])await expect(verifyOidcIdToken(jwt(p),nonce,settings,now)).rejects.toThrow("OIDC_ID_TOKEN_REJECTED");
  const forged=jwt(base).split(".");
  forged[1]=Buffer.from(JSON.stringify({...base,sub:"admin"})).toString("base64url");
  await expect(verifyOidcIdToken(forged.join("."),nonce,settings,now)).rejects.toThrow();
 });
 it("rejects unsafe JWT headers, untrusted keys and missing azp",async()=>{
  await expect(verifyOidcIdToken(jwt(base,{alg:"none",kid:"test-key"}),nonce,settings,now)).rejects.toThrow();
  await expect(verifyOidcIdToken(jwt(base,{alg:"RS256",kid:"test-key",jku:"https://bad.example/keys"}),nonce,settings,now)).rejects.toThrow();
  await expect(verifyOidcIdToken(jwt({...base,aud:["pos-client","other"]}),nonce,settings,now)).rejects.toThrow();
  await expect(verifyOidcIdToken(jwt(base),nonce,{...settings,jwks:{keys:[]}},now)).rejects.toThrow();
 });
});
