import { Pool, type PoolClient } from "pg";
import type { SessionWriter } from "./identity-lifecycle";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIGEST=/^[0-9a-f]{64}$/;
export type IdentitySessionWriter=SessionWriter & {
 issueProviderSession(args:{issuer:string;clientId:string;subject:string;tokenHash:string;createdAt:Date;expiresAt:Date}):Promise<string>;
 disableAccount(userId:string):Promise<number>;
 close():Promise<void>;
};
export function createPgIdentitySessionWriter(config:{
 connectionString:string; maxConnections?:number
}):IdentitySessionWriter {
 if("window" in globalThis)throw Error("SERVER_ONLY_RUNTIME");
 let uri:URL;
 try{uri=new URL(config.connectionString);}catch{throw Error("INVALID_IDENTITY_DATABASE_URL");}
 if(!["postgres:","postgresql:"].includes(uri.protocol)||!uri.hostname||uri.pathname.length<2||!uri.username)
  throw Error("INVALID_IDENTITY_DATABASE_URL");
 if(!["127.0.0.1","localhost","::1"].includes(uri.hostname)&&
   !["require","verify-ca","verify-full"].includes(uri.searchParams.get("sslmode")??""))
  throw Error("IDENTITY_TLS_REQUIRED");
 const max=config.maxConnections??2;
 if(!Number.isInteger(max)||max<1||max>5)throw Error("INVALID_IDENTITY_POOL_SIZE");
 const pool=new Pool({connectionString:config.connectionString,max,
  connectionTimeoutMillis:5000,idleTimeoutMillis:10000});
 async function authorized<T>(job:(client:PoolClient)=>Promise<T>):Promise<T>{
  const client=await pool.connect();
  try{
   const {rows}=await client.query<{unsafe:boolean}>(
    "SELECT (r.rolsuper OR r.rolbypassrls OR EXISTS ("+
    "SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "+
    "WHERE n.nspname='forma_saas' AND pg_has_role(current_user,c.relowner,'USAGE'))) AS unsafe "+
    "FROM pg_roles r WHERE r.rolname=current_user");
   if(!rows.length||rows[0].unsafe)throw Error("UNSAFE_IDENTITY_DATABASE_ROLE");
   return await job(client);
  }finally{client.release();}
 }
 return {
  // Server-only DB-bound resolver + session insert. This does NOT verify OIDC
  // signatures; only a reviewed trusted verifier may invoke the method.
  async issueProviderSession({issuer,clientId,subject,tokenHash,createdAt,expiresAt}){
   let uri:URL;
   try{uri=new URL(issuer);}catch{throw Error("INVALID_PROVIDER_SESSION");}
   if(uri.protocol!=="https:"||uri.href!==issuer||uri.username||uri.password||
     uri.search||uri.hash||issuer.length>512||
     typeof clientId!=="string"||clientId.length<3||clientId.length>256||
     typeof subject!=="string"||!subject.length||subject.length>255||
     /[\\s\\x00-\\x1f]/.test(clientId)||
     [...subject].some(ch=>ch.charCodeAt(0)<32||ch.charCodeAt(0)===127)||
     !DIGEST.test(tokenHash)||
     !(createdAt instanceof Date)||!Number.isFinite(createdAt.getTime())||
     !(expiresAt instanceof Date)||!Number.isFinite(expiresAt.getTime())||
     expiresAt.getTime()<=createdAt.getTime()||expiresAt.getTime()-createdAt.getTime()>8*3600*1000)
    throw Error("INVALID_PROVIDER_SESSION");
   return authorized(async client=>{
    const {rows}=await client.query<{user_id:string}>(
     'SELECT forma_saas.identity_issue_provider_session($1::text,$2::text,$3::text,$4::text,$5::timestamptz,$6::timestamptz) AS user_id',
     [issuer,clientId,subject,tokenHash,createdAt,expiresAt]);
    const userId=rows[0]?.user_id;
    if(!userId||!UUID.test(userId))throw Error("INVALID_PROVIDER_SESSION_RESULT");
    return userId;
   });
  },
  async create({userId,tokenHash,createdAt,expiresAt}){
   if(!UUID.test(userId)||!DIGEST.test(tokenHash)||
    !Number.isFinite(createdAt.getTime())||!Number.isFinite(expiresAt.getTime()))
     throw Error("INVALID_SESSION_INPUT");
   await authorized(async client=>{
    await client.query(
     "SELECT forma_saas.identity_issue_session($1::uuid,$2::text,$3::timestamptz,$4::timestamptz)",
     [userId,tokenHash,createdAt,expiresAt]);
   });
  },
  async revokeHash({tokenHash}){
   if(!DIGEST.test(tokenHash))throw Error("INVALID_SESSION_HASH");
   return authorized(async client=>{
    const {rows}=await client.query<{count:number}>(
     'SELECT forma_saas.identity_revoke_hash($1::text) AS "count"',[tokenHash]);
    return rows[0]?.count??0;
   });
  },
  async revokeUser({userId}){
   if(!UUID.test(userId))throw Error("INVALID_IDENTITY");
   return authorized(async client=>{
    const {rows}=await client.query<{count:number}>(
     'SELECT forma_saas.identity_revoke_user($1::uuid) AS "count"',[userId]);
    return rows[0]?.count??0;
   });
  },
  async disableAccount(userId){
   if(!UUID.test(userId))throw Error("INVALID_IDENTITY");
   return authorized(async client=>{
    const {rows}=await client.query<{count:number}>(
     'SELECT forma_saas.identity_disable_user($1::uuid) AS "count"',[userId]);
    return rows[0]?.count??0;
   });
  },
  close:()=>pool.end()
 };
}
