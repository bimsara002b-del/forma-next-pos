import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import { PosWorkspace } from "@/components/pos-workspace";
export default async function Page() {
  if (!await isAuthenticated()) redirect("/login");
  return <PosWorkspace />;
}
