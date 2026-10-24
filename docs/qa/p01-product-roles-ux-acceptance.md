# P01 — Product Roles and Checkout Acceptance (24 October 2026)

Source: https://app.notion.com/p/401eb688004781b48377ec54b9b34c99

## Evidence levels
- Code present != integration accepted, hardware accepted, or production ready.
- Existing SQLite single-store runtime remains active. Separate PostgreSQL/Prisma 7 SaaS package has not been cut over.
- Do not deploy, change tenant data, or run migrations from this P01 task.

## P0 — Functional acceptance matrix
| ID | User story / requirement | Evidence / state | Next verification |
| --- | --- | --- | --- |
| P01-A01 | Exact barcode beats colliding SKU; duplicate exact barcode must fail closed | Updated scanner resolution and unit tests in this branch | CI then USB HID scanner field test |
| P01-A02 | Repeated scans increment quantities but never exceed visible stock | `checkout-scanner.ts` and tests present | Hardware rapid-scan test |
| P01-A03 | Same checkout ID cannot duplicate sales; failure preserves retry ID/cart | `commitCashCheckout` and checkout route present | Browser retry and network-failure E2E |
| P01-A04 | Server revalidates prices/stock; concurrent oversell rejected | Single-store checkout implementation/tests present | PostgreSQL tenant-scoped concurrency E2E |
| P01-A05 | Cashier cannot read costs, staff control, platform data | Single-store role gate/catalog projection tests present | Cross-role browser/API tests |
| P01-A06 | Owner/manager/cashier/inventory staff assignments scoped by tenant, branch and register | Separate SaaS authorization contract tests exist | Wire verified identity and PostgreSQL DAL; adversarial HTTP tests |
| P01-A07 | Shift float/open/close, cash movement audit and settlement variance | Single-store shift and reconciliation code present | Physical till/cash count pilot |
| P01-A08 | 1366x768 and 1920x1080 checkout requires no outer checkout scroll | CSS grid with internal scroll present | Browser screenshot acceptance |
| P01-A09 | F2 scan/F3 search/F4 pay; ESC dismissal; accessible labels and focus | POS component code present | Keyboard conflict/accessibility audit |
| P01-A10 | Printed sale can be reprinted safely without another payment | Printable committed receipt UI exists | Real 58/80mm print/reprint test |
| P01-A11 | Refund reason, authorized approval, tender reversal, inventory movement | Manual returns code present | End-to-end financial reconciliation tests |
| P01-A12 | Owner/admin onboarding, subscriptions, plans, quotas and safe support access | Spec only / SaaS foundation incomplete | Verified identity, tenant DAL, billing and platform controls |

## Role boundaries
- Platform SUPER_ADMIN: platform support and billing; no permanent tenant sale/PII access.
- Tenant OWNER: own tenant only, multi-branch subject to entitlements.
- MANAGER: only explicitly assigned branches/registers; approvals as policy allows.
- CASHIER: own assigned register checkout/shift; no purchase cost or platform role management.
- INVENTORY_CLERK: assigned inventory and purchase workflows; no settlement.
- ACCOUNTANT / viewer: deferred explicit report/export grants.

## Hard release gates
1. Verified provider login and trusted isolated session writer, revoke-on-disable and CSRF validation.
2. Every served retail route uses tenant-safe PostgreSQL financial DAL, composite foreign keys and fail-closed checks.
3. Adversarial Tenant A to Tenant B tests for all IDs, receipts, downloads and exports.
4. Atomic sale + tender + stock + receipt commit and idempotent retries under concurrency.
5. Real keyboard, scanner, printer, accessibility and recovery rehearsal.
6. Merchant discovery, minimum five observed cashier sessions; pilot approval before production claim.

## P01 change record
- 2026-10-24: Exact barcode matching now precedes case-insensitive SKU fallback; duplicate barcodes still fail closed. Unit tests added for exact barcode precedence, duplicate barcode, ambiguous fallback and cart stock caps.
- Status: Code committed on review branch. CI/hardware verification not yet established by this document.
