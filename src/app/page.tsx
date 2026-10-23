import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth";
import { PosWorkspace } from "@/components/pos-workspace";
export default async function Page() {
  if (!await getActor()) redirect("/login");
  return <PosWorkspace />;
}
