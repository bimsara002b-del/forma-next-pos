import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth";
import { PosWorkspace } from "@/components/pos-workspace";
import { staffMode } from "@/lib/staff";
export default async function Page() {
  const actor=await getActor();
  if (!actor) redirect("/login");
  return <PosWorkspace canManageStaff={staffMode() && actor.role==="OWNER"} canManageInventory={actor.role!=="CASHIER"} />;
}
