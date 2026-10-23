import { z } from "zod";
import { getActor, mutationAuthError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { addCashMovement, closeCashShift, openCashShift, shiftOverview, ShiftFailure } from "@/lib/shifts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const openInput = z.object({ action: z.literal("open"),
  openingFloatCents: z.number().int().min(0).max(2_000_000_000) }).strict();
const closeInput = z.object({ action: z.literal("close"),
  countedCashCents: z.number().int().min(0).max(2_000_000_000) }).strict();
const movementInput = z.object({
  action: z.literal("movement"),
  requestId: z.string().uuid(),
  type: z.enum(["CASH_IN", "CASH_OUT"]),
  amountCents: z.number().int().positive().max(2_000_000_000),
  note: z.string().trim().min(2).max(160)
}).strict();
const input = z.discriminatedUnion("action", [openInput, closeInput, movementInput]);
export async function GET() {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "Sign in required." }, { status: 401 });
  if (actor.role === "SUPER_ADMIN") return Response.json({ error: "Store role required." }, { status: 403 });
  try {
    return Response.json(await shiftOverview(prisma), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Could not load cash shifts." }, { status: 500 });
  }
}
export async function POST(request: Request) {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "Sign in required." }, { status: 401 });
  if (actor.role === "SUPER_ADMIN") return Response.json({ error: "Store role required." }, { status: 403 });
  const originError = mutationAuthError(request);
  if (originError) return originError;
  let body: unknown;
  try { body = await request.json(); } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = input.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid shift request." }, { status: 400 });
  // Narrow the platform-aware session role to a store-only ShiftActor.
  // A platform Super Admin has already been rejected above.
  const shiftActor = { id: actor.id, displayName: actor.displayName, role: actor.role };
  try {
    const action = parsed.data;
    const result = action.action === "open"
      ? { shift: await openCashShift(prisma, shiftActor, action.openingFloatCents) }
      : action.action === "close"
      ? { closed: await closeCashShift(prisma, shiftActor, action.countedCashCents) }
      : { cash: await addCashMovement(prisma, shiftActor, action) };
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ShiftFailure) {
      const messages: Record<ShiftFailure["code"], string> = {
        INVALID_AMOUNT: "Invalid cash amount.",
        ALREADY_OPEN: "A shift is already open on this register.",
        NO_OPEN_SHIFT: "There is no open shift.",
        NOT_YOUR_SHIFT: "Only the opening cashier or a manager/owner can perform this action.",
        CASH_CONFLICT: "Cash balance conflict.",
        REQUEST_CONFLICT: "This cash movement ID was reused with different details.",
        SHIFT_BUSY: "Register state changed. Refresh and retry carefully."
      };
      return Response.json({ error: messages[error.code] }, { status:
        error.code === "NOT_YOUR_SHIFT" ? 403 :
        error.code === "INVALID_AMOUNT" ? 422 : 409 });
    }
    return Response.json({ error: "Shift was not updated. Check the register before retrying." }, { status: 500 });
  }
}
