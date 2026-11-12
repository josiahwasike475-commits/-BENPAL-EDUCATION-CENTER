--Benpal student and fee tracking migration.
-- Run once in pgAdmin Query Tool while connected to benpal_school as postgres.
-- It creates empty tables only. It does NOT add sample learners, payments, or balances.

SET ROLE benpal_owner;

CREATE TABLE IF NOT EXISTS app.students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admission_application_id UUID UNIQUE REFERENCES app.admissions_applications(id),
  student_number TEXT NOT NULL UNIQUE DEFAULT ('BEN-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  full_name TEXT NOT NULL,
  guardian_name TEXT NOT NULL,
  guardian_phone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'graduated')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.fee_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES app.students(id),
  description TEXT NOT NULL,
  academic_term TEXT NOT NULL,
  amount_kes INTEGER NOT NULL CHECK (amount_kes > 0),
  due_date DATE,
  created_by UUID REFERENCES app.staff_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.fee_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES app.students(id),
  amount_kes INTEGER NOT NULL CHECK (amount_kes > 0),
  paid_at TIMESTAMPTZ NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('mpesa', 'bank', 'cash', 'other')),
  payment_reference TEXT NOT NULL UNIQUE,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  verified_by UUID REFERENCES app.staff_users(id),
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (is_verified = FALSE AND verified_by IS NULL AND verified_at IS NULL)
    OR (
      is_verified = TRUE
      AND verified_at IS NOT NULL
      AND (payment_method = 'mpesa' OR verified_by IS NOT NULL)
    )
  )
);

CREATE INDEX IF NOT EXISTS students_status_idx ON app.students(status);
CREATE INDEX IF NOT EXISTS fee_charges_student_idx ON app.fee_charges(student_id);
CREATE INDEX IF NOT EXISTS fee_payments_student_verified_idx ON app.fee_payments(student_id, is_verified);

-- Register students for admissions already approved in this development database.
-- No student is made for pending or rejected applications.
INSERT INTO app.students (admission_application_id, full_name, guardian_name, guardian_phone)
SELECT id, child_name, guardian_name, guardian_phone
FROM app.admissions_applications
WHERE status = 'approved'
ON CONFLICT (admission_application_id) DO NOTHING;

RESET ROLE;

GRANT SELECT, INSERT, UPDATE, DELETE ON app.students, app.fee_charges, app.fee_payments TO benpal_app;