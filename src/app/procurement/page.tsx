import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth";
import { ProcurementDashboard } from "@/components/procurement-dashboard";
export default async function ProcurementPage() {
  const actor=await getActor();
  if(!actor) redirect("/login");
  if(actor.role==="CASHIER") redirect("/");
  return <ProcurementDashboard/>;
}
