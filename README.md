# Forma Next POS — Next.js-only Cashier MVP

Separate lightweight point-of-sale system built with **Next.js 16 (App Router) + TypeScript + Prisma + SQLite**. This repository is independent of the older Laravel-backed Forma POS; existing Main/Demo databases are not touched.

## Includes
- Password-gated development demo with signed HttpOnly session cookie (8-hour session)
- Keyboard-first cashier screen: F2 search, barcode/SKU scan-to-add, F4 checkout, Esc dismiss
- Cash sales (server-validated totals), idempotency key for retry, atomic stock decrements
- Print-friendly 80mm receipts; stock movement ledger
- Add products, receive/adjust stock, sales history and dashboard
- Sample products added by an **idempotent**, non-destructive seed script
- Basic automated currency tests and pull request CI

## Quick start — Codespaces or local (Node.js 22)
Open the **repository root** in your terminal.

    npm install
    npm run setup
    npm run db:generate
    npm run db:push
    npm run db:seed
    npm run dev

Run setup **once**. It creates a gitignored local .env file, prints a random access password and leaves any existing .env unchanged. Sign in using that password at port 3000. Codespaces: open the **Ports** tab, locate 3000, and open its forwarded URL. A fresh npm install will produce a normal package-lock.json; commit this lockfile for repeatable CI before enabling branch protection.

If you see Prisma errors, make sure you generated the client and created the database; check that .env has DATABASE_URL set. When changing the Prisma schema in this starter, use controlled migrations before any production deployment, not destructive db push.

## Folder map
- src/app/page.tsx: protected application
- src/components/pos-workspace.tsx: cashier, inventory, sales and dashboard UI
- src/app/api/products: catalog list/create
- src/app/api/checkout: cash checkout transaction and idempotent retry
- src/app/api/stock: receive or adjust stock with movement ledger
- src/app/api/overview: dashboard and recent sales
- src/app/api/auth: demo login/logout
- prisma/schema.prisma and prisma/seed.mjs: SQLite data model and safe sample catalog

## Security & production limitations
**This is a local/pilot demo, NOT a production-ready POS or multi-tenant SaaS. Do not deploy with live financial/customer information or expose an unprotected Codespaces port publicly.** The temporary single-password login does not support per-user roles, MFA, login rate limiting, server-side session revocation, tenant isolation or audit-grade financial workflows. Before going live, add robust user authentication/authorization, migrations, tested backups, payment/receipt compliance, refunds, cashier shifts, multi-branch stock and PostgreSQL deployment.

- Cash **only**: no credit card processing is implemented or claimed.
- Browser print invokes the print dialog; silent ESC/POS printing needs validated device integration.
- No offline checkout or sync yet.
- Money is stored in integer cents. No tax/discount or Sri Lankan fiscal certification is implied.
- Repeated seed runs do not overwrite changed inventory or sales.
- For local passwords, rotate .env and restart the server as necessary.
- Every environment must use its own database.

Research and roadmap are maintained in the project Notion Blueprint (Forma Next POS).
