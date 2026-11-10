CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION benpal_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO benpal_app;

SET ROLE benpal_owner;

DO $$
BEGIN
  CREATE TYPE app.staff_role AS ENUM ('school_admin', 'admissions_officer', 'finance_officer', 'teacher');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS app.staff_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash TEXT NOT NULL,
  role app.staff_role NOT NULL,
  full_name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.admissions_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_name TEXT NOT NULL,
  date_of_birth DATE NOT NULL,
  applying_for TEXT NOT NULL,
  guardian_name TEXT NOT NULL,
  guardian_phone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by UUID REFERENCES app.staff_users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.audit_log (
  id BIGSERIAL PRIMARY KEY,
  staff_user_id UUID REFERENCES app.staff_users(id),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  ip_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.user_session (
  sid varchar PRIMARY KEY,
  sess json NOT NULL,
  expire timestamp(6) NOT NULL
);

CREATE INDEX IF NOT EXISTS admissions_status_created_idx ON app.admissions_applications(status, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_created_idx ON app.audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS user_session_expire_idx ON app.user_session(expire);

RESET ROLE;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO benpal_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app TO benpal_app;
ALTER DEFAULT PRIVILEGES FOR ROLE benpal_owner IN SCHEMA app
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO benpal_app;
ALTER DEFAULT PRIVILEGES FOR ROLE benpal_owner IN SCHEMA app
  GRANT USAGE, SELECT ON SEQUENCES TO benpal_app;
ALTER ROLE benpal_app IN DATABASE benpal_school SET search_path TO app, public;