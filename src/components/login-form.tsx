"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LockKeyhole, ShoppingBasket } from "lucide-react";
export function LoginForm({staffEnabled}:{staffEnabled:boolean}) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [username,setUsername]=useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true); setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(staffEnabled ? {username,password}:{password})
      });
      const data: { error?: string } = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Sign-in failed.");
      router.replace("/");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cannot connect to the POS.");
      setPending(false);
    }
  }
  return <main className="login-page">
    <div className="login-brand"><span className="brand-logo"><ShoppingBasket size={27}/></span><span>FORMA <b>POS</b></span></div>
    <div className="login-card">
      <span className="login-emblem"><LockKeyhole size={26}/></span>
      <div className="label-top">CASHIER ACCESS</div>
      <h1>Welcome back.</h1>
      <p>Sign in to your local Forma POS workspace. This is a development demo, not a production account system.</p>
      <form onSubmit={submit}>
        {staffEnabled && <><label htmlFor="staff-username">Username</label><input id="staff-username" value={username} onChange={e=>setUsername(e.target.value.toLowerCase())} required autoFocus autoComplete="username" maxLength={40}/></>}
        <label htmlFor="access-password">{staffEnabled ? "Password" : "Access password"}</label>
        <input id="access-password" type="password" autoFocus={!staffEnabled} required autoComplete="current-password" value={password}
          placeholder="Enter your POS access password" onChange={event => setPassword(event.target.value)} />
        {error && <div className="form-error" role="alert">{error}</div>}
        <button className="primary-action" disabled={pending}>{pending ? "Signing in…" : "Sign in to POS"} <ArrowRight size={17}/></button>
      </form>
      <div className="login-help">{staffEnabled ? "Use your staff username and password." : <>First time? Run <code>npm run setup</code> in your Codespaces terminal to generate your password.</>}</div>
    </div>
    <p className="login-footer">Forma Next POS · Private development environment recommended</p>
  </main>;
}
