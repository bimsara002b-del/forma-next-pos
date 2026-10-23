import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import { LoginForm } from "@/components/login-form";
import { staffMode } from "@/lib/staff";
export default async function LoginPage() {
  if (await isAuthenticated()) redirect("/");
  return <LoginForm staffEnabled={staffMode()}/>;
}
