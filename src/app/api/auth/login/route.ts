import { cookies } from "next/headers";
import { createSession, isConfigured, mutationAuthError, passwordMatches, SESSION_COOKIE } from "@/lib/auth";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const originError = mutationAuthError(request);
  if (originError) return originError;
  if (!isConfigured()) return Response.json({ error: "Run npm run setup first to configure the demo." }, { status: 503 });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid request." }, { status: 400 }); }
  if (typeof body !== "object" || !body || !("password" in body) || typeof body.password !== "string" || !passwordMatches(body.password)) {
    return Response.json({ error: "Incorrect password." }, { status: 401 });
  }
  const jar = await cookies();
  jar.set(SESSION_COOKIE, createSession(), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax",
    path: "/", maxAge: 8 * 60 * 60
  });
  return Response.json({ ok: true });
}
