import { loadEnvFile } from "node:process";
import { PrismaClient } from "@prisma/client";
import { randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";

if (process.env.NODE_ENV === "production") {
  console.error("Super Admin bootstrap is disabled in production.");
  process.exit(1);
}
const reset = process.argv.length === 3 && process.argv[2] === "--reset-password";
if (process.argv.length !== (reset ? 3 : 2)) {
  console.error("Unknown arguments. Use --reset-password to rotate the password.");
  process.exit(1);
}
try { loadEnvFile(".env"); }
catch { console.error("Missing private .env. Run npm run setup first."); process.exit(1); }
if (!process.env.POS_SESSION_SECRET || process.env.POS_SESSION_SECRET.length < 32) {
  console.error("Missing POS_SESSION_SECRET. Run npm run setup from repository root.");
  process.exit(1);
}
const db = new PrismaClient();
try {
  const existing = await db.staffUser.findUnique({ where: { username: "superadmin" } });
  if (existing && existing.role !== "SUPER_ADMIN") {
    console.error("Username superadmin belongs to a store account. No changes made.");
    process.exitCode = 1;
  } else if (existing && !reset) {
    console.log("Super Admin already exists. Password unchanged.");
    console.log("To rotate explicitly: npm run superadmin:reset-password");
  } else if (!existing && reset) {
    console.error("Super Admin does not exist. Run npm run superadmin:bootstrap first.");
    process.exitCode = 1;
  } else {
    const password = randomBytes(24).toString("base64url");
    const salt = randomBytes(16);
    const hash = await promisify(scrypt)(password, salt, 64);
    const passwordHash = ["scrypt", salt.toString("hex"), Buffer.from(hash).toString("hex")].join("$");
    if (existing) {
      await db.staffUser.update({
        where: { id: existing.id },
        data: { passwordHash, sessionVersion: { increment: 1 } }
      });
      console.log("Rotated Super Admin password; existing sessions invalidated.");
    } else {
      await db.staffUser.create({
        data: { username: "superadmin", displayName: "Platform Super Admin",
          role: "SUPER_ADMIN", passwordHash }
      });
      console.log("Created separate Super Admin account.");
    }
    console.log("Username: superadmin");
    console.log("ONE-TIME PASSWORD: " + password);
    console.log("Save it privately. Only the salted password hash is stored.");
    console.log("Set POS_STAFF_AUTH_ENABLED=true in private .env; restart npm run dev and sign in at /login.");
    console.log("Keep Codespaces ports private; never share the password or .env.");
  }
} catch {
  console.error("Bootstrap failed. Check local demo database and staff table.");
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
