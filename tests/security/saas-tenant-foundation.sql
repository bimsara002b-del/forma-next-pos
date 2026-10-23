\set ON_ERROR_STOP on
-- Runs only against disposable GitHub Actions PostgreSQL service; all changes
-- including migration, fixtures and role are rolled back by the outer TX.
DO $guard$ BEGIN
 IF current_database() <> 'forma_saas_ci' THEN
  RAISE EXCEPTION 'Use only a disposable database named forma_saas_ci';
 END IF;
END $guard$;
BEGIN;
\ir ../../prisma/saas/migrations/20261023_000001_tenant_foundation/migration.sql

INSERT INTO forma_saas.app_user(id,email_normalized) VALUES
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','a@example.test');
INSERT INTO forma_saas.tenant(id,slug,legal_name) VALUES
 ('11111111-1111-1111-1111-111111111111','shop-a','Shop A'),
 ('22222222-2222-2222-2222-222222222222','shop-b','Shop B');
INSERT INTO forma_saas.tenant_membership(id,tenant_id,user_id,role) VALUES
 ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','OWNER');
INSERT INTO forma_saas.branch(id,tenant_id,code,name) VALUES
 ('aaaaaaaa-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111','A','Branch A'),
 ('aaaaaaaa-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','A2','Branch A2'),
 ('bbbbbbbb-2222-2222-2222-222222222222','22222222-2222-2222-2222-222222222222','B','Branch B');
INSERT INTO forma_saas.register(id,tenant_id,branch_id,code) VALUES
 ('aaaaaaaa-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111','aaaaaaaa-1111-1111-1111-111111111111','REG-A');
INSERT INTO forma_saas.product(id,tenant_id,sku,name,price_minor) VALUES
 ('aaaaaaaa-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111','SKU-A','Product A',500),
 ('bbbbbbbb-5555-5555-5555-555555555555','22222222-2222-2222-2222-222222222222','SKU-B','Product B',800);

-- App role is not a superuser, table owner or BYPASSRLS role.
CREATE ROLE forma_saas_ci_reader NOLOGIN NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA forma_saas TO forma_saas_ci_reader;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  forma_saas.tenant, forma_saas.tenant_membership,
  forma_saas.branch, forma_saas.register, forma_saas.product,
  forma_saas.sale, forma_saas.sale_line, forma_saas.stock_balance,
  forma_saas.stock_movement TO forma_saas_ci_reader;
SET ROLE forma_saas_ci_reader;

-- Without context RLS must return zero rows.
DO $test$
BEGIN
 IF (SELECT count(*) FROM forma_saas.product) <> 0 THEN
   RAISE EXCEPTION 'FAIL: tenant data visible without context';
 END IF;
END
$test$;
SELECT set_config('app.tenant_id','11111111-1111-1111-1111-111111111111',true);

DO $test$
BEGIN
 IF (SELECT count(*) FROM forma_saas.product) <> 1 OR
    (SELECT count(*) FROM forma_saas.branch) <> 2 OR
    (SELECT count(*) FROM forma_saas.tenant) <> 1 THEN
   RAISE EXCEPTION 'FAIL: tenant A read scope';
 END IF;
 IF (SELECT count(*) FROM forma_saas.product
     WHERE id = 'bbbbbbbb-5555-5555-5555-555555555555') <> 0 THEN
   RAISE EXCEPTION 'FAIL: forged B product ID leaked';
 END IF;
 IF (SELECT count(*) FROM forma_saas.tenant_membership) <> 1 THEN
   RAISE EXCEPTION 'FAIL: tenant membership isolation';
 END IF;
END
$test$;

-- A rogue cross-tenant insert is denied by WITH CHECK, not just WHERE.
DO $test$
BEGIN
  BEGIN
    INSERT INTO forma_saas.product(tenant_id,sku,name,price_minor) VALUES
      ('22222222-2222-2222-2222-222222222222','INJECT','Forbidden',1);
    RAISE EXCEPTION 'FAIL: cross-tenant insert unexpectedly accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$test$;
DO $test$
BEGIN
 UPDATE forma_saas.product SET price_minor = 1
   WHERE id = 'bbbbbbbb-5555-5555-5555-555555555555';
 IF FOUND THEN
   RAISE EXCEPTION 'FAIL: cross-tenant update affected rows';
 END IF;
END
$test$;
-- RLS must protect DELETE and tenant reassignment too.
DO $test$
BEGIN
 DELETE FROM forma_saas.product WHERE sku = 'SKU-B';
 IF FOUND THEN RAISE EXCEPTION 'FAIL: cross-tenant delete'; END IF;
 BEGIN
  UPDATE forma_saas.product SET tenant_id = '22222222-2222-2222-2222-222222222222'
    WHERE sku = 'SKU-A';
  RAISE EXCEPTION 'FAIL: tenant reassignment accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $test$;
-- Switching verified context on the same connection never reveals tenant A.
SAVEPOINT context_a;
SELECT set_config('app.tenant_id','22222222-2222-2222-2222-222222222222',true);
DO $test$ BEGIN
 IF (SELECT count(*) FROM forma_saas.product) <> 1 OR
    EXISTS (SELECT 1 FROM forma_saas.product WHERE sku = 'SKU-A') THEN
  RAISE EXCEPTION 'FAIL: tenant B context leaked A';
 END IF;
END $test$;
ROLLBACK TO SAVEPOINT context_a;

-- Simulate a rolled-back financial mutation (both sale and stock ledger).
DO $test$
BEGIN
  BEGIN
    INSERT INTO forma_saas.sale(
      id,tenant_id,branch_id,register_id,cashier_membership_id,
      request_id,receipt_number,total_minor
    ) VALUES (
      'aaaaaaaa-6666-6666-6666-666666666666',
      '11111111-1111-1111-1111-111111111111',
      'aaaaaaaa-1111-1111-1111-111111111111',
      'aaaaaaaa-3333-3333-3333-333333333333',
      'aaaaaaaa-0000-0000-0000-000000000001',
      'aaaaaaaa-7777-7777-7777-777777777777','A-001',500
    );
    INSERT INTO forma_saas.stock_movement(tenant_id,branch_id,product_id,sale_id,quantity_delta,reason)
    VALUES (
      '11111111-1111-1111-1111-111111111111',
      'aaaaaaaa-1111-1111-1111-111111111111',
      'aaaaaaaa-4444-4444-4444-444444444444',
      'aaaaaaaa-6666-6666-6666-666666666666',-1,'SALE'
    );
    RAISE EXCEPTION USING ERRCODE = 'P2001', MESSAGE = 'expected_rollback';
  EXCEPTION WHEN SQLSTATE 'P2001' THEN NULL;
  END;
  IF (SELECT count(*) FROM forma_saas.sale) <> 0 OR
     (SELECT count(*) FROM forma_saas.stock_movement) <> 0 THEN
    RAISE EXCEPTION 'FAIL: failed checkout did not roll back';
  END IF;
END
$test$;
RESET ROLE;

-- Composite FK rejects B branch reference in tenant A register, even for
-- privileged migrator (FK owner constraint, independent of RLS).
DO $test$
BEGIN
  BEGIN
    INSERT INTO forma_saas.register(tenant_id,branch_id,code) VALUES (
      '11111111-1111-1111-1111-111111111111',
      'bbbbbbbb-2222-2222-2222-222222222222','WRONG'
    );
    RAISE EXCEPTION 'FAIL: composite FK did not reject cross-tenant branch';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
END
$test$;
-- Same-tenant cross-branch links must fail even when RLS is bypassed by
-- the migrator. Tenant-only foreign keys are insufficient for these links.
DO $test$
BEGIN
 BEGIN
  INSERT INTO forma_saas.sale(tenant_id,branch_id,register_id,cashier_membership_id,request_id,receipt_number,total_minor)
  VALUES ('11111111-1111-1111-1111-111111111111','aaaaaaaa-2222-2222-2222-222222222222',
    'aaaaaaaa-3333-3333-3333-333333333333','aaaaaaaa-0000-0000-0000-000000000001',
    gen_random_uuid(),'WRONG-BRANCH',500);
  RAISE EXCEPTION 'FAIL: sale accepted register in another branch';
 EXCEPTION WHEN foreign_key_violation THEN NULL;
 END;
 INSERT INTO forma_saas.sale(id,tenant_id,branch_id,register_id,cashier_membership_id,request_id,receipt_number,total_minor)
 VALUES ('aaaaaaaa-6666-6666-6666-666666666666','11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-1111-1111-1111-111111111111','aaaaaaaa-3333-3333-3333-333333333333',
   'aaaaaaaa-0000-0000-0000-000000000001',gen_random_uuid(),'VALID-A',500);
 BEGIN
  INSERT INTO forma_saas.stock_movement(tenant_id,branch_id,product_id,sale_id,quantity_delta,reason)
  VALUES ('11111111-1111-1111-1111-111111111111','aaaaaaaa-2222-2222-2222-222222222222',
    'aaaaaaaa-4444-4444-4444-444444444444','aaaaaaaa-6666-6666-6666-666666666666',-1,'SALE');
  RAISE EXCEPTION 'FAIL: movement accepted sale in another branch';
 EXCEPTION WHEN foreign_key_violation THEN NULL;
 END;
 -- Valid branch link and non-sale adjustment must still work.
 INSERT INTO forma_saas.stock_movement(tenant_id,branch_id,product_id,sale_id,quantity_delta,reason)
 VALUES ('11111111-1111-1111-1111-111111111111','aaaaaaaa-1111-1111-1111-111111111111',
   'aaaaaaaa-4444-4444-4444-444444444444','aaaaaaaa-6666-6666-6666-666666666666',-1,'SALE');
 INSERT INTO forma_saas.stock_movement(tenant_id,branch_id,product_id,quantity_delta,reason)
 VALUES ('11111111-1111-1111-1111-111111111111','aaaaaaaa-2222-2222-2222-222222222222',
   'aaaaaaaa-4444-4444-4444-444444444444',1,'OPENING');
END $test$;
ROLLBACK;
-- After rollback the entire schema and temporary role must be absent.
DO $test$
BEGIN
 IF nullif(current_setting('app.tenant_id', true), '') IS NOT NULL THEN
   RAISE EXCEPTION 'FAIL: tenant context survived transaction rollback';
 END IF;
 IF to_regclass('forma_saas.product') IS NOT NULL OR
    EXISTS (SELECT 1 FROM pg_roles WHERE rolname='forma_saas_ci_reader') THEN
   RAISE EXCEPTION 'FAIL: migration/role rollback left side effects';
 END IF;
END
$test$;
\echo PASS: RLS denial, forged reads/writes, composite ownership, atomic rollback, migration rollback
