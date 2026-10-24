import {describe,it,expect,vi} from "vitest";
import {hashSessionToken} from "../src/session";
import {issueVerifiedSession,revokeAllUserSessions,revokePresentedSession,type SessionWriter} from "../src/identity-lifecycle";
const userId="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const now=new Date("2026-10-24T08:00:00.000Z");
const writer=():SessionWriter=>({
 create:vi.fn(async()=>{}),revokeHash:vi.fn(async()=>1),revokeUser:vi.fn(async()=>2)
});
describe("isolated trusted identity session lifecycle contract",()=>{
 it("persists only the credential digest for a recently verified identity",async()=>{
  const db=writer();
  const result=await issueVerifiedSession(db,{userId,verifiedAt:new Date(now.getTime()-1000),authenticationMethod:"passkey"},now);
  expect(result.token).toMatch(/^[a-f0-9]{64}$/);
  expect(db.create).toHaveBeenCalledWith({userId,tokenHash:hashSessionToken(result.token),createdAt:now,
   expiresAt:new Date("2026-10-24T16:00:00.000Z")});
  expect(result).not.toHaveProperty("tokenHash");
 });
 it("rejects stale, future, malformed or unverifiable authentication",async()=>{
  const db=writer();
  for(const verified of [
   {userId,verifiedAt:new Date(now.getTime()-301000),authenticationMethod:"passkey"},
   {userId,verifiedAt:new Date(now.getTime()+31000),authenticationMethod:"passkey"},
   {userId:"invalid",verifiedAt:now,authenticationMethod:"passkey"},
   {userId,verifiedAt:now,authenticationMethod:"password"}
  ])await expect(issueVerifiedSession(db,verified as Parameters<typeof issueVerifiedSession>[1],now)).rejects.toThrow("UNVERIFIED_IDENTITY");
  expect(db.create).not.toHaveBeenCalled();
 });
 it("never returns a token when storing the hash fails",async()=>{
  const db=writer();db.create=vi.fn(async()=>{throw Error("DATABASE_UNAVAILABLE")});
  await expect(issueVerifiedSession(db,{userId,verifiedAt:now,authenticationMethod:"external-oidc"},now)).rejects.toThrow("DATABASE_UNAVAILABLE");
 });
 it("supports hash revocation and all-user revocation with strict identifiers",async()=>{
  const db=writer(),hash="a".repeat(64);
  expect(await revokePresentedSession(db,hash,now)).toBe(1);
  expect(db.revokeHash).toHaveBeenCalledWith({tokenHash:hash,revokedAt:now});
  expect(await revokeAllUserSessions(db,userId,now)).toBe(2);
  expect(db.revokeUser).toHaveBeenCalledWith({userId,revokedAt:now});
  await expect(revokePresentedSession(db,"invalid",now)).rejects.toThrow();
  await expect(revokeAllUserSessions(db,"invalid",now)).rejects.toThrow();
 });
});
