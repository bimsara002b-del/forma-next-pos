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


## Milestone 01 — Checkout and Codespaces security (feature branch)

- **Codespaces:** Same-Origin checks now compare the exact GitHub forwarded app URL derived from Codespaces environment variables rather than simply comparing the internal localhost URL. Other site Origins remain blocked. Keep the port **Private**.
- **Cash checkout:** Repeat submissions using the same request UUID and *same cart/tender* return the original receipt. Reusing the key with a different payload gives HTTP 409; concurrent/ambiguous failures should be retried with the same unchanged request. The cashier modal locks tender/cancel on any unconfirmed error to protect against accidentally creating a different sale.
- **Integration tests:** CI prepares a disposable, separate SQLite database and runs payment, idempotency, stock ledger and concurrent last-unit tests. Unit tests run without touching local demo databases. To run the integration suite locally, initialize a separate file called \`prisma/pos-integration.test.db\` and set \`POS_TEST_DATABASE_URL=file:./pos-integration.test.db\` explicitly; do not point tests to the demo database.

**Important:** This is still a development demo with a shared password, no user-level roles, no audited cash sessions, refunds or real card payments. Never use it for real customer payment processing. Field testing after Codespaces login is still required.


## Optional staff login foundation (experimental)
The current shared-password login remains the default. After backing up the local demo database, run npm run db:generate and npm run db:push. Run npm run staff:bootstrap to create username owner with the existing POS_ACCESS_PASSWORD. Add POS_STAFF_AUTH_ENABLED=true to your untracked .env and restart to enable staff login. Turn the flag back off to return to demo access. This experimental feature lacks login rate limiting, user management UI, password resets, MFA, multi-tenant separation and production hardening. Do not use it with real retail records.


## Milestone 04 — Local Staff Management and Login Protection

The opt-in staff login now has an owner-only Staff Management page at /staff. When staff mode is enabled, an OWNER can add users, temporarily disable or re-enable staff, and reset passwords. Such changes bump a session version and invalidate old signed staff sessions. A minimal account audit table records actor, target and action without passwords. A persistent per-username, local SQLite failed-login throttle delays sign-in after five failed attempts in 15 minutes. This is **not distributed/IP-scoped rate limiting** and is insufficient alone for public production deployment.

To test in private Codespaces, protect/backup the local SQLite database, pull this branch and run npm run db:generate then npm run db:push, followed by npm run staff:bootstrap. Set POS_STAFF_AUTH_ENABLED=true in the local .env and restart the server. Sign in with username owner and the local password; open Staff Accounts from the sidebar. Do not share .env or use real merchant data. For production: proper migrations, distributed throttling, MFA, audit policy, tenancy and deployment hardening still required.


## Milestone 05 — Cashier Shift and Single Cash Register Demo

A local REG-01 register can open and close a shift, record cash in/out with unique request IDs and reconcile counted against expected cash. Checkout sales are attributed atomically to any open shift. Existing demo sales continue without a shift unless POS_REQUIRE_OPEN_SHIFT=true is set in the private root .env; in that strict mode, new cash sales require an open shift. Retry of an already committed cash checkout is allowed to resolve even after shift close. This is a one-register local pilot, not audited X/Z reporting or a multi-tenant branch register. No card processing, refunds or denomination tracking.

For local testing, back up your isolated SQLite demo database first, generate the Prisma client and apply the additive schema only to that demo (npm run db:generate; npm run db:push). Do not run db:push on any production database. Open the Cash Shifts navigation tab, open a shift, make a cash sale, then close with counted cash. Verify that the receipt is attributed to the shift and stock remains correct. Keep Codespaces ports Private.


## Advanced Inventory UI and isolated integration tests (Milestone 06 follow-up)

The Inventory view includes an advanced section where owner/manager can:
- Edit SKU, barcode, product prices, cost and low-stock threshold without changing old sale lines.
- Soft-archive or restore items while keeping past sale/movement records.
- Receive several products against a supplier invoice; quantities and latest cost are applied transactionally. Retrying the same UUID and exact payload does not double-receive.
- Reconcile a physical stock count only when the previously displayed stock still matches; a concurrent sale makes the count fail with a conflict.
- Review receiving receipts and stock movement history.

**Do not run in production.** For an isolated local demo, back up the SQLite file first, then run \`npm run db:generate\` and \`npm run db:push\` after reviewing schema changes. CI uses a separate \`inventory-integration.test.db\` file for receiving/count tests and does not touch user databases. Any uncertain receiving outcome must be retried with the same request ID and unchanged details. No suppliers/AP, purchase approvals, tax, exports or multi-tenant isolation are included.
