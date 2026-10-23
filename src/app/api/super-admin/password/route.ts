import { cookies } from "next/headers";
import { z } from "zod";
import { getActor, mutationAuthError, SESSION_COOKIE } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { staffMode } from "@/lib/staff";
import { changeSuperAdminPassword, PlatformAccountFailure } from "@/lib/platform-accounts";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };
const schema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(12).max(128)
}).strict();

export async function POST(request: Request) {
  if (!staffMode())
    return Response.json({ error: "Not found." }, { status: 404, headers });
  const actor = await getActor();
  if (!actor)
    return Response.json({ error: "Sign in required." }, { status: 401, headers });
  if (actor.role !== "SUPER_ADMIN")
    return Response.json({ error: "Super Admin access required." }, { status: 403, headers });
  const denied = mutationAuthError(request);
  if (denied) return denied;
  let input: unknown;
  try { input = await request.json(); }
  catch { return Response.json({ error: "Invalid JSON." }, { status: 400, headers }); }
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    return Response.json({ error: "Password must have 12–128 characters." }, { status: 400, headers });

  try {
    await changeSuperAdminPassword(prisma, actor.id, parsed.data.currentPassword, parsed.data.newPassword);
    (await cookies()).delete(SESSION_COOKIE);
    return Response.json({ ok: true, signedOut: true }, { headers });
  } catch (error) {
    if (error instanceof PlatformAccountFailure) {
      const messages = {
        INCORRECT_PASSWORD: "Current password is incorrect.",
        PASSWORD_INVALID: "Choose a different password of at least 12 characters.",
        NOT_AUTHORIZED: "Access denied.",
        ACCOUNT_NOT_FOUND: "Account not found.",
        PROTECTED_ACCOUNT: "Protected account.",
        LAST_ACTIVE_OWNER: "Protected owner.",
        NO_CHANGE: "Password was not changed. Please retry."
      };
      const status = error.code === "INCORRECT_PASSWORD" ? 400 :
        error.code === "NOT_AUTHORIZED" ? 403 : 409;
      return Response.json({ error: messages[error.code] }, { status, headers });
    }
    return Response.json({ error: "Unable to change password." }, { status: 500, headers });
  }
}
