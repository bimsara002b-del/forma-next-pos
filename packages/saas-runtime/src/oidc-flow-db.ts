import {Pool,type PoolClient} from "pg";
import type {PendingFlow,FlowStore} from "./oidc-pkce-flow";
const sha256=/^[0-9a-f]{64}$/;
const random43=/^[A-Za-z0-9_-]{43}$/;
/** Server-only OIDC flow persistence; this does NOT verify an ID token. */
export function createPgOidcFlowStore(config:{connectionString:string;maxConnections?:number}):
 FlowStore & {close():Promise<void>} {
 if("window" in globalThis)throw Error("SERVER_ONLY_RUNTIME");
 let url:URL;
 try{url=new URL(config.connectionString);}catch{throw Error("INVALID_OIDC_DB_URL");}
 if(!["postgres:","postgresql:"].includes(url.protocol)||!url.username||!url.hostname||
    url.pathname.length<2)throw Error("INVALID_OIDC_DB_URL");
 if(!["localhost","127.0.0.1","::1"].includes(url.hostname)&&
    !["require","verify-full","verify-ca"].includes(url.searchParams.get("sslmode")??""))
    throw Error("OIDC_DB_TLS_REQUIRED");
 const max=config.maxConnections??2;
 if(!Number.isInteger(max)||max<1||max>5)throw Error("INVALID_OIDC_POOL_SIZE");
 const pool=new Pool({connectionString:config.connectionString,max,
  connectionTimeoutMillis:5000,idleTimeoutMillis:10000});
 async function restricted<T>(work:(client:PoolClient)=>Promise<T>):Promise<T>{
  const client=await pool.connect();
  try{
   const {rows}=await client.query<{unsafe:boolean}>(
    "SELECT (r.rolsuper OR r.rolbypassrls OR EXISTS("+
    "SELECT 1 FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid "+
    "WHERE n.nspname='forma_saas' AND pg_has_role(current_user,c.relowner,'USAGE')"+
    ")) AS unsafe FROM pg_roles r WHERE r.rolname=current_user");
   if(!rows.length||rows[0].unsafe)throw Error("UNSAFE_OIDC_DATABASE_ROLE");
   return await work(client);
  }finally{client.release();}
 }
 return {
  async create(flow:PendingFlow){
   if(!flow||!sha256.test(flow.digest)||!random43.test(flow.verifier)||
      !random43.test(flow.nonce)||!sha256.test(flow.configHash)||
      !Number.isSafeInteger(flow.expires)||flow.expires<=Date.now()||
      flow.expires>Date.now()+300000)throw Error("INVALID_OIDC_FLOW");
   await restricted(async client=>{
    await client.query(
     "SELECT forma_saas.oidc_flow_begin($1::text,$2::text,$3::text,$4::text,$5::timestamptz)",
     [flow.digest,flow.verifier,flow.nonce,flow.configHash,new Date(flow.expires)]);
   });
  },
  async consume(digest:string){
   if(!sha256.test(digest))throw Error("INVALID_OIDC_DIGEST");
   return restricted(async client=>{
    const {rows}=await client.query<{
      digest:string;verifier:string;nonce:string;config_hash:string;expires_at:Date
    }>("SELECT * FROM forma_saas.oidc_flow_consume($1::text)",[digest]);
    const row=rows[0];
    if(!row)return null;
    if(!(row.expires_at instanceof Date)||!Number.isFinite(row.expires_at.getTime())||
       !sha256.test(row.digest)||!sha256.test(row.config_hash)||
       !random43.test(row.verifier)||!random43.test(row.nonce))
       throw Error("INVALID_OIDC_FLOW_RECORD");
    return {digest:row.digest,verifier:row.verifier,nonce:row.nonce,
       configHash:row.config_hash,expires:row.expires_at.getTime()};
   });
  },
  close:()=>pool.end()
 };
}
