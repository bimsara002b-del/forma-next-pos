import { notFound, redirect } from "next/navigation";
import { getActor } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isPlatformSuperAdmin, staffMode } from "@/lib/staff";
import { SuperAdminLogout } from "@/components/super-admin-logout";
export const dynamic = "force-dynamic";

export default async function SuperAdminPage() {
  if (!staffMode()) notFound();
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (!isPlatformSuperAdmin(actor.role)) notFound();
  const [users, activeUsers] = await Promise.all([
    prisma.staffUser.count({ where: { role: { not: "SUPER_ADMIN" } } }),
    prisma.staffUser.count({ where: { role: { not: "SUPER_ADMIN" }, isActive: true } })
  ]);
  const panel = { background:"#fff", padding:24, border:"1px solid #e2e8f0", borderRadius:14 };
  return <main style={{minHeight:"100vh",background:"#f6f8fb",padding:"40px 20px",color:"#0f172a"}}>
    <div style={{maxWidth:960,margin:"0 auto"}}>
      <header style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:20,flexWrap:"wrap",marginBottom:26}}>
        <div><p style={{color:"#475569",letterSpacing:2,fontSize:13}}>FORMA NEXT POS · PLATFORM</p>
          <h1 style={{fontSize:32,margin:"12px 0"}}>Super Admin</h1>
          <p>Signed in as {actor.displayName}</p></div>
        <SuperAdminLogout/>
      </header>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:16,marginBottom:22}}>
        <section style={panel}><p style={{color:"#64748b"}}>Local staff accounts</p><strong style={{fontSize:36}}>{users}</strong></section>
        <section style={panel}><p style={{color:"#64748b"}}>Active local staff</p><strong style={{fontSize:36}}>{activeUsers}</strong></section>
      </div>
      <section style={panel}>
        <h2 style={{fontSize:20,marginBottom:12}}>Platform administration foundation</h2>
        <p style={{lineHeight:1.7}}>This is a separate platform identity, not a store Owner or cashier. Store checkout, inventory, sales, and staff actions remain restricted to store roles.</p>
        <p style={{lineHeight:1.7,marginTop:12}}>This is still a single-store local pilot. Tenant onboarding, SaaS subscriptions, platform-wide account controls, MFA, and audit-grade security are not implemented. Do not expose live data or a public Codespaces port.</p>
      </section>
    </div>
  </main>;
}
