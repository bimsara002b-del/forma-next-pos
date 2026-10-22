# Forma Next POS — Next.js-only starter

A **separate** full-stack Next.js POS starter (App Router, TypeScript, Prisma, SQLite). This starter is **not** the existing Laravel/Next.js Forma SaaS POS repository and does **not** touch any existing main/demo data.

## Features in this starter

- Responsive POS screen with searchable product catalog, category filters and USB keyboard-style barcode input
- Cart quantities, server-validated cash checkout and manual card payment **recording** (NOT a card gateway)
- Atomic stock decrements, persisted sale items and stock movement records in SQLite
- Print-friendly receipt after checkout
- Dashboard with recorded sales totals and product overview
- Read-only inventory/product listing
- Keyboard shortcuts: `F2` focus product search, `F4` open checkout, `Esc` close checkout
- Development-mode warning, accessible labels, and basic GitHub Actions lint/type/build checks

## Requirements

- Node.js 20.9+ (Node.js 22 LTS recommended)
- npm

## Quick start

```bash
npm install
cp .env.example .env
npm run db:generate
npm run db:push
npm run db:seed
npm run dev
```

Windows PowerShell: use `Copy-Item .env.example .env` in place of `cp`.

Open **http://localhost:3000**. Default route redirects to `/pos`.

> `db:seed` uses upserts with empty updates, so existing products and sales are not overwritten by repeating the command. Use a different database for production.

## Tech

- Next.js 16 App Router (client components + Node.js Route Handlers)
- React 19 / TypeScript
- Prisma 6 + SQLite for local development
- Plain CSS + Lucide icon components
- Zod 4 for API validation

## Key routes

| Route | Purpose |
| --- | --- |
| `/pos` | Cashier screen |
| `/dashboard` | Summary of database sales |
| `/products` | Read-only product list |
| `GET /api/products` | Active products and stock |
| `POST /api/checkout` | Validate and persist a sale with atomic stock changes |

## Important limitations (must fix before live use)

**This is a development starter, NOT a production-ready POS.** There is **no login, role/tenant isolation, tax/invoice compliance logic, refunds, audit-grade reconciliation, fiscal receipt compliance, live terminal/card authorization, offline sync, automated backups, production database deployment or idempotency key support** yet.

- **DO NOT put this app on the public internet with live business data.** Add authorization and role checks to every API and server page first.
- CARD is only a manual record of an external card transaction; it does not charge a card.
- For production and multiple branches, migrate to PostgreSQL, add immutable audit trail, branch/register stock isolation, payment handling and data migration procedures.
- Barcode input assumes a USB HID scanner that acts like a keyboard and presses Enter after scanning.
- Browser printing works through system print dialogs; automatic thermal printer/cash drawer control may require a local bridge.
- Amounts are stored in integer **cents** (LKR rupees * 100) to prevent floating point errors.
- Do not run Prisma `db push` against an existing production database without migrations and backups.

## Upload into a new GitHub repository

The ChatGPT GitHub connection used to prepare this package does not expose a **create repository** action. The original `forma-saas-pos` repository was not modified.

1. Visit https://github.com/new and create an **empty** private repo named `forma-next-pos`. Do not initialize it with a README/gitignore (they are included here).
2. Unzip this project. In a terminal opened in the project folder, run:

```bash
git init
git add .
git commit -m "Initial Next.js-only POS starter"
git branch -M main
git remote add origin https://github.com/bimsara002b-del/forma-next-pos.git
git push -u origin main
```

Or use GitHub's **Add file → Upload files** to upload the extracted files (including `.github/workflows/ci.yml`).

## Next milestones

1. Auth.js/Better Auth, password policies, cashier roles, secured checkout APIs
2. Branches/registers/shifts, inventory by branch and immutable stock ledger
3. Returns, discounts, VAT/tax rules, receipts, and proper cash reconciliation
4. PostgreSQL migration and SaaS tenant boundaries; integration and load tests
5. Hardware bridge, offline data sync and payment terminal integrations
