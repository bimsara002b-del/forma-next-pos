import type { PrismaClient } from "@prisma/client";
import { hashPassword, matchesPassword } from "./staff";

export type StoreAccountRole = "OWNER" | "MANAGER" | "CASHIER";
export type PlatformAccountAction =
  | { type: "activate" | "deactivate"; targetId: string }
  | { type: "reset_password"; targetId: string; password: string };

export type PlatformFailureCode =
  | "NOT_AUTHORIZED" | "ACCOUNT_NOT_FOUND" | "PROTECTED_ACCOUNT"
  | "LAST_ACTIVE_OWNER" | "NO_CHANGE" | "PASSWORD_INVALID" | "INCORRECT_PASSWORD";

export class PlatformAccountFailure extends Error {
  constructor(public readonly code: PlatformFailureCode) {
    super(code);
  }
}

export const isStoreRole = (role: string): role is StoreAccountRole =>
  role === "OWNER" || role === "MANAGER" || role === "CASHIER";

export function wouldRemoveLastOwner(
  role: string, active: boolean, action: PlatformAccountAction["type"], activeOwners: number
): boolean {
  return role === "OWNER" && active && action === "deactivate" && activeOwners <= 1;
}

export async function updatePlatformAccount(
  db: PrismaClient, actorId: string, action: PlatformAccountAction
) {
  const passwordHash = action.type === "reset_password"
    ? await hashPassword(action.password).catch(() => {
        throw new PlatformAccountFailure("PASSWORD_INVALID");
      })
    : null;

  return db.$transaction(async tx => {
    const actor = await tx.staffUser.findUnique({ where: { id: actorId } });
    if (!actor || !actor.isActive || actor.role !== "SUPER_ADMIN")
      throw new PlatformAccountFailure("NOT_AUTHORIZED");
    const target = await tx.staffUser.findUnique({ where: { id: action.targetId } });
    if (!target) throw new PlatformAccountFailure("ACCOUNT_NOT_FOUND");
    if (!isStoreRole(target.role) || target.id === actorId)
      throw new PlatformAccountFailure("PROTECTED_ACCOUNT");

    if (action.type !== "reset_password" &&
      target.isActive === (action.type === "activate"))
      throw new PlatformAccountFailure("NO_CHANGE");

    if (action.type === "deactivate" && target.role === "OWNER" && target.isActive) {
      const activeOwners = await tx.staffUser.count({
        where: { role: "OWNER", isActive: true }
      });
      if (wouldRemoveLastOwner(target.role, target.isActive, action.type, activeOwners))
        throw new PlatformAccountFailure("LAST_ACTIVE_OWNER");
    }

    const changed = await tx.staffUser.update({
      where: { id: target.id },
      data: action.type === "reset_password"
        ? { passwordHash: passwordHash!, sessionVersion: { increment: 1 } }
        : { isActive: action.type === "activate", sessionVersion: { increment: 1 } },
      select: {
        id: true, username: true, displayName: true, role: true,
        isActive: true, createdAt: true
      }
    });
    await tx.staffAuditEvent.create({
      data: { actorId, targetId: target.id, action: "PLATFORM_" + action.type.toUpperCase() }
    });
    return changed;
  });
}

export async function changeSuperAdminPassword(
  db: PrismaClient, actorId: string, oldPassword: string, newPassword: string
) {
  if (newPassword.length < 12 || newPassword.length > 128 || oldPassword === newPassword)
    throw new PlatformAccountFailure("PASSWORD_INVALID");

  return db.$transaction(async tx => {
    const actor = await tx.staffUser.findUnique({ where: { id: actorId } });
    if (!actor || !actor.isActive || actor.role !== "SUPER_ADMIN")
      throw new PlatformAccountFailure("NOT_AUTHORIZED");

    if (!(await matchesPassword(oldPassword, actor.passwordHash)))
      throw new PlatformAccountFailure("INCORRECT_PASSWORD");

    const nextHash = await hashPassword(newPassword);
    const changed = await tx.staffUser.updateMany({
      where: { id: actor.id, role: "SUPER_ADMIN", isActive: true,
        passwordHash: actor.passwordHash, sessionVersion: actor.sessionVersion },
      data: { passwordHash: nextHash, sessionVersion: { increment: 1 } }
    });
    if (changed.count !== 1) throw new PlatformAccountFailure("NO_CHANGE");

    await tx.staffAuditEvent.create({
      data: { actorId: actor.id, targetId: actor.id, action: "PLATFORM_PASSWORD_CHANGED" }
    });
  });
}
