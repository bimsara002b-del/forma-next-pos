import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth";
import { PosWorkspace } from "@/components/pos-workspace";
import { staffMode, isPlatformSuperAdmin } from "@/lib/staff";
export default async function Page() {
  const actor=await getActor();
  if (!actor) redirect("/login");
  if (isPlatformSuperAdmin(actor.role)) redirect("/super-admin");
  return <PosWorkspace canManageStaff={staffMode() && actor.role==="OWNER"} canManageInventory={actor.role!=="CASHIER"} />;
}
