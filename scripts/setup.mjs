import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
const path = ".env";
if (existsSync(path)) {
  console.log(".env already exists. Leaving your credentials and database unchanged.");
  process.exit(0);
}
const password = randomBytes(15).toString("base64url");
const secret = randomBytes(36).toString("base64url");
writeFileSync(path, [
  'DATABASE_URL="file:./dev.db"',
  'POS_ACCESS_PASSWORD="' + password + '"',
  'POS_SESSION_SECRET="' + secret + '"',
  ""
].join("\n"), { mode: 0o600, flag: "wx" });
console.log("\nLocal access password: " + password);
console.log("Keep this password safe. It is also saved in .env (gitignored).");
console.log("Run: npm run db:generate && npm run db:push && npm run db:seed && npm run dev\n");
