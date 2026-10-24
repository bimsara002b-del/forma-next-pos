-- M30-03: opt-in functions for a SEPARATE identity database role.
-- No roles/grants or merchant-data operations; nothing enabled on live routes.
-- SECURITY DEFINER: controlled migration owner; fixed search_path, no dynamic SQL.
CREATE FUNCTION forma_saas.identity_issue_session(p_user_id uuid, p_token_hash text,
 p_created_at timestamptz, p_expires_at timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE current_status text;
BEGIN
 IF p_user_id IS NULL OR p_token_hash IS NULL
 OR p_token_hash !~ '^[0-9a-f]{64}$' OR p_created_at IS NULL OR p_expires_at IS NULL
 OR p_created_at < statement_timestamp() - interval '5 minutes'
 OR p_created_at > statement_timestamp() + interval '30 seconds'
 OR p_expires_at <= p_created_at OR p_expires_at > p_created_at + interval '8 hours' THEN
   RAISE EXCEPTION 'INVALID_SESSION_INPUT' USING ERRCODE='22023';
 END IF;
 -- Lock identity row, serializing with disable and revoke-all.
 SELECT status INTO current_status FROM forma_saas.app_user WHERE id=p_user_id FOR UPDATE;
 IF current_status IS DISTINCT FROM 'ACTIVE' THEN
   RAISE EXCEPTION 'ACCOUNT_UNAVAILABLE' USING ERRCODE='P0001';
 END IF;
 INSERT INTO forma_saas.app_session(token_hash,user_id,created_at,expires_at)
 VALUES (p_token_hash,p_user_id,p_created_at,p_expires_at);
END;
$$;
REVOKE ALL ON FUNCTION forma_saas.identity_issue_session(uuid,text,timestamptz,timestamptz) FROM PUBLIC;

CREATE FUNCTION forma_saas.identity_revoke_hash(p_token_hash text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE affected integer;
BEGIN
 IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
   RAISE EXCEPTION 'INVALID_SESSION_HASH' USING ERRCODE='22023';
 END IF;
 UPDATE forma_saas.app_session SET revoked_at=statement_timestamp()
 WHERE token_hash=p_token_hash AND revoked_at IS NULL;
 GET DIAGNOSTICS affected=ROW_COUNT;
 RETURN affected;
END;
$$;
REVOKE ALL ON FUNCTION forma_saas.identity_revoke_hash(text) FROM PUBLIC;

CREATE FUNCTION forma_saas.identity_revoke_user(p_user_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE current_status text;
DECLARE affected integer;
BEGIN
 IF p_user_id IS NULL THEN RAISE EXCEPTION 'INVALID_IDENTITY' USING ERRCODE='22023'; END IF;
 SELECT status INTO current_status FROM forma_saas.app_user WHERE id=p_user_id FOR UPDATE;
 IF NOT FOUND THEN RETURN 0; END IF;
 UPDATE forma_saas.app_session SET revoked_at=statement_timestamp()
 WHERE user_id=p_user_id AND revoked_at IS NULL;
 GET DIAGNOSTICS affected=ROW_COUNT;
 RETURN affected;
END;
$$;
REVOKE ALL ON FUNCTION forma_saas.identity_revoke_user(uuid) FROM PUBLIC;

CREATE FUNCTION forma_saas.identity_disable_user(p_user_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE affected integer;
BEGIN
 IF p_user_id IS NULL THEN RAISE EXCEPTION 'INVALID_IDENTITY' USING ERRCODE='22023'; END IF;
 -- UPDATE acquires a row lock; concurrent issuance must wait and recheck status.
 UPDATE forma_saas.app_user SET status='DISABLED' WHERE id=p_user_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_UNAVAILABLE' USING ERRCODE='P0001'; END IF;
 UPDATE forma_saas.app_session SET revoked_at=statement_timestamp()
 WHERE user_id=p_user_id AND revoked_at IS NULL;
 GET DIAGNOSTICS affected=ROW_COUNT;
 RETURN affected;
END;
$$;
REVOKE ALL ON FUNCTION forma_saas.identity_disable_user(uuid) FROM PUBLIC;
-- Important: no EXECUTE grants. Provision narrowly to identity service later.
