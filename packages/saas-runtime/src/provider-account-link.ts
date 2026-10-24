import type { VerifiedProviderSubject } from "./oidc-id-token";
export type ProviderAccountLookup = {
  resolveProviderSubject(input:{issuer:string;clientId:string;subject:string}):Promise<string|null>;
};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
/** No email-based account linking. Must be called only after trusted server-side OIDC verification. */
export async function mapVerifiedProviderAccount(lookup:ProviderAccountLookup,proof:VerifiedProviderSubject,now=new Date()){
 if("window" in globalThis)throw Error("SERVER_ONLY_RUNTIME");
 if(!proof||!(proof.verifiedAt instanceof Date)||!Number.isFinite(proof.verifiedAt.getTime())||
    !Number.isFinite(now.getTime())||proof.verifiedAt.getTime()>now.getTime()+30000||
    now.getTime()-proof.verifiedAt.getTime()>300000)throw Error("UNVERIFIED_IDENTITY");
 let issuer:URL;try{issuer=new URL(proof.issuer);}catch{throw Error("INVALID_PROVIDER");}
 if(issuer.protocol!=="https:"||issuer.username||issuer.password||issuer.search||issuer.hash||
    issuer.href!==proof.issuer||proof.issuer.length>512||
    typeof proof.clientId!=="string"||proof.clientId.length<3||proof.clientId.length>256||
    /[\s\x00-\x1f]/.test(proof.clientId)||
    typeof proof.subject!=="string"||!proof.subject||proof.subject.length>255||
    [...proof.subject].some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127))
    throw Error("INVALID_PROVIDER");
 const userId=await lookup.resolveProviderSubject({issuer:proof.issuer,clientId:proof.clientId,subject:proof.subject});
 if(!userId||!uuid.test(userId))throw Error("ACCOUNT_NOT_LINKED_OR_DISABLED");
 return {userId,verifiedAt:proof.verifiedAt,authenticationMethod:"external-oidc" as const};
}
