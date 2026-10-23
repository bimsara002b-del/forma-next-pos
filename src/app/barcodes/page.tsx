import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth";
import { BarcodeLabelPrinter } from "@/components/barcode-label-printer";
export default async function Page(){
 const actor=await getActor();
 if(!actor)redirect("/login");
 if(actor.role!=="OWNER"&&actor.role!=="MANAGER")redirect("/");
 return <BarcodeLabelPrinter/>;
}