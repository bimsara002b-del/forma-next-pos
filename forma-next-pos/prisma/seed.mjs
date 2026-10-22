import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const products = [
  ["FR-1001", "4791001000011", "Basmati Rice 1kg", "Groceries", 45000, 35500, 36],
  ["FR-1002", "4791001000028", "White Sugar 1kg", "Groceries", 26000, 21500, 48],
  ["FR-1003", "4791001000035", "Fresh Milk 1L", "Dairy", 48000, 40200, 26],
  ["FR-1004", "4791001000042", "Milk Powder 400g", "Dairy", 115000, 98800, 18],
  ["FR-1005", "4791001000059", "Sandwich Bread", "Bakery", 22000, 17000, 22],
  ["FR-1006", "4791001000066", "Butter 200g", "Dairy", 72000, 62500, 13],
  ["FR-1007", "4791001000073", "Ceylon Tea 100g", "Beverages", 39000, 30200, 40],
  ["FR-1008", "4791001000080", "Instant Coffee 50g", "Beverages", 68000, 57100, 14],
  ["FR-1009", "4791001000097", "Orange Juice 1L", "Beverages", 58000, 47000, 17],
  ["FR-1010", "4791001000103", "Soap Bar 100g", "Household", 16500, 12400, 62],
  ["FR-1011", "4791001000110", "Dishwash Liquid 500ml", "Household", 49000, 38500, 19],
  ["FR-1012", "4791001000127", "Toothpaste 120g", "Household", 35000, 28600, 24]
];

for (const [sku, barcode, name, category, priceCents, costCents, stockQty] of products) {
  // Seed is safe to re-run: it will not overwrite product changes or existing sales.
  await prisma.product.upsert({
    where: { sku },
    update: {},
    create: { sku, barcode, name, category, priceCents, costCents, stockQty }
  });
}
console.log(`Seeded ${products.length} sample products (existing data preserved).`);
await prisma.$disconnect();
