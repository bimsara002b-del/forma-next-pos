import { z } from "zod";
import { getActor, mutationAuthError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { hashPassword, staffMode } from "@/lib/staff";
import {
  PlatformAccountFailure, updatePlatformAccount
} from "@/lib/platform-accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    password: z.string().min(12).max(128) }).strict(),
  z.object({ type: z.literal("change_role"), targetId: z.string().min(1),
    role: z.enum(["OWNER", "MANAGER", "CASHIER"]) }).strict()
]);

const listSchema = z.object({
  q: z.string().max(100).default(""),
  role: z.enum(["ALL", "OWNER", "MANAGER", "CASHIER"]).default("ALL"),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  eventPage: z.coerce.number().int().min(1).max(100000).default(1)
});

const accountSelect = {
  id: true, username: true, displayName: true, role: true, isActive: true, createdAt: true
} as const;
const headers = { "Cache-Control": "no-store" };

async function platformActor() {
  if (!staffMode()) return Response.json({ error: "Not found." }, { status: 404, headers });
  const actor = await getActor();
  if (!actor) return Response.json({ error: "Sign in required." }, { status: 401, headers });
  if (actor.role !== "SUPER_ADMIN")
    return Response.json({ error: "Super Admin access required." }, { status: 403, headers });
  return actor;
}
function isDenied(value: unknown): value is Response {
  return value instanceof Response;
}

export async function GET(request: Request) {
  const actor = await platformActor();
  if (isDenied(actor)) return actor;

  const url = new URL(request.url);
  const parsed = listSchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return Response.json({ error: "Invalid pagination or filter." }, { status: 400, headers });
  const { q, role, page, pageSize, eventPage } = parsed.data;
  const where = {
    role: { in: role === "ALL" ? ["OWNER","MANAGER","CASHIER"] : [role] },
    ...(q.trim() ? { OR: [
      { username: { contains: q.trim() } },
      { displayName: { contains: q.trim() } }
    ] } : {})
  };
  const storeRoles = { role: { in: ["OWNER","MANAGER","CASHIER"] } };
  try {
    const [accounts, matchedAccounts, events, eventCount, totalUsers, activeUsers, ownerUsers, activeOwners] =
      await Promise.all([
        prisma.staffUser.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: accountSelect, skip: (page-1)*pageSize, take: pageSize }),
        prisma.staffUser.count({ where }),
        prisma.staffAuditEvent.findMany({ take: 20, skip: (eventPage-1)*20,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { id:true, actorId:true, targetId:true, action:true, createdAt:true } }),
        prisma.staffAuditEvent.count(),
        prisma.staffUser.count({ where: storeRoles }),
        prisma.staffUser.count({ where: { ...storeRoles, isActive: true } }),
        prisma.staffUser.count({ where: { role: "OWNER" } }),
        prisma.staffUser.count({ where: { role: "OWNER", isActive: true } })
      ]);
    return Response.json({ overview: { totalUsers, activeUsers, ownerUsers, activeOwners },
      accounts, events, pagination: { page, pageSize, matchedAccounts, eventPage, eventCount } }, { headers });
  } catch {
    return Response.json({ error: "Unable to load platform accounts." }, { status: 500, headers });
  }
}

export async function POST(request: Request) {
  const actor = await platformActor();
  if (isDenied(actor)) return actor;
  const originError = mutationAuthError(request);
  if (originError) return originError;
  let input: unknown;
  try { input = await request.json(); }
  catch { return Response.json({ error: "Invalid JSON." }, { status: 400, headers }); }
  const parsed = createSchema.safeParse(input);
  if (!parsed.success)
    return Response.json({ error: "Invalid account details. Password must have 12–128 characters." },
      { status: 400, headers });

  const passwordHash = await hashPassword(parsed.data.password);
  try {
    const account = await prisma.$transaction(async tx => {
      const current = await tx.staffUser.findUnique({ where: { id: actor.id } });
      if (!current || !current.isActive || current.role !== "SUPER_ADMIN")
        throw new PlatformAccountFailure("NOT_AUTHORIZED");
      const created = await tx.staffUser.create({
        data: {
          username: parsed.data.username, displayName: parsed.data.displayName,
          passwordHash, role: parsed.data.role
        },
        select: accountSelect
      });
      await tx.staffAuditEvent.create({
        data: { actorId: actor.id, targetId: created.id, action: "PLATFORM_CREATE" }
      });
      return created;
    });
    return Response.json({ account }, { status: 201, headers });
  } catch (error) {
    if (error instanceof PlatformAccountFailure)
      return Response.json({ error: "Access denied." }, { status: 403, headers });
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002")
      return Response.json({ error: "Username already exists." }, { status: 409, headers });
    return Response.json({ error: "Unable to create account." }, { status: 500, headers });
  }
}

export async function PATCH(request: Request) {
  const actor = await platformActor();
  if (isDenied(actor)) return actor;
  const originError = mutationAuthError(request);
  if (originError) return originError;
  let input: unknown;
  try { input = await request.json(); }
  catch { return Response.json({ error: "Invalid JSON." }, { status: 400, headers }); }
  const parsed = actionSchema.safeParse(input);
  if (!parsed.success)
    return Response.json({ error: "Invalid account action." }, { status: 400, headers });
  try {
    const account = await updatePlatformAccount(prisma, actor.id, parsed.data);
    return Response.json({ account }, { headers });
  } catch (error) {
    if (error instanceof PlatformAccountFailure) {
      const messages = {
        NOT_AUTHORIZED: "Access denied.",
        ACCOUNT_NOT_FOUND: "Account not found.",
        PROTECTED_ACCOUNT: "A platform account cannot be managed here.",
        LAST_ACTIVE_OWNER: "Cannot disable the last active store owner.",
        NO_CHANGE: "The account is already in that state.",
        PASSWORD_INVALID: "Password must have 12–128 characters.",
        INCORRECT_PASSWORD: "Invalid password."
      };
      const status = error.code === "NOT_AUTHORIZED" ? 403 :
        error.code === "ACCOUNT_NOT_FOUND" ? 404 : 409;
      return Response.json({ error: messages[error.code] }, { status, headers });
    }
    return Response.json({ error: "Unable to update account." }, { status: 500, headers });
  }
}
