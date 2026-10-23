import type { PrismaClient } from "@prisma/client";
import { hashPassword, type Role } from "./staff";

export type StaffAction =
  | { type: "deactivate"; targetId: string }
  | { type: "activate"; targetId: string }
  | { type: "reset_password"; targetId: string; password: string };

export class StaffManagementError extends Error {
  constructor(public readonly kind: "ACCOUNT_NOT_FOUND" | "CANNOT_DISABLE_SELF" |
    "NO_CHANGE" | "NOT_AUTHORIZED" | "PASSWORD_INVALID") {
    super(kind);
  }
}
export type StaffSummary = {
  id: string; username: string; displayName: string;
  role: Role; isActive: boolean; createdAt: Date;
};
export const staffPublicSelect = {
  id: true, username: true, displayName: true, role: true,
  isActive: true, createdAt: true
} as const;

export async function changeStaffAccount(db: PrismaClient, actorId: string, action: StaffAction) {
  if (action.type === "deactivate" && action.targetId === actorId)
    throw new StaffManagementError("CANNOT_DISABLE_SELF");
  const passwordHash = action.type === "reset_password"
    ? await hashPassword(action.password).catch(() => { throw new StaffManagementError("PASSWORD_INVALID"); })
    : null;

  return db.$transaction(async tx => {
    const actor = await tx.staffUser.findUnique({ where: { id: actorId } });
    if (!actor || !actor.isActive || actor.role !== "OWNER")
      throw new StaffManagementError("NOT_AUTHORIZED");
    const target = await tx.staffUser.findUnique({ where: { id: action.targetId } });
    if (!target) throw new StaffManagementError("ACCOUNT_NOT_FOUND");
    if (target.role === "SUPER_ADMIN") throw new StaffManagementError("NOT_AUTHORIZED");
    if (action.type !== "reset_password" &&
      target.isActive === (action.type === "activate")) throw new StaffManagementError("NO_CHANGE");

    const changed = await tx.staffUser.update({
      where: { id: target.id },
      data: action.type === "reset_password"
        ? { passwordHash: passwordHash!, sessionVersion: { increment: 1 } }
        : { isActive: action.type === "activate", sessionVersion: { increment: 1 } },
      select: staffPublicSelect
    });
    await tx.staffAuditEvent.create({
      data: { actorId, targetId: target.id, action: action.type.toUpperCase() }
    });
    return changed;
  });
}
