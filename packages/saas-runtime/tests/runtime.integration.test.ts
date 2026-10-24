import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { readFile } from "node:fs/promises";
import { createTenantRuntime } from "../src/runtime";
const adminUrl=process.env.SAAS_TEST_ADMIN_URL, appUrl=process.env.SAAS_TEST_APP_URL;
const A="11111111-1111-1111-1111-111111111111", B="22222222-2222-2222-2222-222222222222";
const user="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", stranger="bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const branchA="aaaaaaaa-1111-1111-1111-111111111111", branchB="bbbbbbbb-1111-1111-1111-111111111111";
const registerA="aaaaaaaa-2222-2222-2222-222222222222";
const memberA="aaaaaaaa-3333-3333-3333-333333333333", memberB="bbbbbbbb-3333-3333-3333-333333333333";
const productB="bbbbbbbb-4444-4444-4444-444444444444";
let admin:Pool, runtime:ReturnType<typeof createTenantRuntime>;
let actor:{userId:string}|null={userId:user};
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
  for(const file of ["20261023_000001_tenant_foundation","20261024_000002_member_assignments"])
   await admin.query(await readFile(new URL(`../../../prisma/saas/migrations/${file}/migration.sql`,import.meta.url),"utf8"));
  await admin.query(`
   CREATE ROLE forma_runtime_test LOGIN PASSWORD 'runtime-test-only' NOSUPERUSER NOBYPASSRLS;
   GRANT USAGE ON SCHEMA forma_saas TO forma_runtime_test;
   GRANT SELECT ON forma_saas.tenant_membership,forma_saas.member_branch,forma_saas.member_register,
    forma_saas.branch,forma_saas.register,forma_saas.product TO forma_runtime_test;
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
  runtime=createTenantRuntime({connectionString:appUrl!,resolveSession:async()=>actor,poolSize:1});
 });
 afterAll(async()=>{await runtime?.close();await admin?.end();});
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
  await expect(runtime.withTenant(selection,async()=>true)).rejects.toMatchObject({reason:"FORBIDDEN"});
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
});
