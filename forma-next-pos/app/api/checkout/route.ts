import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

const checkoutSchema = z.object({
  items: z.array(z.object({
    productId: z.string().min(1),
    quantity: z.number().int().min(1).max(1000),
  })).min(1).max(100),
  paymentMethod: z.enum(["CASH", "CARD"]),
  amountReceivedCents: z.number().int().nonnegative().refine(Number.isSafeInteger),
}).strict();

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON request." }, { status: 400 });
  }

  const checked = checkoutSchema.safeParse(payload);
  if (!checked.success) {
    return NextResponse.json({ error: "Invalid checkout details." }, { status: 400 });
  }

  // Merge repeated entries so a single product can never be oversold by duplicate cart lines.
  const quantities = new Map<string, number>();
  for (const item of checked.data.items) {
    quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
  }
  if ([...quantities.values()].some((q) => q > 1000)) {
    return NextResponse.json({ error: "Quantity limit exceeded." }, { status: 400 });
  }

  try {
    const sale = await prisma.$transaction(async (tx) => {
      const products = await tx.product.findMany({
        where: { id: { in: [...quantities.keys()] }, isActive: true },
      });
      if (products.length !== quantities.size) throw new Error("PRODUCT_UNAVAILABLE");

      const lineItems = products.map((product) => {
        const quantity = quantities.get(product.id)!;
        if (product.priceCents < 0) throw new Error("INVALID_PRODUCT_PRICE");
        return {
          productId: product.id,
          productName: product.name,
          quantity,
          unitPriceCents: product.priceCents,
          lineTotalCents: quantity * product.priceCents,
        };
      });
      const totalCents = lineItems.reduce((sum, line) => sum + line.lineTotalCents, 0);
      if (!Number.isSafeInteger(totalCents) || totalCents > 2_000_000_000) {
        throw new Error("TOTAL_EXCEEDED");
      }
      const amountReceivedCents = checked.data.paymentMethod === "CARD"
        ? totalCents
        : checked.data.amountReceivedCents;
      if (amountReceivedCents < totalCents || amountReceivedCents > 2_000_000_000) {
        throw new Error("INSUFFICIENT_PAYMENT");
      }

      const receiptNumber = `FR-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`;

      for (const line of lineItems) {
        const result = await tx.product.updateMany({
          where: { id: line.productId, isActive: true, stockQty: { gte: line.quantity } },
          data: { stockQty: { decrement: line.quantity } },
        });
        if (result.count !== 1) throw new Error("STOCK_UNAVAILABLE");
      }

      const newSale = await tx.sale.create({
        data: {
          receiptNumber,
          subTotalCents: totalCents,
          totalCents,
          amountReceivedCents,
          changeCents: amountReceivedCents - totalCents,
          paymentMethod: checked.data.paymentMethod,
          items: { create: lineItems },
        },
        include: { items: true },
      });
      for (const line of lineItems) {
        await tx.stockMovement.create({
          data: {
            productId: line.productId,
            changeQty: -line.quantity,
            reason: "SALE",
            reference: newSale.receiptNumber,
          },
        });
      }
      return newSale;
    });

    return NextResponse.json({ sale: {
      id: sale.id,
      receiptNumber: sale.receiptNumber,
      totalCents: sale.totalCents,
      amountReceivedCents: sale.amountReceivedCents,
      changeCents: sale.changeCents,
      paymentMethod: sale.paymentMethod,
      createdAt: sale.createdAt.toISOString(),
      items: sale.items.map((item) => ({
        productName: item.productName,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        lineTotalCents: item.lineTotalCents,
      })),
    } }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "INSUFFICIENT_PAYMENT") {
      return NextResponse.json({ error: "Amount received is lower than the total." }, { status: 422 });
    }
    if (["PRODUCT_UNAVAILABLE", "STOCK_UNAVAILABLE"].includes(message)) {
      return NextResponse.json({ error: "One or more products are unavailable or out of stock. Refresh and try again." }, { status: 409 });
    }
    if (["TOTAL_EXCEEDED", "INVALID_PRODUCT_PRICE"].includes(message)) {
      return NextResponse.json({ error: "Cannot process this order total." }, { status: 422 });
    }
    return NextResponse.json({ error: "Checkout failed. No partial sale was recorded." }, { status: 500 });
  }
}
