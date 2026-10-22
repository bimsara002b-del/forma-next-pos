import { loadEnvFile } from "node:process";
import { PrismaClient } from "@prisma/client";
import { randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";
try { loadEnvFile(".env"); } catch {
  console.error("Run npm run setup from the repository root first.");
  process.exit(1);
}
if (process.env.NODE_ENV === "production") {
  console.error("Demo bootstrap is disabled in production.");
  process.exit(1);
}
const password = process.env.POS_ACCESS_PASSWORD;
if (!password || password.length < 12) {
  console.error("Missing local POS_ACCESS_PASSWORD; run npm run setup first.");
  process.exit(1);
}
const db = new PrismaClient();
try {
  const existing = await db.staffUser.findUnique({ where: { username: "owner" } });
  if (!existing) {
    const salt = randomBytes(16);
    const hash = await promisify(scrypt)(password, salt, 64);
    await db.staffUser.create({ data: {
      username: "owner", displayName: "Demo Store Owner", role: "OWNER",
      passwordHash: ["scrypt", salt.toString("hex"), Buffer.from(hash).toString("hex")].join("$")
    } });
    console.log("Created local demo account: owner. Password is POS_ACCESS_PASSWORD in root .env.");
  } else console.log("Owner account already exists; left it unchanged.");
  console.log("To enable: POS_STAFF_AUTH_ENABLED=true in .env, then restart npm run dev.");
} catch {
  console.error("Bootstrap failed. Check the local database exists (npm run db:push).");
  process.exitCode=1;
} finally { await db.$disconnect(); }
