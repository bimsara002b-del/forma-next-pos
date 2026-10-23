"use client";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { SuperAdminLogout } from "./super-admin-logout";

type Account = { id:string;username:string;displayName:string;role:string;isActive:boolean;createdAt:string };
type Audit = {id:string;action:string;actorId:string;targetId:string;createdAt:string};
type Payload = {overview:{totalUsers:number;activeUsers:number;ownerUsers:number;activeOwners:number};accounts:Account[];events:Audit[]};
const initial:Payload = { overview:{totalUsers:0,activeUsers:0,ownerUsers:0,activeOwners:0},accounts:[],events:[] };
async function api<T>(url:string,options?:RequestInit):Promise<T> {
 const response=await fetch(url,{cache:"no-store",...options});
 const body: {error?:string}&T=await response.json();
 if(!response.ok) throw new Error(body.error??"Request failed.");
 return body;
}
export function SuperAdminConsole({name}:{name:string}) {
 const router=useRouter();
 const [data,setData]=useState<Payload>(initial);
 const [tab,setTab]=useState<"overview"|"accounts"|"security">("overview");
 const [query,setQuery]=useState("");
 const [roleFilter,setRoleFilter]=useState("ALL");
 const [busy,setBusy]=useState(false);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const [newUsername,setNewUsername]=useState("");
 const [displayName,setDisplayName]=useState("");
 const [newRole,setNewRole]=useState("OWNER");
 const [newPassword,setNewPassword]=useState("");
 const [currentPassword,setCurrentPassword]=useState("");
 const [replacementPassword,setReplacementPassword]=useState("");
 const reload=useCallback(async()=>{setData(await api<Payload>("/api/super-admin"));},[]);
 useEffect(()=>{let cancelled=false;
  void api<Payload>("/api/super-admin").then(value=>{if(!cancelled)setData(value);})
   .catch(e=>{if(!cancelled)setError(e instanceof Error?e.message:"Unable to load.");})
   .finally(()=>{if(!cancelled)setLoading(false);});
  return()=>{cancelled=true;};
 },[]);
 const filtered=useMemo(()=>data.accounts.filter(a=>
  (roleFilter==="ALL"||a.role===roleFilter)&&
  [a.username,a.displayName,a.role].some(v=>v.toLowerCase().includes(query.toLowerCase()))
 ),[data.accounts,query,roleFilter]);
 async function submit(event:FormEvent<HTMLFormElement>) {
  event.preventDefault();setBusy(true);setError("");setNotice("");
  try {
   await api("/api/super-admin",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({username:newUsername,displayName,password:newPassword,role:newRole})});
   setNewUsername("");setDisplayName("");setNewPassword("");
   await reload();setNotice("Local store account created. Share credentials privately.");
  } catch(e){setError(e instanceof Error?e.message:"Account creation failed.");}
  finally{setBusy(false);}
 }
 async function act(account:Account,type:"activate"|"deactivate"|"reset_password"){
  if(busy)return;
  let password:string|undefined;
  if(type==="reset_password") {
   const entered=window.prompt("Enter a new temporary password (12–128 characters):");
   if(entered===null)return;
   if(entered.length<12||entered.length>128){setError("Password must be 12–128 characters.");return;}
   password=entered;
  } else if(!window.confirm((type==="activate"?"Activate":"Deactivate")+" "+account.username+"?"))return;
  setBusy(true);setError("");setNotice("");
  try {
   await api("/api/super-admin",{method:"PATCH",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({type,targetId:account.id,...(password?{password}:{})})});
   await reload();setNotice(type==="reset_password"?"Password reset. Previous sessions invalidated.":"Account status updated.");
  } catch(e){setError(e instanceof Error?e.message:"Account update failed.");}
  finally{setBusy(false);}
 }
 async function changePassword(event:FormEvent<HTMLFormElement>){
  event.preventDefault();setBusy(true);setError("");setNotice("");
  try{
   await api("/api/super-admin/password",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({currentPassword,newPassword:replacementPassword})});
   setCurrentPassword("");setReplacementPassword("");
   router.replace("/login");router.refresh();
  }catch(e){setError(e instanceof Error?e.message:"Password update failed.");setBusy(false);}
 }
 return <main className="platform-root">
  <div className="platform-shell">
   <header className="platform-top">
    <div className="platform-brand"><span className="platform-emblem">◈</span><div><strong>FORMA <span>NEXTPOS</span></strong><small>Platform Control Center</small></div></div>
    <div className="platform-user"><span className="platform-avatar">SA</span><div><strong>{name}</strong><small>Super Administrator</small></div><SuperAdminLogout/></div>
   </header>
   <div className="platform-body">
    <aside className="platform-side">
      <div className="platform-side-title">WORKSPACE</div>
      {([["overview","◫","Overview"],["accounts","♙","Store Accounts"],["security","⚿","Security"]] as const).map(([id,emoji,label])=>
       <button key={id} className={"platform-nav "+(tab===id?"active":"")} onClick={()=>{setTab(id);setError("");setNotice("");}}><span>{emoji}</span>{label}</button>)}
      <div className="platform-side-note"><strong>Local development pilot</strong><p>Multi-tenant organizations, billing and subscription management are not yet implemented.</p></div>
    </aside>
    <section className="platform-main">
     <div className="platform-heading"><div><span className="platform-kicker">PLATFORM ADMINISTRATION</span><h1>{tab==="overview"?"Overview":tab==="accounts"?"Store accounts":"Security settings"}</h1>
      <p>{tab==="overview"?"Monitor local staff account activity and status.":tab==="accounts"?"Manage local store staff without exposing credentials.":"Protect the platform administrator account."}</p></div>
      <span className="platform-environment">● Private pilot</span>
     </div>
     {error&&<div className="platform-message error" role="alert">{error}</div>}
     {notice&&<div className="platform-message" role="status">{notice}</div>}
     {loading?<div className="platform-panel">Loading platform accounts…</div>:tab==="overview"?<>
      <div className="platform-stats">
       {[["Total accounts",data.overview.totalUsers,"Local staff"],["Active accounts",data.overview.activeUsers,"Enabled users"],["Store owners",data.overview.ownerUsers,"Owner role"],["Active owners",data.overview.activeOwners,"Protected access"]].map(([name,count,detail])=>
        <div className="platform-stat" key={name}><span>{name}</span><strong>{count}</strong><small>{detail}</small></div>)}
      </div>
      <div className="platform-columns"><div className="platform-panel"><div className="platform-panel-head"><h2>Staff access</h2><button onClick={()=>setTab("accounts")}>Manage accounts →</button></div>
       <div className="platform-role-grid">{["OWNER","MANAGER","CASHIER"].map(role=><div key={role}><span>{role}</span><strong>{data.accounts.filter(a=>a.role===role).length}</strong></div>)}</div>
       <p className="platform-muted">The totals represent accounts in one local database, not separate SaaS tenants.</p></div>
       <div className="platform-panel"><h2>Recent account events</h2>{data.events.length?data.events.slice(0,6).map(e=>
        <div className="platform-event" key={e.id}><span>●</span><div><strong>{e.action.replaceAll("_"," ")}</strong><small>{new Date(e.createdAt).toLocaleString("en-LK")}</small></div></div>):<p className="platform-muted">No account activity recorded yet.</p>}</div></div>
     </>:tab==="accounts"?<>
       <div className="platform-panel"><div className="platform-panel-head"><h2>Store accounts</h2><span>{data.overview.totalUsers} total</span></div>
        <div className="platform-filters"><input aria-label="Search accounts" placeholder="Search by name, username, or role" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="Filter accounts by role" value={roleFilter} onChange={e=>setRoleFilter(e.target.value)}>
         <option value="ALL">All roles</option><option value="OWNER">Owners</option><option value="MANAGER">Managers</option><option value="CASHIER">Cashiers</option></select></div>
        <div className="platform-table-scroll"><table className="platform-table"><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
         <tbody>{filtered.map(a=><tr key={a.id}><td><strong>{a.displayName}</strong></td><td>{a.username}</td><td>{a.role}</td><td><span className={"platform-status "+(a.isActive?"enabled":"disabled")}>{a.isActive?"Active":"Disabled"}</span></td>
          <td><div className="platform-actions"><button disabled={busy} onClick={()=>void act(a,"reset_password")}>Reset password</button><button disabled={busy||a.role==="OWNER"&&a.isActive&&data.overview.activeOwners<=1}
           title={a.role==="OWNER"&&a.isActive&&data.overview.activeOwners<=1?"Last active owner is protected":undefined}
           onClick={()=>void act(a,a.isActive?"deactivate":"activate")}>{a.isActive?"Disable":"Enable"}</button></div></td></tr>)}
         {!filtered.length&&<tr><td colSpan={5}>No matching accounts.</td></tr>}</tbody></table></div>
        <p className="platform-muted">Only the first 200 accounts are shown. Search/filter applies to those loaded accounts. All actions are checked again on the server.</p>
       </div>
       <div className="platform-panel"><h2>Create local store account</h2><p className="platform-muted">This is not tenant onboarding. It creates a role in the existing local database.</p>
        <form onSubmit={submit} className="platform-form"><label>Username<input value={newUsername} onChange={e=>setNewUsername(e.target.value.toLowerCase())} required pattern="[a-z0-9._-]{3,40}" maxLength={40} autoComplete="off" placeholder="e.g. storeowner"/></label>
        <label>Display name<input value={displayName} onChange={e=>setDisplayName(e.target.value)} required minLength={2} maxLength={100} placeholder="Full name"/></label>
        <label>Role<select value={newRole} onChange={e=>setNewRole(e.target.value)}><option value="OWNER">Owner</option><option value="MANAGER">Manager</option><option value="CASHIER">Cashier</option></select></label>
        <label>Password<input type="password" value={newPassword} onChange={e=>setNewPassword(e.target.value)} required minLength={12} maxLength={128} autoComplete="new-password" placeholder="12 or more characters"/></label>
        <button className="platform-primary" disabled={busy}>{busy?"Saving…":"Create account"}</button></form>
       </div>
      </>:<>
       <div className="platform-panel"><h2>Change Super Admin password</h2><p className="platform-muted">Changing your password will revoke previous sessions and sign you out. Keep it private.</p>
        <form className="platform-form platform-security-form" onSubmit={changePassword}>
         <label>Current password<input type="password" required value={currentPassword} autoComplete="current-password" onChange={e=>setCurrentPassword(e.target.value)}/></label>
         <label>New password (12–128 characters)<input type="password" required minLength={12} maxLength={128} value={replacementPassword} autoComplete="new-password" onChange={e=>setReplacementPassword(e.target.value)}/></label>
         <button className="platform-primary" disabled={busy}>{busy?"Updating…":"Update password and sign out"}</button>
        </form></div>
       <div className="platform-panel"><h2>Account isolation</h2><p className="platform-muted">Super Admin cannot perform store checkouts or stock changes, and store owners cannot manage the platform identity. Passwords are salted and hashed; none are returned by these management APIs.</p></div>
      </>}
     <footer className="platform-footer">Forma NextPOS · Local pilot · Keep Codespaces ports private · Not production-ready</footer>
    </section>
   </div>
  </div>
 </main>;
}
