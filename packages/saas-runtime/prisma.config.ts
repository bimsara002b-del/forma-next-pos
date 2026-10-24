import { defineConfig } from "prisma/config";
export default defineConfig({
 schema: "../../prisma/saas/schema.prisma",
 migrations: { path: "../../prisma/saas/migrations" },
 // Explicit direct connection only, never the legacy SQLite DATABASE_URL.
 datasource: { url: process.env.SAAS_DIRECT_DATABASE_URL }
});
