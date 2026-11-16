-- Quorum (D-61, owner decision 2026-11-09): foundation v1.6.x enables FORCE ROW LEVEL SECURITY, and asApp runs as quorum_app
-- (D-42) without setting app.org_id, so every policy-covered table read as empty. BYPASSRLS keeps the 1.5.0 behaviour
-- while RLS stays off. D-42's grants are untouched. Adopting real RLS later: drop this attribute and have asApp set the org.
-- Roles are cluster-wide, so guard on existence (the role is created by 20261026000000_quorum_init).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'quorum_app') THEN
    ALTER ROLE quorum_app BYPASSRLS;
  END IF;
END;
$$;
