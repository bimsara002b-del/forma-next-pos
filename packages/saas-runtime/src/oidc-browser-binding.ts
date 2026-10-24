import {createHash,timingSafeEqual} from "node:crypto";

export const OIDC_BROWSER_COOKIE="__Host-forma_oidc_flow";
const STATE=/^[A-Za-z0-9_-]{43}$/;
const HASH=/^[0-9a-f]{64}$/;
const FIVE_MINUTES=300;

function digest(state:string):string {
 if(!STATE.test(state))throw Error("INVALID_OIDC_STATE");
 return createHash("sha256").update(state).digest("hex");
}
/** Set only alongside a freshly created server-side authorization flow.
 * Binding helps prevent login CSRF from another browser's callback.
 */
export function oidcBrowserCookie(state:string):string {
 return OIDC_BROWSER_COOKIE+"="+digest(state)+
  "; Path=/; Max-Age="+FIVE_MINUTES+"; Secure; HttpOnly; SameSite=Lax";
}
export function clearOidcBrowserCookie():string {
 return OIDC_BROWSER_COOKIE+"=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax";
}
export function checkOidcBrowserBinding(
 query:URLSearchParams,cookieHeader:string|null
):boolean {
 const states=query.getAll("state");
 if(states.length!==1||!STATE.test(states[0])||!cookieHeader)return false;
 const values=cookieHeader.split(";").map(x=>x.trim())
  .filter(x=>x.startsWith(OIDC_BROWSER_COOKIE+"="))
  .map(x=>x.slice(OIDC_BROWSER_COOKIE.length+1));
 if(values.length!==1||!HASH.test(values[0]))return false;
 const expected=Buffer.from(digest(states[0]),"hex");
 return timingSafeEqual(expected,Buffer.from(values[0],"hex"));
}
