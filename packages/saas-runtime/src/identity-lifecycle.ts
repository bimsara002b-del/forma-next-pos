import { createSessionCredential, SAAS_SESSION_MAX_AGE } from "./session";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type VerifiedIdentity={userId:string;verifiedAt:Date;authenticationMethod:"external-oidc"|"passkey"};
export type SessionWriter={
  create(args:{userId:string;tokenHash:string;createdAt:Date;expiresAt:Date}):Promise<void>;
  revokeHash(args:{tokenHash:string;revokedAt:Date}):Promise<number>;
  revokeUser(args:{userId:string;revokedAt:Date}):Promise<number>;
};
/** Issuance is only callable with a recently verified identity assertion
 * supplied by a trusted external verifier, never browser-controlled parameters.
 * SessionWriter must be a privileged, isolated identity service DB role, NOT
 * the SaaS tenant runtime role. This module does not verify OIDC/passkeys.
 */
export async function issueVerifiedSession(
  writer:SessionWriter,verified:VerifiedIdentity,now=new Date()
){
  if(!UUID.test(verified.userId)||!["external-oidc","passkey"].includes(verified.authenticationMethod)||
     !(verified.verifiedAt instanceof Date)||!Number.isFinite(verified.verifiedAt.getTime())||
     !Number.isFinite(now.getTime())||
     verified.verifiedAt.getTime()>now.getTime()+30_000||
     now.getTime()-verified.verifiedAt.getTime()>5*60_000)
    throw Error("UNVERIFIED_IDENTITY");
  const credential=createSessionCredential();
  const expiresAt=new Date(now.getTime()+SAAS_SESSION_MAX_AGE*1000);
  await writer.create({userId:verified.userId,tokenHash:credential.tokenHash,createdAt:now,expiresAt});
  return {token:credential.token,expiresAt};
}
export async function revokePresentedSession(writer:SessionWriter,tokenHash:string,now=new Date()){
  if(!/^[0-9a-f]{64}$/.test(tokenHash))throw Error("INVALID_SESSION_HASH");
  return writer.revokeHash({tokenHash,revokedAt:now});
}
export async function revokeAllUserSessions(writer:SessionWriter,userId:string,now=new Date()){
  if(!UUID.test(userId))throw Error("INVALID_IDENTITY");
  return writer.revokeUser({userId,revokedAt:now});
}
