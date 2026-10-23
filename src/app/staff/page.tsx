import { notFound, redirect } from "next/navigation";
import { getActor } from "@/lib/auth";
import { staffMode } from "@/lib/staff";
import { StaffConsole } from "@/components/staff-console";
export default async function Page() {
  if (!staffMode()) notFound();
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.role !== "OWNER") notFound();
  return <StaffConsole />;
}
