-- Opt-in SaaS only; additive session storage. No legacy data copied or deleted.
-- Provisioning/rotation/revocation belongs to a separate trusted identity service.
CREATE TABLE forma_saas.app_session (
 token_hash char(64) PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
 user_id uuid NOT NULL REFERENCES forma_saas.app_user(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 CHECK (expires_at > created_at),
 CHECK (expires_at <= created_at + interval '8 hours')
);
CREATE INDEX app_session_user ON forma_saas.app_session(user_id);
CREATE INDEX app_session_expiry ON forma_saas.app_session(expires_at);
ALTER TABLE forma_saas.app_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE forma_saas.app_session FORCE ROW LEVEL SECURITY;
CREATE POLICY presented_session ON forma_saas.app_session FOR SELECT
 USING (token_hash = nullif(current_setting('app.session_hash', true), '')
   AND revoked_at IS NULL AND expires_at > statement_timestamp());
-- No runtime INSERT/UPDATE/DELETE policy: possession never grants session minting.
ALTER TABLE forma_saas.app_user ENABLE ROW LEVEL SECURITY;
ALTER TABLE forma_saas.app_user FORCE ROW LEVEL SECURITY;
CREATE POLICY authenticated_session_user ON forma_saas.app_user FOR SELECT
 USING (status = 'ACTIVE' AND EXISTS (
  SELECT 1 FROM forma_saas.app_session s WHERE s.user_id = app_user.id
  -- app_session RLS restricts this to the presented, unexpired, unrevoked session.
 ));
