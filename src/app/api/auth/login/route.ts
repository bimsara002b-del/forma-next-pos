import { cookies } from "next/headers";
import { z } from "zod";
import { createSession, isConfigured, mutationAuthError, passwordMatches, SESSION_COOKIE } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { newStaffSession, matchesPassword, staffMode } from "@/lib/staff";
import { checkLoginThrottle, clearLoginThrottle, recordFailedLogin, throttleKey } from "@/lib/login-throttle";
export const runtime = "nodejs";

const credentials = z.object({
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,40}$/),
  password: z.string().min(1).max(128)
}).strict();

function tooMany(seconds: number) {
  return Response.json(
    { error: "Too many incorrect login attempts. Try again later." },
    { status: 429, headers: { "Retry-After": String(Math.max(1, seconds)), "Cache-Control": "no-store" } }
  );
}

export async function POST(request: Request) {
  const originError = mutationAuthError(request);
  if (originError) return originError;
  if (!isConfigured()) return Response.json({ error: "Local login has not been configured." }, { status: 503 });
  let body: unknown;
  try { body = await request.json(); }
  catch { return Response.json({ error: "Invalid login request." }, { status: 400 }); }

  const staffEnabled = staffMode();
  const parsed = staffEnabled ? credentials.safeParse(body) : null;
  if (staffEnabled && !parsed?.success)
    return Response.json({ error: "Incorrect username or password." }, { status: 401 });
  const username = staffEnabled && parsed?.success ? parsed.data.username : "local-demo";
  const key = throttleKey(username, process.env.POS_SESSION_SECRET!);
  try {
    const seconds = await checkLoginThrottle(prisma, key);
    if (seconds > 0) return tooMany(seconds);
    let session: string;
    if (staffEnabled && parsed?.success) {
      const user = await prisma.staffUser.findUnique({ where: { username } });
      const valid = user?.isActive && await matchesPassword(parsed.data.password, user.passwordHash);
      if (!valid) {
        const retryAfter = await recordFailedLogin(prisma, key);
        if (retryAfter > 0) return tooMany(retryAfter);
        return Response.json({ error: "Incorrect username or password." }, { status: 401 });
      }
      session = newStaffSession(user.id, user.sessionVersion, process.env.POS_SESSION_SECRET!);
    } else {
      const valid = !!body && typeof body === "object" && "password" in body &&
        typeof body.password === "string" && passwordMatches(body.password);
      if (!valid) {
        const retryAfter = await recordFailedLogin(prisma, key);
        if (retryAfter > 0) return tooMany(retryAfter);
        return Response.json({ error: "Incorrect access password." }, { status: 401 });
      }
      session = createSession();
    }
    await clearLoginThrottle(prisma, key);
    (await cookies()).set(SESSION_COOKIE, session, {
      httpOnly: true, secure: process.env.NODE_ENV === "production",
      sameSite: "lax", path: "/", maxAge: 8 * 60 * 60
    });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Login temporarily unavailable. Check the local database configuration." }, { status: 503 });
  }
}
