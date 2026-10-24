import {createHash,randomBytes} from "node:crypto";
export type OidcConfig={issuer:string;authorizationEndpoint:string;tokenEndpoint:string;clientId:string;redirectUri:string};
export type PendingFlow={digest:string;verifier:string;nonce:string;configHash:string;expires:number};
export type FlowStore={create(flow:PendingFlow):Promise<void>;consume(digest:string):Promise<PendingFlow|null>};
const digest=(v:string)=>createHash("sha256").update(v).digest("hex");
const random=()=>randomBytes(32).toString("base64url");
function validate(c:OidcConfig){
 if(!c.clientId||c.clientId.length>256||/[\s\x00-\x1f]/.test(c.clientId))throw Error("INVALID_OIDC_CONFIG");
 for(const value of [c.issuer,c.authorizationEndpoint,c.tokenEndpoint,c.redirectUri]){
  let u:URL;try{u=new URL(value);}catch{throw Error("INVALID_OIDC_CONFIG");}
  if(u.protocol!=="https:"||u.username||u.password||u.search||u.hash||u.href!==value)throw Error("INVALID_OIDC_CONFIG");
 }
 if(new URL(c.redirectUri).pathname==="/")throw Error("INVALID_OIDC_CONFIG");
 return digest(JSON.stringify(c));
}
/** Only a CSRF/state + PKCE contract: NOT ID token verification or login. */
export async function beginOidc(c:OidcConfig,store:FlowStore,now=Date.now()){
 if("window" in globalThis)throw Error("SERVER_ONLY");
 const configHash=validate(c),state=random(),nonce=random(),verifier=random();
 await store.create({digest:digest(state),verifier,nonce,configHash,expires:now+300000});
 const url=new URL(c.authorizationEndpoint);
 for(const [key,value] of Object.entries({response_type:"code",scope:"openid",client_id:c.clientId,
  redirect_uri:c.redirectUri,state,nonce,code_challenge:createHash("sha256").update(verifier).digest("base64url"),
  code_challenge_method:"S256"}))url.searchParams.set(key,value);
 return {url:url.toString(),expires:now+300000};
}
export async function consumeOidc(c:OidcConfig,store:FlowStore,params:URLSearchParams,now=Date.now()){
 if("window" in globalThis)throw Error("SERVER_ONLY");
 const configHash=validate(c),states=params.getAll("state");
 if(states.length!==1||!/^[\w-]{43}$/.test(states[0]))throw Error("INVALID_OIDC_STATE");
 const entry=await store.consume(digest(states[0])); // MUST be atomic, durable
 if(!entry||entry.configHash!==configHash||entry.digest!==digest(states[0])||
   !Number.isSafeInteger(entry.expires)||now>=entry.expires||entry.expires-now>300000||
   !/^[\w-]{43}$/.test(entry.verifier)||!/^[\w-]{43}$/.test(entry.nonce))
   throw Error("EXPIRED_OR_REPLAYED_STATE");
 if(params.has("error"))throw Error("PROVIDER_REJECTED");
 const codes=params.getAll("code");
 if(codes.length!==1||!/^[\x21-\x7e]{1,2048}$/.test(codes[0]))throw Error("INVALID_OIDC_CODE");
 return {code:codes[0],codeVerifier:entry.verifier,expectedNonce:entry.nonce,
  issuer:c.issuer,clientId:c.clientId,tokenEndpoint:c.tokenEndpoint,redirectUri:c.redirectUri};
}
