"use client";
import { FormEvent, useState } from "react";
import { ArrowRight, LockKeyhole, ShoppingBasket } from "lucide-react";
export function LoginForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true); setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password })
      });
      const data: { error?: string } = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Sign-in failed.");
      window.location.assign("/");
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
        <label htmlFor="access-password">Access password</label>
        <input id="access-password" type="password" autoFocus required autoComplete="current-password" value={password}
          placeholder="Enter your POS access password" onChange={event => setPassword(event.target.value)} />
        {error && <div className="form-error" role="alert">{error}</div>}
        <button className="primary-action" disabled={pending}>{pending ? "Signing in…" : "Sign in to POS"} <ArrowRight size={17}/></button>
      </form>
      <div className="login-help">First time? Run <code>npm run setup</code> in your Codespaces terminal to generate your password.</div>
    </div>
    <p className="login-footer">Forma Next POS · Private development environment recommended</p>
  </main>;
}
