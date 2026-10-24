import { createPublicKey, verify as verifySignature } from "node:crypto";

/** Server-only verification using explicitly trusted, pinned RSA public JWKS.
 * It does not fetch remote keys or exchange codes or issue a POS session.
 */
export type TrustedOidcConfig = {
 issuer:string;clientId:string;jwks:{keys:Array<Record<string,unknown>>};
};
export type VerifiedProviderSubject={issuer:string;subject:string;clientId:string;verifiedAt:Date};
const ASCII=/^[A-Za-z0-9_-]+$/;
const keyIds=/^[A-Za-z0-9._~:-]{1,128}$/;
function readJson(s:string):Record<string,unknown>{
 let v:unknown;
 try{v=JSON.parse(Buffer.from(s,"base64url").toString("utf8"));}catch{throw Error("OIDC_ID_TOKEN_REJECTED");}
 if(!v||typeof v!=="object"||Array.isArray(v))throw Error("OIDC_ID_TOKEN_REJECTED");
 return v as Record<string,unknown>;
}
export async function verifyOidcIdToken(
 token:string,expectedNonce:string,settings:TrustedOidcConfig,now=new Date()
):Promise<VerifiedProviderSubject>{
 if("window" in globalThis)throw Error("SERVER_ONLY_RUNTIME");
 if(typeof token!=="string"||token.length>8192)throw Error("INVALID_ID_TOKEN");
 const segments=token.split(".");
 if(segments.length!==3||segments.some(x=>!x||!ASCII.test(x)))throw Error("INVALID_ID_TOKEN");
 if(!/^[A-Za-z0-9_-]{43}$/.test(expectedNonce)||!Number.isFinite(now.getTime()))
  throw Error("INVALID_VERIFICATION_CONTEXT");
 let origin:URL;try{origin=new URL(settings.issuer);}catch{throw Error("INVALID_OIDC_SETTINGS");}
 if(origin.protocol!=="https:"||origin.username||origin.password||origin.search||origin.hash||
  origin.href!==settings.issuer||!settings.clientId||settings.clientId.length>256||
  /[\s\x00-\x1f]/.test(settings.clientId))throw Error("INVALID_OIDC_SETTINGS");
 const jwks=settings.jwks?.keys;
 if(!Array.isArray(jwks)||jwks.length<1||jwks.length>20)throw Error("UNTRUSTED_JWKS");
 try{
  const header=readJson(segments[0]),claims=readJson(segments[1]);
  if(header.alg!=="RS256"||typeof header.kid!=="string"||!keyIds.test(header.kid)||
   ["jku","jwk","x5u","crit","b64"].some(x=>x in header))throw Error("INVALID_JWT_HEADER");
  const matching=jwks.filter(k=>k.kid===header.kid);
  if(matching.length!==1)throw Error("UNTRUSTED_KEY");
  for(const key of jwks){
   if(key.kty!=="RSA"||typeof key.n!=="string"||typeof key.e!=="string"||
    typeof key.kid!=="string"||!keyIds.test(key.kid)||
    (key.alg!==undefined&&key.alg!=="RS256")||(key.use!==undefined&&key.use!=="sig")||
    ["d","p","q","dp","dq","qi","oth","k"].some(field=>field in key))
     throw Error("UNTRUSTED_KEY");
  }
  const key=matching[0];
  const publicKey=createPublicKey({key:{kty:"RSA",n:key.n as string,e:key.e as string},format:"jwk"});
  if(publicKey.asymmetricKeyType!=="rsa"||(publicKey.asymmetricKeyDetails?.modulusLength??0)<2048)
   throw Error("WEAK_RSA_KEY");
  if(!verifySignature("RSA-SHA256",Buffer.from(segments[0]+"."+segments[1]),
    publicKey,Buffer.from(segments[2],"base64url")))throw Error("INVALID_SIGNATURE");
  const aud=claims.aud;
  const audOk=aud===settings.clientId||(Array.isArray(aud)&&aud.includes(settings.clientId));
  const issued=claims.iat,expires=claims.exp,nowSeconds=Math.floor(now.getTime()/1000);
  if(claims.iss!==settings.issuer||!audOk||typeof issued!=="number"||
   typeof expires!=="number"||!Number.isSafeInteger(issued)||!Number.isSafeInteger(expires)||
   issued>nowSeconds+5||issued<nowSeconds-305||expires<=nowSeconds-5||
   expires<=issued||typeof claims.sub!=="string"||claims.sub.length<1||claims.sub.length>255||
   [...claims.sub].some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127)||
   claims.nonce!==expectedNonce||
   (claims.azp!==undefined&&claims.azp!==settings.clientId)||
   (Array.isArray(aud)&&aud.length>1&&claims.azp!==settings.clientId))
   throw Error("INVALID_CLAIMS");
  return {issuer:settings.issuer,subject:claims.sub,clientId:settings.clientId,verifiedAt:new Date(now)};
 }catch{throw Error("OIDC_ID_TOKEN_REJECTED");}
}
