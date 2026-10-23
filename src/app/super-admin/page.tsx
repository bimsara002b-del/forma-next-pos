import { notFound, redirect } from "next/navigation";
import { getActor } from "@/lib/auth";
import { isPlatformSuperAdmin, staffMode } from "@/lib/staff";
import { SuperAdminConsole } from "@/components/super-admin-console";

export const dynamic = "force-dynamic";
export default async function SuperAdminPage() {
  if (!staffMode()) notFound();
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (!isPlatformSuperAdmin(actor.role)) notFound();
  return <SuperAdminConsole name={actor.displayName}/>;
}
