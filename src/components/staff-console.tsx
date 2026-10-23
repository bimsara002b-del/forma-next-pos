"use client";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { ArrowLeft, Plus, ShieldCheck, Users, KeyRound } from "lucide-react";
type User = { id: string; username: string; displayName: string; role: string; isActive: boolean };
type Event = { id: string; action: string; actorId: string; targetId: string; createdAt: string };
type StaffData = { users: User[]; events: Event[]; currentUserId: string };
async function responseData<T>(response: Response): Promise<T> {
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? "Request failed.");
  return value as T;
}
export function StaffConsole() {
  const [data,setData]=useState<StaffData>({ users: [], events: [], currentUserId: "" });
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [pending,setPending]=useState(false);
  const [username,setUsername]=useState("");
  const [displayName,setDisplayName]=useState("");
  const [password,setPassword]=useState("");
  const [role,setRole]=useState("CASHIER");
  useEffect(()=>{
    let cancelled=false;
    void fetch("/api/staff",{cache:"no-store"}).then(r=>responseData<StaffData>(r))
      .then(result=>{if(!cancelled)setData(result);})
      .catch(e=>{if(!cancelled)setError(e instanceof Error?e.message:"Could not load staff.");})
      .finally(()=>{if(!cancelled)setLoading(false);});
    return ()=>{cancelled=true;};
  },[]);
  async function refresh(){
    const next=await fetch("/api/staff",{cache:"no-store"}).then(r=>responseData<StaffData>(r));
    setData(next);
  }
  async function create(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setPending(true);setError("");setNotice("");
    try{
      await fetch("/api/staff",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({username,displayName,password,role})}).then(r=>responseData(r));
      setUsername("");setDisplayName("");setPassword("");setRole("CASHIER");
      await refresh();setNotice("Staff account created. Share credentials privately.");
    }catch(e){setError(e instanceof Error?e.message:"Could not create account.");}
    finally{setPending(false);}
  }
  async function act(user:User,type:"activate"|"deactivate"|"reset_password"){
    if(pending)return;
    let newPassword:string|undefined;
    if(type==="reset_password"){
      const entered=window.prompt("Enter a temporary password (12–128 characters).");
      if(entered===null)return;
      if(entered.length<12||entered.length>128){setError("Password must contain 12–128 characters.");return;}
      newPassword=entered;
    }else if(!window.confirm((type==="activate"?"Enable":"Disable")+" account "+user.username+"?"))return;
    setPending(true);setError("");setNotice("");
    try{
      await fetch("/api/staff",{method:"PATCH",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({type,targetId:user.id,...(newPassword?{password:newPassword}:{})})}).then(r=>responseData(r));
      await refresh();
      setNotice(type==="reset_password"?"Password updated; existing sessions invalidated.":"Account state updated; existing sessions invalidated.");
    }catch(e){setError(e instanceof Error?e.message:"Account update failed.");}
    finally{setPending(false);}
  }
  return <main className="content-scroll" style={{maxWidth:1120,margin:"0 auto"}}>
    <div className="content-heading"><div><Link href="/" className="text-link"><ArrowLeft size={16}/> Back to POS</Link>
      <h1 style={{marginTop:16}}>Staff management</h1><p>Local pilot roles and account lifecycle — not multi-tenant SaaS</p></div>
      <span className="subtle-pill"><Users size={16}/>{data.users.length} users</span></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p role="status" style={{color:"#13865c"}}>{notice}</p>}
    <div className="panel" style={{marginBottom:20}}>
      <div className="panel-header"><h3>Create employee</h3><ShieldCheck size={19}/></div>
      <form onSubmit={create} style={{padding:22}}>
        <div className="form-grid">
          <label>Username<input autoComplete="off" value={username} pattern="[a-z0-9._-]{3,40}" required maxLength={40} onChange={e=>setUsername(e.target.value.toLowerCase())}/></label>
          <label>Display name<input value={displayName} required maxLength={100} onChange={e=>setDisplayName(e.target.value)}/></label>
          <label>Role<select value={role} onChange={e=>setRole(e.target.value)} style={{padding:12,border:"1px solid #dce4ea",borderRadius:7}}>
            <option value="CASHIER">Cashier</option><option value="MANAGER">Manager</option><option value="OWNER">Owner</option></select></label>
          <label>Password (12+ characters)<input type="password" value={password} required minLength={12} maxLength={128} autoComplete="new-password" onChange={e=>setPassword(e.target.value)}/></label>
        </div>
        <button disabled={pending} className="small-action" style={{marginTop:20}}><Plus size={16}/> Create employee</button>
      </form>
    </div>
    <div className="panel" style={{marginBottom:20}}>
      <div className="panel-header"><h3>Employees</h3><span className="subtle-pill">{loading?"Loading":"Local only"}</span></div>
      <div className="table-scroll"><table><thead><tr><th>Employee</th><th>Username</th><th>Role</th><th>Status</th><th>Account actions</th></tr></thead>
        <tbody>{data.users.map(user=><tr key={user.id}>
          <td className="table-strong">{user.displayName}</td><td>{user.username}</td><td>{user.role}</td>
          <td><span className={"stock-pill"+(user.isActive?"":" low")}>{user.isActive?"Active":"Disabled"}</span></td>
          <td><div className="stock-actions">
            <button type="button" disabled={pending} onClick={()=>void act(user,"reset_password")}><KeyRound size={13}/> Reset password</button>
            {user.id!==data.currentUserId && <button type="button" disabled={pending} onClick={()=>void act(user,user.isActive?"deactivate":"activate")}>{user.isActive?"Disable":"Enable"}</button>}
          </div></td>
        </tr>)}</tbody></table></div>
    </div>
    <div className="panel"><div className="panel-header"><h3>Recent account events</h3></div>
      <div className="table-scroll"><table><thead><tr><th>Action</th><th>Actor</th><th>Target</th><th>Date</th></tr></thead>
      <tbody>{data.events.map(event=><tr key={event.id}><td>{event.action}</td><td className="mono">{event.actorId.slice(0,10)}</td><td className="mono">{event.targetId.slice(0,10)}</td><td>{new Date(event.createdAt).toLocaleString("en-LK")}</td></tr>)}</tbody>
      </table></div></div>
    <p className="small-disclaimer" style={{marginTop:20}}>Pilot only. Login throttling is local and per username, not distributed or IP-scoped. No MFA, tenant isolation, email reset or full audit compliance. Keep the Codespaces port private and do not use real customer data.</p>
  </main>;
}
