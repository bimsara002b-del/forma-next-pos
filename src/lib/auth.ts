import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "./db";
import { staffMode, isRole, hasPermission, verifyStaffSession, type Role, type Permission } from "./staff";
import { sameOrigin } from "./origin";
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
export async function getActor(): Promise<{ id: string; role: Role; displayName: string } | null> {
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!staffMode()) return verifySession(value) ? { id: "demo", role: "OWNER", displayName: "Demo Owner" } : null;
  const token = verifyStaffSession(value, process.env.POS_SESSION_SECRET);
  if (!token) return null;
  const user = await prisma.staffUser.findUnique({where:{id:token.id}});
  if (!user || !user.isActive || !isRole(user.role) || user.sessionVersion!==token.version) return null;
  return {id:user.id,role:user.role,displayName:user.displayName};
}
export async function isAuthenticated() {return (await getActor())!==null;}
export async function permissionError(permission: Permission): Promise<Response|null> {
  const actor = await getActor();
  if (!actor) return authError();
  return hasPermission(actor.role,permission) ? null : Response.json({error:"Insufficient staff permissions."},{status:403});
}
export function authError() {
  return Response.json({ error: "Please sign in again." }, { status: 401 });
}
export function mutationAuthError(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Cross-origin request blocked." }, { status: 403 });
  return null;
}
