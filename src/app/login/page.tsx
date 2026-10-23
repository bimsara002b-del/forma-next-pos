import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth";
import { LoginForm } from "@/components/login-form";
import { staffMode, isPlatformSuperAdmin } from "@/lib/staff";
export default async function LoginPage() {
  const actor = await getActor();
  if (actor) redirect(isPlatformSuperAdmin(actor.role) ? "/super-admin" : "/");
  return <LoginForm staffEnabled={staffMode()}/>;
}
