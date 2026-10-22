import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
export const SESSION_COOKIE = "forma_pos_session";
const TTL_SECONDS = 8 * 60 * 60;

export function isConfigured() {
  return !!process.env.POS_ACCESS_PASSWORD && process.env.POS_ACCESS_PASSWORD.length >= 12
    && !!process.env.POS_SESSION_SECRET && process.env.POS_SESSION_SECRET.length >= 32;
}
export function passwordMatches(input: string): boolean {
  if (!isConfigured()) return false;
  const a = createHash("sha256").update(input).digest();
  const b = createHash("sha256").update(process.env.POS_ACCESS_PASSWORD!).digest();
  return timingSafeEqual(a, b);
}
function signature(value: string) {
  return createHmac("sha256", process.env.POS_SESSION_SECRET!).update(value).digest("hex");
}
export function createSession() {
  if (!isConfigured()) throw new Error("POS_NOT_CONFIGURED");
  const value = (Math.floor(Date.now() / 1000) + TTL_SECONDS) + "." + randomBytes(18).toString("hex");
  return value + "." + signature(value);
}
export function verifySession(value: string | undefined): boolean {
  if (!value || !isConfigured()) return false;
  const parts = value.split(".");
  if (parts.length !== 3 || !/^\d{10}$/.test(parts[0]) || !/^[a-f0-9]{36}$/.test(parts[1]) || !/^[a-f0-9]{64}$/.test(parts[2])) return false;
  if (Number(parts[0]) <= Math.floor(Date.now() / 1000)) return false;
  const expected = Buffer.from(signature(parts[0] + "." + parts[1]), "hex");
  return timingSafeEqual(Buffer.from(parts[2], "hex"), expected);
}
export async function isAuthenticated() {
  const jar = await cookies();
  return verifySession(jar.get(SESSION_COOKIE)?.value);
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true; // non-browser clients still require the signed session
  try { return new URL(origin).host === new URL(request.url).host; } catch { return false; }
}
export function authError() {
  return Response.json({ error: "Please sign in again." }, { status: 401 });
}
export function mutationAuthError(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Cross-origin request blocked." }, { status: 403 });
  return null;
}
