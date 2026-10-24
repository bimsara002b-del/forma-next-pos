-- M30-06 opt-in identity account immutability hardening.
-- Apply ONLY to a reviewed, isolated SaaS PostgreSQL database after 000005.
-- No merchant data migration, DROP, TRUNCATE or bulk updates.
-- Links are immutable by policy: revoke and provision a distinct subject instead.
CREATE FUNCTION forma_saas.deny_provider_identity_reassignment()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NEW.issuer IS DISTINCT FROM OLD.issuer OR
    NEW.client_id IS DISTINCT FROM OLD.client_id OR
    NEW.subject IS DISTINCT FROM OLD.subject OR
    NEW.user_id IS DISTINCT FROM OLD.user_id THEN
  RAISE EXCEPTION 'PROVIDER_IDENTITY_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER provider_identity_link_immutable
BEFORE UPDATE OF issuer,client_id,subject,user_id
ON forma_saas.provider_identity
FOR EACH ROW EXECUTE FUNCTION forma_saas.deny_provider_identity_reassignment();
-- Recheck unchanged account binding after acquiring both account/link locks;
-- reject even if a privileged owner deleted/reinserted the link mid-request.
CREATE OR REPLACE FUNCTION forma_saas.identity_issue_provider_session(
 p_issuer text,p_client_id text,p_subject text,p_token_hash text,
 p_created_at timestamptz,p_expires_at timestamptz)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $$
DECLARE linked_user uuid;
DECLARE account_status text;
DECLARE link_status text;
DECLARE rechecked_user uuid;
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
 SELECT status,user_id INTO link_status,rechecked_user FROM forma_saas.provider_identity
 WHERE issuer=p_issuer AND client_id=p_client_id AND subject=p_subject FOR UPDATE;
 IF account_status IS DISTINCT FROM 'ACTIVE' OR link_status IS DISTINCT FROM 'ACTIVE'
 OR rechecked_user IS DISTINCT FROM linked_user
 THEN RAISE EXCEPTION 'ACCOUNT_OR_LINK_DISABLED' USING ERRCODE='P0001'; END IF;
 INSERT INTO forma_saas.app_session(token_hash,user_id,created_at,expires_at)
 VALUES(p_token_hash,linked_user,p_created_at,p_expires_at);
 RETURN linked_user;
END;
$$;

-- For unlink, lock the account and only revoke a link still referencing it.
-- If a privileged reassignment/deletion occurs concurrently, abort transaction
-- rather than revoking the wrong account or returning false success.
CREATE OR REPLACE FUNCTION forma_saas.identity_unlink_provider(
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
 WHERE issuer=p_issuer AND client_id=p_client_id AND subject=p_subject
 AND user_id=linked_user;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed <> 1 THEN
  RAISE EXCEPTION 'PROVIDER_LINK_CHANGED' USING ERRCODE='P0001';
 END IF;
 -- Conservative policy: revoke every session belonging to the linked user.
 UPDATE forma_saas.app_session SET revoked_at=statement_timestamp()
 WHERE user_id=linked_user AND revoked_at IS NULL;
 RETURN changed;
END;
$$;

-- CREATE OR REPLACE preserves existing EXECUTE grants; no new grants added.
-- Tenant runtime and PUBLIC retain no access to the identity functions.
