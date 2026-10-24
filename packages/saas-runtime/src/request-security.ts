import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { hashSessionToken, SAAS_SESSION_COOKIE, SAAS_SESSION_MAX_AGE } from "./session";

/** Only server-verified HTTPS origins may configure this boundary. */
export function validateAppOrigin(origin: string): string {
 const parsed=new URL(origin);
 if(parsed.protocol!=="https:"||parsed.username||parsed.password||parsed.search||parsed.hash||
    parsed.pathname!=="/"||parsed.origin!==origin.replace(/\/$/,""))
  throw Error("INVALID_APP_ORIGIN");
 return parsed.origin;
}
export function sessionCookie(token:string):string {
 if(!hashSessionToken(token))throw Error("INVALID_SESSION_TOKEN");
 return SAAS_SESSION_COOKIE+"="+token+"; Path=/; Max-Age="+SAAS_SESSION_MAX_AGE+
  "; Secure; HttpOnly; SameSite=Lax";
}
export function expiredSessionCookie():string {
 return SAAS_SESSION_COOKIE+"=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax";
}
/** HMAC-signed double-submit token bound to an individual authenticated session.
 * Neither the CSRF secret nor a bearer credential may be supplied by the browser.
 * The returned token is NOT the session credential and may be exposed in forms.
 */
export function mintSessionCsrf(sessionToken:string,serverSecret:string):string {
 const hash=hashSessionToken(sessionToken);
 if(!hash||serverSecret.length<32)throw Error("INVALID_CSRF_CONTEXT");
 const nonce=randomBytes(24).toString("hex");
 const sig=createHmac("sha256",serverSecret).update(hash+"."+nonce).digest("hex");
 return nonce+"."+sig;
}
export function checkSessionCsrf(sessionToken:string,serverSecret:string,submitted:string):boolean {
 const hash=hashSessionToken(sessionToken);
 if(!hash||serverSecret.length<32||!/^[a-f0-9]{48}\.[a-f0-9]{64}$/.test(submitted))return false;
 const [nonce,digest]=submitted.split(".");
 const expected=createHmac("sha256",serverSecret).update(hash+"."+nonce).digest();
 return timingSafeEqual(expected,Buffer.from(digest,"hex"));
}
export function verifySaasMutationRequest(request:{
 method:string;headers:Pick<Headers,"get">;
},expectedOrigin:string,sessionToken:string,serverSecret:string):boolean {
 try {
  const trusted=validateAppOrigin(expectedOrigin);
  const method=request.method.toUpperCase();
  if(!["POST","PUT","PATCH","DELETE"].includes(method))return false;
  // Browser Origin is required: requests without one fail closed (including scripts).
  if(request.headers.get("origin")!==trusted)return false;
  const site=request.headers.get("sec-fetch-site");
  if(site&&site!=="same-origin")return false;
  const provided=request.headers.get("x-forma-csrf");
  if(!provided||!checkSessionCsrf(sessionToken,serverSecret,provided))return false;
  return true;
 }catch{return false;}
}
