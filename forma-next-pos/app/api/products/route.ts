import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const products = await prisma.product.findMany({
      where: { isActive: true },
      orderBy: [{ category: "asc" }, { name: "asc" }],
      select: {
        id: true, sku: true, barcode: true, name: true,
        category: true, priceCents: true, stockQty: true,
      },
    });
    return NextResponse.json({ products }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load products. Check the database setup." }, { status: 500 });
  }
}
