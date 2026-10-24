import {describe,it,expect} from "vitest";
import {createSessionCredential,SAAS_SESSION_COOKIE} from "../src/session";
import {mintSessionCsrf,checkSessionCsrf,validateAppOrigin,sessionCookie,expiredSessionCookie,verifySaasMutationRequest} from "../src/request-security";
const token=createSessionCredential().token;
const secret="server-only-test-secret-at-least-thirty-two-characters";
const origin="https://pos.example.test";
function check(method:string,provided:string|null,originHeader:string|null=origin,site:string|null="same-origin"){
 const h=new Headers();
 if(provided)h.set("x-forma-csrf",provided);
 if(originHeader)h.set("origin",originHeader);
 if(site)h.set("sec-fetch-site",site);
 return verifySaasMutationRequest({method,headers:h},origin,token,secret);
}
describe("M30 SaaS session HTTP boundary (not yet wired into routes)",()=>{
 it("mints session-bound HMAC CSRF tokens without exposing session token",()=>{
  const a=mintSessionCsrf(token,secret);
  expect(a).toMatch(/^[a-f0-9]{48}\.[a-f0-9]{64}$/);
  expect(a).not.toContain(token);
  expect(checkSessionCsrf(token,secret,a)).toBe(true);
  expect(checkSessionCsrf(createSessionCredential().token,secret,a)).toBe(false);
  expect(checkSessionCsrf(token,secret+"different",a)).toBe(false);
  expect(checkSessionCsrf(token,secret,a.slice(0,-1)+(a.endsWith("0")?"1":"0"))).toBe(false);
 });
 it("denies cross-origin, missing Origin, missing header, and cross-site fetch",()=>{
  const csrf=mintSessionCsrf(token,secret);
  expect(check("POST",csrf)).toBe(true);
  expect(check("POST",csrf,"https://evil.example")).toBe(false);
  expect(check("POST",csrf,null)).toBe(false);
  expect(check("POST",csrf,origin,"cross-site")).toBe(false);
  expect(check("POST",csrf,origin,"same-site")).toBe(false);
  expect(check("POST",null)).toBe(false);
  expect(check("GET",csrf)).toBe(false);
 });
 it("requires HTTPS exact trusted origins and cannot accept lookalikes",()=>{
  expect(validateAppOrigin(origin)).toBe(origin);
  for(const u of ["http://pos.example.test","https://pos.example.test.evil.tld","https://user:pass@pos.example.test","https://pos.example.test/path","https://pos.example.test?x=1"]){
   expect(()=>validateAppOrigin(u)).toThrow();
  }
  expect(check("PATCH",mintSessionCsrf(token,secret),"https://pos.example.test:443")).toBe(false);
 });
 it("returns secure host-only cookie strings; rejects invalid credentials",()=>{
  expect(sessionCookie(token)).toContain(SAAS_SESSION_COOKIE+"=");
  expect(sessionCookie(token)).toContain("Secure; HttpOnly; SameSite=Lax");
  expect(sessionCookie(token)).not.toContain("Domain=");
  expect(expiredSessionCookie()).toContain("Max-Age=0");
  expect(()=>sessionCookie("invalid")).toThrow();
  expect(()=>mintSessionCsrf(token,"short")).toThrow();
 });
});
