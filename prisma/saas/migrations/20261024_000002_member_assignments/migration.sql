-- Additive PostgreSQL-only assignment persistence; not executed on merchant DBs.
CREATE TABLE forma_saas.member_branch (
 tenant_id uuid NOT NULL, membership_id uuid NOT NULL, branch_id uuid NOT NULL,
 PRIMARY KEY (tenant_id,membership_id,branch_id),
 FOREIGN KEY (tenant_id,membership_id) REFERENCES forma_saas.tenant_membership(tenant_id,id) ON DELETE RESTRICT,
 FOREIGN KEY (tenant_id,branch_id) REFERENCES forma_saas.branch(tenant_id,id) ON DELETE RESTRICT
);
CREATE TABLE forma_saas.member_register (
 tenant_id uuid NOT NULL, membership_id uuid NOT NULL, branch_id uuid NOT NULL, register_id uuid NOT NULL,
 PRIMARY KEY (tenant_id,membership_id,register_id),
 FOREIGN KEY (tenant_id,membership_id) REFERENCES forma_saas.tenant_membership(tenant_id,id) ON DELETE RESTRICT,
 FOREIGN KEY (tenant_id,membership_id,branch_id) REFERENCES forma_saas.member_branch(tenant_id,membership_id,branch_id) ON DELETE RESTRICT,
 FOREIGN KEY (tenant_id,branch_id,register_id) REFERENCES forma_saas.register(tenant_id,branch_id,id) ON DELETE RESTRICT
);
ALTER TABLE forma_saas.member_branch ENABLE ROW LEVEL SECURITY;
ALTER TABLE forma_saas.member_branch FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON forma_saas.member_branch
 USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE forma_saas.member_register ENABLE ROW LEVEL SECURITY;
ALTER TABLE forma_saas.member_register FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON forma_saas.member_register
 USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
