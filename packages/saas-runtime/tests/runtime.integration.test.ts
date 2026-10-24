import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { readFile } from "node:fs/promises";
import { createTenantRuntime } from "../src/runtime";
import { createSessionCredential,hashSessionToken } from "../src/session";
import { createPgIdentitySessionWriter } from "../src/identity-db-writer";
import { issueVerifiedSession } from "../src/identity-lifecycle";
import {createPgOidcFlowStore} from "../src/oidc-flow-db";
import {beginOidc,consumeOidc,type OidcConfig} from "../src/oidc-pkce-flow";
const adminUrl=process.env.SAAS_TEST_ADMIN_URL, appUrl=process.env.SAAS_TEST_APP_URL;
const A="11111111-1111-1111-1111-111111111111", B="22222222-2222-2222-2222-222222222222";
const user="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", stranger="bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const branchA="aaaaaaaa-1111-1111-1111-111111111111", branchB="bbbbbbbb-1111-1111-1111-111111111111";
const registerA="aaaaaaaa-2222-2222-2222-222222222222";
const memberA="aaaaaaaa-3333-3333-3333-333333333333", memberB="bbbbbbbb-3333-3333-3333-333333333333";
const productB="bbbbbbbb-4444-4444-4444-444444444444";
let admin:Pool, runtime:ReturnType<typeof createTenantRuntime>;
let actor:{userId:string}|null={userId:user};
const credential = createSessionCredential(), otherCredential = createSessionCredential();
let presentedToken: string | undefined = credential.token;
let sessions: ReturnType<typeof createTenantRuntime>;
function testUrl(value:string|undefined) {
 if(!value) throw new Error("Both test URLs required");
 const u=new URL(value);
 if(!["localhost","127.0.0.1"].includes(u.hostname)||u.pathname!=="/forma_saas_runtime_test")
  throw new Error("Refusing non-local/non-disposable database");
 return value;
}
if((adminUrl||appUrl)&&!(adminUrl&&appUrl)) throw new Error("Both test URLs required");
describe.skipIf(!adminUrl&&!appUrl)("Prisma 7 restricted-role tenant transactions",()=>{
 beforeAll(async()=>{
  admin=new Pool({connectionString:testUrl(adminUrl),max:1});testUrl(appUrl);
  if((await admin.query("SELECT to_regnamespace('forma_saas') AS schema")).rows[0].schema)
   throw new Error("Requires empty database; refusing to modify existing schema");
  for(const file of ["20261023_000001_tenant_foundation","20261024_000002_member_assignments","20261024_000003_revocable_sessions","20261024_000004_identity_functions","20261024_000005_provider_identity","20261024_000006_provider_identity_immutability","20261024_000007_oidc_flow_store"])
   await admin.query(await readFile(new URL(`../../../prisma/saas/migrations/${file}/migration.sql`,import.meta.url),"utf8"));
  await admin.query(`
   CREATE ROLE forma_runtime_test LOGIN PASSWORD 'runtime-test-only' NOSUPERUSER NOBYPASSRLS;
   CREATE ROLE forma_identity_test LOGIN PASSWORD 'identity-test-only' NOSUPERUSER NOBYPASSRLS;
   CREATE ROLE forma_identity_admin_test LOGIN PASSWORD 'identity-admin-test-only' NOSUPERUSER NOBYPASSRLS;
   CREATE ROLE forma_oidc_flow_test LOGIN PASSWORD 'oidc-flow-test-only' NOSUPERUSER NOBYPASSRLS;
   GRANT USAGE ON SCHEMA forma_saas TO forma_identity_test;
   GRANT EXECUTE ON FUNCTION forma_saas.identity_issue_session(uuid,text,timestamptz,timestamptz) TO forma_identity_test;
   GRANT EXECUTE ON FUNCTION forma_saas.identity_revoke_hash(text) TO forma_identity_test;
   GRANT EXECUTE ON FUNCTION forma_saas.identity_revoke_user(uuid) TO forma_identity_test;
   GRANT EXECUTE ON FUNCTION forma_saas.identity_disable_user(uuid) TO forma_identity_test;
   GRANT USAGE ON SCHEMA forma_saas TO forma_identity_admin_test;
   GRANT EXECUTE ON FUNCTION forma_saas.identity_issue_provider_session(text,text,text,text,timestamptz,timestamptz) TO forma_identity_test;
   GRANT EXECUTE ON FUNCTION forma_saas.identity_unlink_provider(text,text,text) TO forma_identity_admin_test;
   GRANT USAGE ON SCHEMA forma_saas TO forma_oidc_flow_test;
   GRANT EXECUTE ON FUNCTION forma_saas.oidc_flow_begin(text,text,text,text,timestamptz) TO forma_oidc_flow_test;
   GRANT EXECUTE ON FUNCTION forma_saas.oidc_flow_consume(text) TO forma_oidc_flow_test;
   GRANT USAGE ON SCHEMA forma_saas TO forma_runtime_test;
   GRANT SELECT ON forma_saas.tenant_membership,forma_saas.member_branch,forma_saas.member_register,
    forma_saas.branch,forma_saas.register,forma_saas.product,
    forma_saas.app_session,forma_saas.app_user TO forma_runtime_test;
   GRANT INSERT ON forma_saas.product TO forma_runtime_test;
   INSERT INTO forma_saas.app_user(id,email_normalized) VALUES ('${user}','user@example.test');
   INSERT INTO forma_saas.tenant(id,slug,legal_name) VALUES ('${A}','a','A'),('${B}','b','B');
   INSERT INTO forma_saas.branch(id,tenant_id,code,name) VALUES ('${branchA}','${A}','A','A'),('${branchB}','${B}','B','B');
   INSERT INTO forma_saas.register(id,tenant_id,branch_id,code) VALUES ('${registerA}','${A}','${branchA}','A');
   INSERT INTO forma_saas.tenant_membership(id,tenant_id,user_id,role) VALUES
    ('${memberA}','${A}','${user}','CASHIER'),('${memberB}','${B}','${user}','CASHIER');
   INSERT INTO forma_saas.member_branch VALUES ('${A}','${memberA}','${branchA}'),('${B}','${memberB}','${branchB}');
   INSERT INTO forma_saas.member_register VALUES ('${A}','${memberA}','${branchA}','${registerA}');
   INSERT INTO forma_saas.product(tenant_id,sku,name,price_minor) VALUES ('${A}','A','Product A',500);
   INSERT INTO forma_saas.product(id,tenant_id,sku,name,price_minor) VALUES ('${productB}','${B}','B','Product B',700);
  `);
  await admin.query("INSERT INTO forma_saas.app_user(id,email_normalized) VALUES ($1,'stranger@example.test')",[stranger]);
  for (const [hash, id] of [[credential.tokenHash,user],[otherCredential.tokenHash,stranger]])
   await admin.query("INSERT INTO forma_saas.app_session(token_hash,user_id,expires_at) VALUES ($1,$2,now()+interval '1 hour')",[hash,id]);
  sessions=createTenantRuntime({connectionString:appUrl!,readSessionToken:async()=>presentedToken,poolSize:1});
  runtime=createTenantRuntime({connectionString:appUrl!,resolveSession:async()=>actor,poolSize:1});
 });
 afterAll(async()=>{await runtime?.close();await sessions?.close();await admin?.end();});
 it("isolates twenty alternating tenant requests reusing one pooled connection",async()=>{
  const results=await Promise.all(Array.from({length:20},(_,i)=>runtime.listProducts(i%2?B:A)));
  results.forEach((rows,i)=>expect(rows.map(p=>p.sku)).toEqual([i%2?"B":"A"]));
  expect(results[0][0].priceMinor).toBe(500n);
 });
 it("requires an authenticated session and live membership",async()=>{
  try {
   actor=null;await expect(runtime.listProducts(A)).rejects.toMatchObject({reason:"UNAUTHENTICATED"});
   actor={userId:stranger};await expect(runtime.listProducts(A)).rejects.toMatchObject({reason:"FORBIDDEN"});
  } finally {actor={userId:user};}
 });
 it("rejects forged branch and cashier privileges before callback",async()=>{
  let called=false;const work=async()=>{called=true;};
  await expect(runtime.withTenant({tenantId:A,branchId:branchB,capability:"sales.read"},work)).rejects.toMatchObject({reason:"FORBIDDEN"});
  await expect(runtime.withTenant({tenantId:A,branchId:branchA,capability:"inventory.adjust"},work)).rejects.toMatchObject({reason:"FORBIDDEN"});
  expect(called).toBe(false);
 });
 it("rechecks stored register assignments",async()=>{
  const selection={tenantId:A,branchId:branchA,registerId:registerA,capability:"checkout.create" as const};
  expect(await runtime.withTenant(selection,async(_tx,scope)=>scope.registerId)).toBe(registerA);
  await admin.query("DELETE FROM forma_saas.member_register WHERE membership_id=$1",[memberA]);
  try {
   await expect(runtime.withTenant(selection,async()=>true)).rejects.toMatchObject({reason:"FORBIDDEN"});
  } finally {
   await admin.query("INSERT INTO forma_saas.member_register(tenant_id,membership_id,branch_id,register_id) VALUES ($1,$2,$3,$4)",[A,memberA,branchA,registerA]);
  }
 });
 it("blocks suspended tenant checkout while preserving authorized catalog reads",async()=>{
  const selection={tenantId:A,branchId:branchA,registerId:registerA,capability:"checkout.create" as const};
  await admin.query("UPDATE forma_saas.tenant SET status='SUSPENDED' WHERE id=$1",[A]);
  try{
   await expect(runtime.withTenant(selection,async()=>true)).rejects.toMatchObject({reason:"FORBIDDEN"});
   expect((await runtime.listProducts(A)).map(p=>p.sku)).toEqual(["A"]);
   expect((await runtime.listProducts(B)).map(p=>p.sku)).toEqual(["B"]);
  }finally{
   await admin.query("UPDATE forma_saas.tenant SET status='TRIALING' WHERE id=$1",[A]);
  }
 });
 it("denies membership revoked after session authentication",async()=>{
  await admin.query("UPDATE forma_saas.tenant_membership SET status='REVOKED' WHERE id=$1",[memberA]);
  try {await expect(runtime.listProducts(A)).rejects.toMatchObject({reason:"FORBIDDEN"});}
  finally {await admin.query("UPDATE forma_saas.tenant_membership SET status='ACTIVE' WHERE id=$1",[memberA]);}
 });
 it("RLS prevents forged product reads and cross-tenant inserts",async()=>{
  expect(await runtime.withTenant({tenantId:A,capability:"products.read"},tx=>tx.product.findMany({where:{id:productB}}))).toEqual([]);
  await expect(runtime.withTenant({tenantId:A,capability:"products.read"},tx=>tx.product.create({data:{tenantId:B,sku:"attack",name:"attack",priceMinor:1n}}))).rejects.toThrow();
  expect((await runtime.listProducts(B)).map(p=>p.sku)).toEqual(["B"]);
 });
 it("rolls back failure and cleans context before another tenant reuses the pool",async()=>{
  await expect(runtime.withTenant({tenantId:A,capability:"products.read"},async tx=>{
   await tx.product.create({data:{tenantId:A,sku:"rollback",name:"rollback",priceMinor:1n}});
   throw new Error("expected_failure");
  })).rejects.toThrow("expected_failure");
  expect((await runtime.listProducts(A)).map(p=>p.sku)).toEqual(["A"]);
  expect((await runtime.listProducts(B)).map(p=>p.sku)).toEqual(["B"]);
 });
 it("refuses migration-owner credentials",async()=>{
  const unsafe=createTenantRuntime({connectionString:adminUrl!,resolveSession:async()=>({userId:user})});
  try {await expect(unsafe.listProducts(A)).rejects.toThrow("UNSAFE_SAAS_DATABASE_ROLE");}finally{await unsafe.close();}
 });
 it("DB rejects cross-tenant assignment even for migrator",async()=>{
  await expect(admin.query("INSERT INTO forma_saas.member_branch VALUES ($1,$2,$3)",[A,memberA,branchB])).rejects.toThrow();
 });
 it("authenticates stored opaque sessions before tenant membership lookup",async()=>{
  expect((await sessions.listProducts(A)).map(p=>p.sku)).toEqual(["A"]);
  try {
   presentedToken=otherCredential.token;
   await expect(sessions.listProducts(A)).rejects.toMatchObject({reason:"FORBIDDEN"});
  } finally {presentedToken=credential.token;}
 });
 it("rejects missing, malformed, forged and stored-hash-as-token credentials",async()=>{
  try {
   for(const token of [undefined,"demo","a".repeat(64),credential.tokenHash]) {
    presentedToken=token;
    await expect(sessions.listProducts(A)).rejects.toMatchObject({reason:"UNAUTHENTICATED"});
   }
  } finally {presentedToken=credential.token;}
 });
 it("rechecks revocation on the next request using the same pool",async()=>{
  await sessions.listProducts(A);
  await admin.query("UPDATE forma_saas.app_session SET revoked_at=now() WHERE token_hash=$1",[credential.tokenHash]);
  try {await expect(sessions.listProducts(A)).rejects.toMatchObject({reason:"UNAUTHENTICATED"});}
  finally {await admin.query("UPDATE forma_saas.app_session SET revoked_at=NULL WHERE token_hash=$1",[credential.tokenHash]);}
 });
 it("rejects expired sessions using database time",async()=>{
  await admin.query("UPDATE forma_saas.app_session SET created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' WHERE token_hash=$1",[credential.tokenHash]);
  try {await expect(sessions.listProducts(A)).rejects.toMatchObject({reason:"UNAUTHENTICATED"});}
  finally {await admin.query("UPDATE forma_saas.app_session SET created_at=now(),expires_at=now()+interval '1 hour' WHERE token_hash=$1",[credential.tokenHash]);}
 });
 it("rejects disabled account before any business callback",async()=>{
  await admin.query("UPDATE forma_saas.app_user SET status='DISABLED' WHERE id=$1",[user]);
  let called=false;
  try {
   await expect(sessions.withTenant({tenantId:A,capability:"products.read"},async()=>{called=true;}))
    .rejects.toMatchObject({reason:"UNAUTHENTICATED"});
   expect(called).toBe(false);
  } finally {await admin.query("UPDATE forma_saas.app_user SET status='ACTIVE' WHERE id=$1",[user]);}
 });
 it("limits identity reads to the presented session and denies session minting",async()=>{
  const rows=await sessions.withTenant({tenantId:A,capability:"products.read"},async tx=>({
   sessions: await tx.appSession.findMany(), users: await tx.appUser.findMany()
  }));
  expect(rows.sessions.map(s=>s.tokenHash)).toEqual([credential.tokenHash]);
  expect(rows.users.map(u=>u.id)).toEqual([user]);
  await expect(sessions.withTenant({tenantId:A,capability:"products.read"},tx=>
   tx.appSession.create({data:{tokenHash:createSessionCredential().tokenHash,userId:user,expiresAt:new Date(Date.now()+60000)}})))
   .rejects.toThrow();
  // A fresh raw pooled connection without session context sees no identity rows.
  const raw=new Pool({connectionString:appUrl,max:1});
  try {
   expect((await raw.query("SELECT * FROM forma_saas.app_session")).rows).toEqual([]);
   expect((await raw.query("SELECT * FROM forma_saas.app_user")).rows).toEqual([]);
  } finally {await raw.end();}
 });
 it("clears session context after rollback and alternates authenticated actors",async()=>{
  await expect(sessions.withTenant({tenantId:A,capability:"products.read"},async()=>{throw new Error("session_rollback");}))
   .rejects.toThrow("session_rollback");
  for(let i=0;i<6;i++) {
   presentedToken=otherCredential.token;
   await expect(sessions.listProducts(A)).rejects.toMatchObject({reason:"FORBIDDEN"});
   presentedToken=credential.token;
   expect((await sessions.listProducts(B)).map(p=>p.sku)).toEqual(["B"]);
  }
 });
 it("rejects excessive session lifetime at the database boundary",async()=>{
  await expect(admin.query("INSERT INTO forma_saas.app_session(token_hash,user_id,expires_at) VALUES ($1,$2,now()+interval '9 hours')",[createSessionCredential().tokenHash,user]))
   .rejects.toThrow();
 });

 it("M30 identity writer uses a distinct role, stores hashes, and disables sessions atomically",async()=>{
  const identityUrl="postgresql://forma_identity_test:identity-test-only@127.0.0.1:5432/forma_saas_runtime_test";
  const writer=createPgIdentitySessionWriter({connectionString:identityUrl,maxConnections:1});
  const probe=new Pool({connectionString:identityUrl,max:1});
  const tenantProbe=new Pool({connectionString:appUrl!,max:1});
  const issued=createSessionCredential();
  try{
   await expect(probe.query("SELECT * FROM forma_saas.app_session")).rejects.toThrow();
   await expect(probe.query("INSERT INTO forma_saas.app_session(token_hash,user_id,expires_at) VALUES ($1,$2,now())",[issued.tokenHash,user])).rejects.toThrow();
   await expect(tenantProbe.query("SELECT forma_saas.identity_disable_user($1::uuid)",[user])).rejects.toThrow();
   const created=await issueVerifiedSession(writer,{userId:user,verifiedAt:new Date(),authenticationMethod:"passkey"});
   const hash=createSessionCredential();
   expect(created.token).toMatch(/^[0-9a-f]{64}$/);
   const sessionsForUser=await admin.query("SELECT token_hash FROM forma_saas.app_session WHERE user_id=$1 AND token_hash=$2",[user,hashSessionToken(created.token)]);
   expect(sessionsForUser.rowCount).toBe(1);
   await writer.create({userId:user,tokenHash:issued.tokenHash,createdAt:new Date(),expiresAt:new Date(Date.now()+60000)});
   expect(await writer.revokeHash({tokenHash:issued.tokenHash,revokedAt:new Date()})).toBe(1);
   expect(await writer.revokeHash({tokenHash:issued.tokenHash,revokedAt:new Date()})).toBe(0);
   expect(await writer.revokeUser({userId:user,revokedAt:new Date()})).toBeGreaterThanOrEqual(1);
   const extra=await issueVerifiedSession(writer,{userId:user,verifiedAt:new Date(),authenticationMethod:"external-oidc"});
   expect(extra.token).toBeTruthy();
   expect(await writer.disableAccount(user)).toBeGreaterThanOrEqual(1);
   await expect(issueVerifiedSession(writer,{userId:user,verifiedAt:new Date(),authenticationMethod:"passkey"})).rejects.toThrow();
   const revoked=await admin.query("SELECT count(*)::int AS count FROM forma_saas.app_session WHERE user_id=$1 AND revoked_at IS NULL",[user]);
   expect(revoked.rows[0].count).toBe(0);
  }finally{
   await admin.query("UPDATE forma_saas.app_user SET status='ACTIVE' WHERE id=$1",[user]);
   await admin.query("UPDATE forma_saas.app_session SET revoked_at=NULL WHERE token_hash=$1",[credential.tokenHash]);
   await writer.close();await probe.end();await tenantProbe.end();
  }
 });
 it("M30 provider SQL permits only prelinked active accounts with identity role grants",async()=>{
  const linked="cccccccc-cccc-cccc-cccc-cccccccccccc";
  const issuer="https://login.example.test/tenant",clientId="forma-oidc",subject="approved-opaque-subject";
  const url="postgresql://forma_identity_test:identity-test-only@127.0.0.1:5432/forma_saas_runtime_test";
  const writer=createPgIdentitySessionWriter({connectionString:url,maxConnections:2});
  const rolePool=new Pool({connectionString:url,max:1});
  const tenantPool=new Pool({connectionString:appUrl!,max:1});
  const issued=createSessionCredential();
  try{
    await admin.query("INSERT INTO forma_saas.app_user(id,email_normalized) VALUES($1,$2)",[linked,"linked@example.test"]);
    await admin.query("INSERT INTO forma_saas.provider_identity(issuer,client_id,subject,user_id) VALUES($1,$2,$3,$4)",
      [issuer,clientId,subject,linked]);
    await expect(rolePool.query("SELECT * FROM forma_saas.provider_identity")).rejects.toThrow();
    await expect(tenantPool.query(
      "SELECT forma_saas.identity_issue_provider_session($1,$2,$3,$4,now(),now()+interval '1 hour')",
      [issuer,clientId,subject,createSessionCredential().tokenHash])).rejects.toThrow();
    await expect(rolePool.query("SELECT forma_saas.identity_unlink_provider($1,$2,$3)",[issuer,clientId,subject])).rejects.toThrow();
    await expect(writer.issueProviderSession({
      issuer,clientId,subject:"wrong-subject",tokenHash:createSessionCredential().tokenHash,
      createdAt:new Date(),expiresAt:new Date(Date.now()+60000)
    })).rejects.toThrow();
    const userId=await writer.issueProviderSession({
      issuer,clientId,subject,tokenHash:issued.tokenHash,
      createdAt:new Date(),expiresAt:new Date(Date.now()+60000)
    });
    expect(userId).toBe(linked);
    const row=await admin.query("SELECT user_id,revoked_at FROM forma_saas.app_session WHERE token_hash=$1",[issued.tokenHash]);
    expect(row.rows).toMatchObject([{user_id:linked,revoked_at:null}]);
    await admin.query("UPDATE forma_saas.provider_identity SET status='REVOKED' WHERE issuer=$1 AND client_id=$2 AND subject=$3",
      [issuer,clientId,subject]);
    await expect(writer.issueProviderSession({
      issuer,clientId,subject,tokenHash:createSessionCredential().tokenHash,
      createdAt:new Date(),expiresAt:new Date(Date.now()+60000)
    })).rejects.toThrow();
    await admin.query("UPDATE forma_saas.provider_identity SET status='ACTIVE' WHERE issuer=$1 AND client_id=$2 AND subject=$3",
      [issuer,clientId,subject]);
    await admin.query("UPDATE forma_saas.app_user SET status='DISABLED' WHERE id=$1",[linked]);
    await expect(writer.issueProviderSession({
      issuer,clientId,subject,tokenHash:createSessionCredential().tokenHash,
      createdAt:new Date(),expiresAt:new Date(Date.now()+60000)
    })).rejects.toThrow();
  }finally{
    await admin.query("DELETE FROM forma_saas.app_session WHERE user_id=$1",[linked]);
    await admin.query("DELETE FROM forma_saas.provider_identity WHERE user_id=$1",[linked]);
    await admin.query("DELETE FROM forma_saas.app_user WHERE id=$1",[linked]);
    await writer.close();await rolePool.end();await tenantPool.end();
  }
 });
 it("M30 simultaneous identity issuance and unlink never leaves a valid session",async()=>{
  const linked="dddddddd-dddd-dddd-dddd-dddddddddddd";
  const issuer="https://login.example.test/tenant",clientId="forma-oidc",subject="concurrent-link-subject";
  const writer=createPgIdentitySessionWriter({
    connectionString:"postgresql://forma_identity_test:identity-test-only@127.0.0.1:5432/forma_saas_runtime_test",
    maxConnections:2
  });
  const unlinkPool=new Pool({
    connectionString:"postgresql://forma_identity_admin_test:identity-admin-test-only@127.0.0.1:5432/forma_saas_runtime_test",max:1
  });
  try{
    await admin.query("INSERT INTO forma_saas.app_user(id,email_normalized) VALUES($1,$2)",[linked,"race@example.test"]);
    await admin.query("INSERT INTO forma_saas.provider_identity(issuer,client_id,subject,user_id) VALUES($1,$2,$3,$4)",
      [issuer,clientId,subject,linked]);
    const attempts=Array.from({length:8},()=>createSessionCredential().tokenHash);
    // Whether issuance or unlink obtains the account lock first, the end state
    // MUST contain zero active sessions. An issue after unlink must fail.
    const settled=await Promise.allSettled([
      ...attempts.map(async tokenHash=>writer.issueProviderSession({
        issuer,clientId,subject,tokenHash,createdAt:new Date(),expiresAt:new Date(Date.now()+60000)
      })),
      unlinkPool.query("SELECT forma_saas.identity_unlink_provider($1,$2,$3)",[issuer,clientId,subject])
    ]);
    expect(settled.at(-1)?.status).toBe("fulfilled");
    const result=await admin.query(
      "SELECT count(*)::int AS active FROM forma_saas.app_session WHERE user_id=$1 AND revoked_at IS NULL",[linked]);
    expect(result.rows[0].active).toBe(0);
    const link=await admin.query("SELECT status FROM forma_saas.provider_identity WHERE issuer=$1 AND client_id=$2 AND subject=$3",
      [issuer,clientId,subject]);
    expect(link.rows[0].status).toBe("REVOKED");
    await expect(writer.issueProviderSession({
      issuer,clientId,subject,tokenHash:createSessionCredential().tokenHash,
      createdAt:new Date(),expiresAt:new Date(Date.now()+60000)
    })).rejects.toThrow();
  }finally{
    await admin.query("DELETE FROM forma_saas.app_session WHERE user_id=$1",[linked]);
    await admin.query("DELETE FROM forma_saas.provider_identity WHERE user_id=$1",[linked]);
    await admin.query("DELETE FROM forma_saas.app_user WHERE id=$1",[linked]);
    await writer.close();await unlinkPool.end();
  }
 });
 it("M30 provider identity keys and account links cannot be reassigned",async()=>{
  const first="eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
  const second="ffffffff-ffff-ffff-ffff-ffffffffffff";
  const issuer="https://login.example.test/tenant",clientId="forma-oidc",subject="fixed-owner-subject";
  const writer=createPgIdentitySessionWriter({
   connectionString:"postgresql://forma_identity_test:identity-test-only@127.0.0.1:5432/forma_saas_runtime_test",maxConnections:1
  });
  const token=createSessionCredential();
  try{
   await admin.query("INSERT INTO forma_saas.app_user(id,email_normalized) VALUES ($1,$2),($3,$4)",
    [first,"immutable-first@example.test",second,"immutable-second@example.test"]);
   await admin.query("INSERT INTO forma_saas.provider_identity(issuer,client_id,subject,user_id) VALUES ($1,$2,$3,$4)",
    [issuer,clientId,subject,first]);
   await expect(admin.query("UPDATE forma_saas.provider_identity SET user_id=$1 WHERE issuer=$2 AND client_id=$3 AND subject=$4",
    [second,issuer,clientId,subject])).rejects.toThrow("PROVIDER_IDENTITY_IMMUTABLE");
   await expect(admin.query("UPDATE forma_saas.provider_identity SET subject=$1 WHERE issuer=$2 AND client_id=$3 AND subject=$4",
    ["rewritten-subject",issuer,clientId,subject])).rejects.toThrow("PROVIDER_IDENTITY_IMMUTABLE");
   expect(await writer.issueProviderSession({
    issuer,clientId,subject,tokenHash:token.tokenHash,createdAt:new Date(),expiresAt:new Date(Date.now()+60000)
   })).toBe(first);
   const saved=await admin.query("SELECT user_id FROM forma_saas.app_session WHERE token_hash=$1",[token.tokenHash]);
   expect(saved.rows[0].user_id).toBe(first);
   expect(saved.rows[0].user_id).not.toBe(second);
  }finally{
   await admin.query("DELETE FROM forma_saas.app_session WHERE user_id=$1",[first]);
   await admin.query("DELETE FROM forma_saas.provider_identity WHERE user_id=$1",[first]);
   await admin.query("DELETE FROM forma_saas.app_user WHERE id IN ($1,$2)",[first,second]);
   await writer.close();
  }
 });
 it("M30 durable PostgreSQL OIDC state is consumed at most once across instances",async()=>{
  const url="postgresql://forma_oidc_flow_test:oidc-flow-test-only@127.0.0.1:5432/forma_saas_runtime_test";
  const config:OidcConfig={issuer:"https://login.example.test/tenant",
   authorizationEndpoint:"https://login.example.test/authorize",
   tokenEndpoint:"https://login.example.test/token",clientId:"forma-oidc",
   redirectUri:"https://pos.example.test/auth/callback"};
  const a=createPgOidcFlowStore({connectionString:url});
  const b=createPgOidcFlowStore({connectionString:url});
  const tenant=new Pool({connectionString:appUrl!,max:1});
  const direct=new Pool({connectionString:url,max:1});
  try{
   await expect(direct.query("SELECT * FROM forma_saas.oidc_auth_flow")).rejects.toThrow();
   await expect(tenant.query("SELECT * FROM forma_saas.oidc_flow_consume($1)",["a".repeat(64)])).rejects.toThrow();
   const start=await beginOidc(config,a),state=new URL(start.url).searchParams.get("state")!;
   const params=new URLSearchParams({state,code:"server-only-code"});
   const result=await Promise.allSettled([consumeOidc(config,a,params),consumeOidc(config,b,params)]);
   expect(result.filter(x=>x.status==="fulfilled")).toHaveLength(1);
   expect(result.filter(x=>x.status==="rejected")).toHaveLength(1);
   const declined=await beginOidc(config,a);
   const invalid=new URLSearchParams({state:new URL(declined.url).searchParams.get("state")!,error:"access_denied"});
   await expect(consumeOidc(config,b,invalid)).rejects.toThrow("PROVIDER_REJECTED");
   await expect(consumeOidc(config,a,invalid)).rejects.toThrow("EXPIRED_OR_REPLAYED_STATE");
  }finally{await a.close();await b.close();await direct.end();await tenant.end();}
 });
 it("rejects a pool carrying non-local session context",async()=>{
  const dirty=createTenantRuntime({connectionString:appUrl!,readSessionToken:async()=>credential.token,poolSize:1});
  try {
   await dirty.withTenant({tenantId:A,capability:"products.read"},async tx=>{
    await tx.$queryRaw`SELECT set_config('app.session_hash', ${credential.tokenHash}, false)`;
   });
   await expect(dirty.listProducts(A)).rejects.toThrow("DIRTY_TENANT_CONNECTION");
  } finally {await dirty.close();}
 });

});
