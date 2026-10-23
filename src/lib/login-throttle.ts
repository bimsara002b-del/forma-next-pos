import { createHmac } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

const WINDOW_MS = 15 * 60 * 1000;
export const MAX_FAILED_LOGINS = 5;
export const LOCK_MS = 15 * 60 * 1000;

export function throttleKey(username: string, secret: string): string {
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET_MISSING");
  return createHmac("sha256", secret).update("login:" + username.toLowerCase()).digest("hex");
}
export function retryAfterSeconds(lockedUntil: Date | null, now: Date): number {
  return lockedUntil && lockedUntil.getTime() > now.getTime()
    ? Math.ceil((lockedUntil.getTime() - now.getTime()) / 1000) : 0;
}
export async function checkLoginThrottle(db: PrismaClient, key: string, now = new Date()): Promise<number> {
  const record = await db.loginThrottle.findUnique({ where: { key } });
  return record ? retryAfterSeconds(record.lockedUntil, now) : 0;
}
export async function recordFailedLogin(db: PrismaClient, key: string, now = new Date()): Promise<number> {
  // Atomic update for an open failure window, and conditional reset after expiry.
  // This is a local SQLite demonstration, not a distributed rate limit service.
  const current = await db.loginThrottle.findUnique({ where: { key } });
  const newWindow = !current || current.windowEndsAt.getTime() <= now.getTime();
  const attempts = newWindow ? 1 : current.attempts + 1;
  const lockedUntil = attempts >= MAX_FAILED_LOGINS
    ? new Date(now.getTime() + LOCK_MS) : (newWindow ? null : current!.lockedUntil);
  await db.loginThrottle.upsert({
    where: { key },
    create: { key, attempts, windowEndsAt: new Date(now.getTime() + WINDOW_MS), lockedUntil },
    update: { attempts, windowEndsAt: newWindow ? new Date(now.getTime() + WINDOW_MS) : current!.windowEndsAt, lockedUntil }
  });
  return retryAfterSeconds(lockedUntil, now);
}
export async function clearLoginThrottle(db: PrismaClient, key: string): Promise<void> {
  await db.loginThrottle.deleteMany({ where: { key } });
}
