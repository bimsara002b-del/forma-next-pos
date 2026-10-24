import {beginOidc,consumeOidc,type OidcConfig,type FlowStore} from "./oidc-pkce-flow";
import {oidcBrowserCookie,clearOidcBrowserCookie,checkOidcBrowserBinding} from "./oidc-browser-binding";

/** Optional server-side callback orchestration; no live Next.js route.
 * MUST use a persistent, atomic store and pinned server-owned OIDC config.
 */
export async function beginBrowserOidc(config:OidcConfig,store:FlowStore,now=Date.now()){
 const result=await beginOidc(config,store,now);
 const state=new URL(result.url).searchParams.get("state");
 if(!state)throw Error("OIDC_STATE_MISSING");
 return {authorizationUrl:result.url,setCookie:oidcBrowserCookie(state),expires:result.expires};
}
export async function consumeBrowserOidc(
 config:OidcConfig,store:FlowStore,query:URLSearchParams,cookieHeader:string|null,now=Date.now()
){
 const clearCookie=clearOidcBrowserCookie();
 // Fail before touching the database if this callback originated from a
 // different browser. A mismatch MUST NOT burn another user's valid state.
 if(!checkOidcBrowserBinding(query,cookieHeader))
   return {ok:false as const,reason:"INVALID_BROWSER_BINDING" as const,clearCookie};
 try{
  const exchange=await consumeOidc(config,store,query,now);
  return {ok:true as const,exchange,clearCookie};
 }catch{
  // No authorization codes, state, verifier or upstream errors in returned
  // information; validly bound but invalid callbacks are consumed once.
  return {ok:false as const,reason:"OIDC_CALLBACK_REJECTED" as const,clearCookie};
 }
}
