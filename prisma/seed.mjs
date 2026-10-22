import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const samples = [
  ["F001", "4791234567890", "Ceylon Tea 100g", "Groceries", 46000, 32500, 42],
  ["F002", "4791234567891", "Fresh Milk 1L", "Dairy", 52000, 42500, 27],
  ["F003", "4791234567892", "White Bread", "Bakery", 21000, 15500, 34],
  ["F004", "4791234567893", "Rice 1kg", "Groceries", 28500, 24200, 65],
  ["F005", "4791234567894", "Sugar 1kg", "Groceries", 26000, 22000, 29],
  ["F006", "4791234567895", "Coffee 200g", "Beverages", 98000, 79000, 13],
  ["F007", "4791234567896", "Dish Soap 500ml", "Household", 69000, 51500, 8],
  ["F008", "4791234567897", "Bottled Water 1L", "Beverages", 17000, 11000, 55],
  ["F009", "4791234567898", "Eggs 10 Pack", "Dairy", 76000, 63000, 17],
  ["F010", "4791234567899", "Biscuits 100g", "Bakery", 19000, 14000, 39]
];
try {
  for (const [sku, barcode, name, category, priceCents, costCents, stockQty] of samples) {
    await db.product.upsert({
      where: { sku },
      update: {},
      create: { sku, barcode, name, category, priceCents, costCents, stockQty }
    });
  }
  console.log("Demo products present. Existing products, stock and sales were not overwritten.");
} finally {
  await db.$disconnect();
}
