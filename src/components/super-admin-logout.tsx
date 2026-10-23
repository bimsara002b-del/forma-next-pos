"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function SuperAdminLogout() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function signOut() {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (!res.ok) throw new Error("Unable to sign out. Try again.");
      router.replace("/login"); router.refresh();
    } catch(e) {
      setError(e instanceof Error ? e.message : "Unable to sign out.");
      setBusy(false);
    }
  }
  return <div><button type="button" disabled={busy} onClick={() => void signOut()}
    style={{background:"#fff",padding:"12px 18px",border:"1px solid #cbd5e1",borderRadius:10,cursor:"pointer"}}>
    {busy ? "Signing out..." : "Sign out"}</button>
    {error && <p role="alert" style={{color:"#b91c1c"}}>{error}</p>}
  </div>;
}
