-- M26 opt-in PostgreSQL foundation, NEW EMPTY DATABASES ONLY.
-- NEVER run on the legacy SQLite POS or a production DB.
-- No DROP / TRUNCATE / UPDATE / DELETE / copy of legacy records.
-- PostgreSQL role grants and DB provisioning are separate audited steps.
CREATE SCHEMA forma_saas;

CREATE TABLE forma_saas.app_user (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_normalized text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE forma_saas.tenant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  legal_name text NOT NULL,
  timezone text NOT NULL DEFAULT 'Asia/Colombo',
  currency_code text NOT NULL DEFAULT 'LKR',
  status text NOT NULL DEFAULT 'TRIALING',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_slug_nonblank CHECK (length(trim(slug)) > 0)
);
CREATE TABLE forma_saas.tenant_membership (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES forma_saas.tenant(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES forma_saas.app_user(id) ON DELETE RESTRICT,
  role text NOT NULL DEFAULT 'CASHIER' CHECK (role IN ('OWNER','MANAGER','CASHIER','INVENTORY_CLERK')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INVITED','REVOKED','SUSPENDED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, user_id)
);
CREATE TABLE forma_saas.branch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES forma_saas.tenant(id) ON DELETE RESTRICT,
  code text NOT NULL,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);
CREATE TABLE forma_saas.register (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES forma_saas.tenant(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL,
  code text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, branch_id, code),
  UNIQUE (tenant_id, branch_id, id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES forma_saas.branch(tenant_id, id) ON DELETE RESTRICT
);
CREATE TABLE forma_saas.product (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES forma_saas.tenant(id) ON DELETE RESTRICT,
  sku text NOT NULL,
  barcode text,
  name text NOT NULL,
  price_minor bigint NOT NULL CHECK (price_minor >= 0),
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, sku),
  UNIQUE (tenant_id, barcode)
);
CREATE TABLE forma_saas.sale (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES forma_saas.tenant(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL,
  register_id uuid NOT NULL,
  cashier_membership_id uuid NOT NULL,
  request_id uuid NOT NULL,
  receipt_number text NOT NULL,
  total_minor bigint NOT NULL CHECK (total_minor >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, request_id),
  UNIQUE (tenant_id, receipt_number),
  UNIQUE (tenant_id, branch_id, id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES forma_saas.branch(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, branch_id, register_id) REFERENCES forma_saas.register(tenant_id, branch_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, cashier_membership_id)
    REFERENCES forma_saas.tenant_membership(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX sale_branch_time ON forma_saas.sale (tenant_id, branch_id, created_at);
CREATE TABLE forma_saas.sale_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES forma_saas.tenant(id) ON DELETE RESTRICT,
  sale_id uuid NOT NULL,
  product_id uuid NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price_minor bigint NOT NULL CHECK (unit_price_minor >= 0),
  line_total_minor bigint NOT NULL CHECK (line_total_minor >= 0),
  FOREIGN KEY (tenant_id, sale_id) REFERENCES forma_saas.sale(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, product_id) REFERENCES forma_saas.product(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX sale_line_tenant_sale ON forma_saas.sale_line (tenant_id, sale_id);
CREATE TABLE forma_saas.stock_balance (
  tenant_id uuid NOT NULL REFERENCES forma_saas.tenant(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL,
  product_id uuid NOT NULL,
  quantity integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  PRIMARY KEY (tenant_id, branch_id, product_id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES forma_saas.branch(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, product_id) REFERENCES forma_saas.product(tenant_id, id) ON DELETE RESTRICT
);
CREATE TABLE forma_saas.stock_movement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES forma_saas.tenant(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL,
  product_id uuid NOT NULL,
  sale_id uuid,
  quantity_delta integer NOT NULL CHECK (quantity_delta <> 0),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES forma_saas.branch(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, product_id) REFERENCES forma_saas.product(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, branch_id, sale_id) REFERENCES forma_saas.sale(tenant_id, branch_id, id) ON DELETE RESTRICT
);
CREATE INDEX movement_tenant_branch_time ON forma_saas.stock_movement (tenant_id, branch_id, created_at);
CREATE INDEX movement_tenant_product_time ON forma_saas.stock_movement (tenant_id, product_id, created_at);

-- Fail closed without a transaction-local, server-verified tenant context.
-- A custom GUC is NOT an authentication mechanism. The app DAL MUST validate
-- current membership before setting it and use a dedicated non-BYPASSRLS role.
-- Never use set_config('app.tenant_id', ..., false) with pooled connections.
ALTER TABLE forma_saas.tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE forma_saas.tenant FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_self ON forma_saas.tenant
  USING (id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (id = nullif(current_setting('app.tenant_id', true), '')::uuid);
-- Use identical policy for every tenant-owned table. No implicit cross-tenant
-- SELECT, INSERT, UPDATE or DELETE access, even via missing tenant filters.
DO $rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'tenant_membership','branch','register','product','sale',
    'sale_line','stock_balance','stock_movement'
  ] LOOP
    EXECUTE format('ALTER TABLE forma_saas.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE forma_saas.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_scope ON forma_saas.%I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
      table_name
    );
  END LOOP;
END
$rls$;
