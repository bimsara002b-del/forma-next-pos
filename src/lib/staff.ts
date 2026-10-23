import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
const derive = promisify(scrypt);
export type Role = "SUPER_ADMIN" | "OWNER" | "MANAGER" | "CASHIER";
export type Permission = "catalog.read" | "catalog.create" | "stock.manage" | "checkout" | "overview.read" | "staff.manage";
export const staffMode = () => process.env.POS_STAFF_AUTH_ENABLED === "true";
export const isRole = (value: string): value is Role => ["SUPER_ADMIN", "OWNER", "MANAGER", "CASHIER"].includes(value);
export const isPlatformSuperAdmin = (role: Role) => role === "SUPER_ADMIN";
export function hasPermission(role: Role, permission: Permission): boolean {
  if (role === "SUPER_ADMIN") return false; // No implicit store permissions.
  if (role === "OWNER") return true;
  if (role === "MANAGER") return permission !== "staff.manage";
  return ["catalog.read", "checkout", "overview.read"].includes(permission);
}
export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12 || password.length > 128) throw new Error("INVALID_PASSWORD");
  const salt = randomBytes(16);
  const hashed = await derive(password, salt, 64) as Buffer;
  return ["scrypt", salt.toString("hex"), hashed.toString("hex")].join("$");
}
export async function matchesPassword(password: string, stored: string): Promise<boolean> {
  const [kind, salt, hex] = stored.split("$");
  if (kind !== "scrypt" || !/^[a-f0-9]{32}$/.test(salt ?? "") || !/^[a-f0-9]{128}$/.test(hex ?? "") || password.length > 128) return false;
  const hashed = await derive(password, Buffer.from(salt, "hex"), 64) as Buffer;
  return timingSafeEqual(hashed, Buffer.from(hex, "hex"));
}
const ttl = 8 * 60 * 60;
export function newStaffSession(id: string, version: number, secret: string): string {
  if (!secret || secret.length < 32 || !/^[a-z0-9_-]+$/i.test(id)) throw new Error("INVALID_SESSION");
  const body = ["v2", Math.floor(Date.now()/1000) + ttl, id, version, randomBytes(16).toString("hex")].join(".");
  return body + "." + createHmac("sha256", secret).update(body).digest("hex");
}
export function verifyStaffSession(value: string | undefined, secret: string | undefined,
  now = Math.floor(Date.now()/1000)): { id: string; version: number } | null {
  if (!value || !secret || secret.length < 32) return null;
  const parts = value.split(".");
  if (parts.length !== 6 || parts[0] !== "v2" || !/^[0-9]{10}$/.test(parts[1]) ||
    !/^[a-z0-9_-]{1,128}$/i.test(parts[2]) || !/^[1-9][0-9]*$/.test(parts[3]) ||
    !/^[a-f0-9]{32}$/.test(parts[4]) || !/^[a-f0-9]{64}$/.test(parts[5])) return null;
  const exp = Number(parts[1]), version = Number(parts[3]);
  if (!Number.isSafeInteger(exp) || exp <= now || !Number.isSafeInteger(version)) return null;
  const expected = createHmac("sha256", secret).update(parts.slice(0,5).join(".")).digest();
  if (!timingSafeEqual(expected, Buffer.from(parts[5], "hex"))) return null;
  return { id: parts[2], version };
}
