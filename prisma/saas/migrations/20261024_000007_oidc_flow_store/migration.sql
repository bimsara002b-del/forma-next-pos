-- M30 opt-in persisted OIDC PKCE callback state; separate SaaS DB only.
-- No merchant data operation. No PUBLIC or tenant runtime privileges.
CREATE TABLE forma_saas.oidc_auth_flow (
 state_digest char(64) PRIMARY KEY CHECK (state_digest ~ '^[0-9a-f]{64}$'),
 verifier char(43) NOT NULL CHECK (verifier ~ '^[A-Za-z0-9_-]{43}$'),
 nonce char(43) NOT NULL CHECK (nonce ~ '^[A-Za-z0-9_-]{43}$'),
 config_hash char(64) NOT NULL CHECK (config_hash ~ '^[0-9a-f]{64}$'),
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 expires_at timestamptz NOT NULL,
 CHECK (expires_at > created_at),
 CHECK (expires_at <= created_at + interval '5 minutes')
);
CREATE INDEX oidc_auth_flow_expiry_idx ON forma_saas.oidc_auth_flow(expires_at);
ALTER TABLE forma_saas.oidc_auth_flow ENABLE ROW LEVEL SECURITY;
ALTER TABLE forma_saas.oidc_auth_flow FORCE ROW LEVEL SECURITY;
-- No RLS policy; direct access is blocked for all app roles.
CREATE FUNCTION forma_saas.oidc_flow_begin(
 p_digest text,p_verifier text,p_nonce text,p_config_hash text,p_expires_at timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF p_digest IS NULL OR p_digest !~ '^[0-9a-f]{64}$'
  OR p_verifier IS NULL OR p_verifier !~ '^[A-Za-z0-9_-]{43}$'
  OR p_nonce IS NULL OR p_nonce !~ '^[A-Za-z0-9_-]{43}$'
  OR p_config_hash IS NULL OR p_config_hash !~ '^[0-9a-f]{64}$'
  OR p_expires_at IS NULL OR p_expires_at<=statement_timestamp()
  OR p_expires_at>statement_timestamp()+interval '5 minutes'
 THEN RAISE EXCEPTION 'INVALID_OIDC_FLOW' USING ERRCODE='22023'; END IF;
 INSERT INTO forma_saas.oidc_auth_flow(
  state_digest,verifier,nonce,config_hash,expires_at
 ) VALUES(p_digest,p_verifier,p_nonce,p_config_hash,p_expires_at);
END;
$$;
REVOKE ALL ON FUNCTION forma_saas.oidc_flow_begin(text,text,text,text,timestamptz) FROM PUBLIC;

-- Atomic cross-process one-time consumption: only one DELETE may return a row.
-- Invalid/expired state is also removed upon attempted consumption.
CREATE FUNCTION forma_saas.oidc_flow_consume(p_digest text)
RETURNS TABLE(digest text,verifier text,nonce text,config_hash text,expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF p_digest IS NULL OR p_digest !~ '^[0-9a-f]{64}$'
 THEN RAISE EXCEPTION 'INVALID_OIDC_STATE_DIGEST' USING ERRCODE='22023'; END IF;
 RETURN QUERY WITH consumed AS (
  DELETE FROM forma_saas.oidc_auth_flow f
  WHERE f.state_digest=p_digest
  RETURNING f.state_digest,f.verifier,f.nonce,f.config_hash,f.expires_at
 )
 SELECT c.state_digest::text,c.verifier::text,c.nonce::text,
        c.config_hash::text,c.expires_at
 FROM consumed c WHERE c.expires_at>statement_timestamp();
END;
$$;
REVOKE ALL ON FUNCTION forma_saas.oidc_flow_consume(text) FROM PUBLIC;
-- Independently provision exact EXECUTE grants only for dedicated OIDC flow
-- service role; all login, token exchange and deployment remain disabled.
