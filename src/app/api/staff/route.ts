import { z } from "zod";
import { getActor, mutationAuthError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { staffMode, hashPassword } from "@/lib/staff";
import { changeStaffAccount, StaffManagementError, staffPublicSelect } from "@/lib/staff-management";
export const runtime = "nodejs";

const createSchema = z.object({
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,40}$/),
  displayName: z.string().trim().min(2).max(100),
  password: z.string().min(12).max(128),
  role: z.enum(["OWNER", "MANAGER", "CASHIER"])
}).strict();
const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("activate"), targetId: z.string().min(1) }).strict(),
  z.object({ type: z.literal("deactivate"), targetId: z.string().min(1) }).strict(),
  z.object({ type: z.literal("reset_password"), targetId: z.string().min(1),
    password: z.string().min(12).max(128) }).strict()
]);

async function ownerOnly() {
  if (!staffMode()) return Response.json({ error: "Staff mode is disabled." }, { status: 404 });
  const actor = await getActor();
  if (!actor) return Response.json({ error: "Please sign in again." }, { status: 401 });
  if (actor.role !== "OWNER") return Response.json({ error: "Owner access required." }, { status: 403 });
  return actor;
}
function denied(value: unknown): value is Response { return value instanceof Response; }

export async function GET() {
  const actor = await ownerOnly();
  if (denied(actor)) return actor;
  const [users, events] = await Promise.all([
    prisma.staffUser.findMany({ orderBy: { createdAt: "asc" }, select: staffPublicSelect }),
    prisma.staffAuditEvent.findMany({
      take: 20, orderBy: { createdAt: "desc" },
      select: { id: true, actorId: true, targetId: true, action: true, createdAt: true }
    })
  ]);
  return Response.json({ users, events, currentUserId: actor.id },
    { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const actor = await ownerOnly();
  if (denied(actor)) return actor;
  const originError = mutationAuthError(request);
  if (originError) return originError;
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON." }, { status: 400 }); }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid staff details; password must be at least 12 characters." }, { status: 400 });
  const passwordHash = await hashPassword(parsed.data.password);
  try {
    const user = await prisma.$transaction(async tx => {
      const created = await tx.staffUser.create({
        data: { username: parsed.data.username, displayName: parsed.data.displayName,
          role: parsed.data.role, passwordHash },
        select: staffPublicSelect
      });
      await tx.staffAuditEvent.create({
        data: { actorId: actor.id, targetId: created.id, action: "CREATE" }
      });
      return created;
    });
    return Response.json({ user }, { status: 201 });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002")
      return Response.json({ error: "Username already exists." }, { status: 409 });
    return Response.json({ error: "Staff account could not be created." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const actor = await ownerOnly();
  if (denied(actor)) return actor;
  const originError = mutationAuthError(request);
  if (originError) return originError;
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON." }, { status: 400 }); }
  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid account action." }, { status: 400 });
  try {
    const user = await changeStaffAccount(prisma, actor.id, parsed.data);
    return Response.json({ user }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof StaffManagementError) {
      const messages = {
        ACCOUNT_NOT_FOUND: "Staff account not found.",
        CANNOT_DISABLE_SELF: "Owners cannot disable their own account.",
        NO_CHANGE: "Account is already in that state.",
        NOT_AUTHORIZED: "Owner access required.",
        PASSWORD_INVALID: "Password must contain 12–128 characters."
      };
      return Response.json({ error: messages[error.kind] }, { status: error.kind === "NOT_AUTHORIZED" ? 403 : 409 });
    }
    return Response.json({ error: "Account update was not completed." }, { status: 500 });
  }
}
