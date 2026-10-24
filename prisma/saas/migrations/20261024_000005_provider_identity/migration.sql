-- Opt-in migration for empty isolated SaaS PostgreSQL only.
-- No email matching, auto-provisioning, existing-data migration or live routes.
CREATE TABLE forma_saas.provider_identity (
 issuer text NOT NULL CHECK (length(issuer) BETWEEN 9 AND 512 AND issuer LIKE 'https://%'),
 client_id text NOT NULL CHECK (length(client_id) BETWEEN 3 AND 256),
 subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 255),
 user_id uuid NOT NULL REFERENCES forma_saas.app_user(id) ON DELETE RESTRICT,
 status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED')),
 linked_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(issuer,client_id,subject)
);
CREATE INDEX provider_identity_user_idx ON forma_saas.provider_identity(user_id);
ALTER TABLE forma_saas.provider_identity ENABLE ROW LEVEL SECURITY;
ALTER TABLE forma_saas.provider_identity FORCE ROW LEVEL SECURITY;
-- No policies: identity role and tenant runtime have no direct table access.
-- Lock order: app_user row -> provider_identity row for issue and unlink.
-- Account disabling already locks app_user first, then revokes sessions.
CREATE FUNCTION forma_saas.identity_issue_provider_session(
 p_issuer text,p_client_id text,p_subject text,p_token_hash text,
 p_created_at timestamptz,p_expires_at timestamptz)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $$
DECLARE linked_user uuid;
DECLARE account_status text;
DECLARE link_status text;
BEGIN
 IF p_issuer IS NULL OR p_client_id IS NULL OR p_subject IS NULL OR
    length(p_issuer) NOT BETWEEN 9 AND 512 OR left(p_issuer,8) <> 'https://' OR
    length(p_client_id) NOT BETWEEN 3 AND 256 OR length(p_subject) NOT BETWEEN 1 AND 255 OR
    p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' OR
    p_created_at IS NULL OR p_expires_at IS NULL OR
    p_created_at < statement_timestamp()-interval '5 minutes' OR
    p_created_at > statement_timestamp()+interval '30 seconds' OR
    p_expires_at <= p_created_at OR p_expires_at > p_created_at+interval '8 hours'
 THEN RAISE EXCEPTION 'INVALID_PROVIDER_SESSION' USING ERRCODE='22023'; END IF;

 SELECT user_id INTO linked_user FROM forma_saas.provider_identity
 WHERE issuer=p_issuer AND client_id=p_client_id AND subject=p_subject;
 IF linked_user IS NULL THEN RAISE EXCEPTION 'UNLINKED_IDENTITY' USING ERRCODE='P0001'; END IF;
 SELECT status INTO account_status FROM forma_saas.app_user
 WHERE id=linked_user FOR UPDATE;
 SELECT status,user_id INTO link_status,linked_user FROM forma_saas.provider_identity
 WHERE issuer=p_issuer AND client_id=p_client_id AND subject=p_subject FOR UPDATE;
 IF account_status IS DISTINCT FROM 'ACTIVE' OR link_status IS DISTINCT FROM 'ACTIVE'
 THEN RAISE EXCEPTION 'ACCOUNT_OR_LINK_DISABLED' USING ERRCODE='P0001'; END IF;
 INSERT INTO forma_saas.app_session(token_hash,user_id,created_at,expires_at)
 VALUES(p_token_hash,linked_user,p_created_at,p_expires_at);
 RETURN linked_user;
END;
$$;
REVOKE ALL ON FUNCTION forma_saas.identity_issue_provider_session(text,text,text,text,timestamptz,timestamptz) FROM PUBLIC;

CREATE FUNCTION forma_saas.identity_unlink_provider(
 p_issuer text,p_client_id text,p_subject text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $$
DECLARE linked_user uuid;
DECLARE changed integer;
BEGIN
 SELECT user_id INTO linked_user FROM forma_saas.provider_identity
 WHERE issuer=p_issuer AND client_id=p_client_id AND subject=p_subject;
 IF linked_user IS NULL THEN RETURN 0; END IF;
 PERFORM 1 FROM forma_saas.app_user WHERE id=linked_user FOR UPDATE;
 UPDATE forma_saas.provider_identity SET status='REVOKED'
 WHERE issuer=p_issuer AND client_id=p_client_id AND subject=p_subject;
 GET DIAGNOSTICS changed=ROW_COUNT;
 -- Conservative policy: revoke every session belonging to the linked user.
 UPDATE forma_saas.app_session SET revoked_at=statement_timestamp()
 WHERE user_id=linked_user AND revoked_at IS NULL;
 RETURN changed;
END;
$$;
REVOKE ALL ON FUNCTION forma_saas.identity_unlink_provider(text,text,text) FROM PUBLIC;
-- Both functions require separate reviewed EXECUTE grants. Never grant to
-- PUBLIC, tenant runtime, or browser identities.
