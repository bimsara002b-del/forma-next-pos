import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth";
import { ReportsDashboard } from "@/components/reports-dashboard";
export default async function Page(){
 const actor=await getActor();
 if(!actor)redirect("/login");
 if(actor.role==="CASHIER"||actor.role==="SUPER_ADMIN")redirect("/");
 return <ReportsDashboard/>;
}