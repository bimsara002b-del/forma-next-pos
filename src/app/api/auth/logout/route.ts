import { cookies } from "next/headers";
import { mutationAuthError, SESSION_COOKIE } from "@/lib/auth";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const originError = mutationAuthError(request);
  if (originError) return originError;
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  return Response.json({ ok: true });
}
