
-- Benpal direct student enrolment update.
-- Run this once in pgAdmin Query Tool while connected to benpal_school.
-- It adds only missing columns and permissions. It does not create student, payment, or demo data.

SET ROLE benpal_owner;

ALTER TABLE app.students
  ADD COLUMN IF NOT EXISTS class_name TEXT,
  ADD COLUMN IF NOT EXISTS guardian_email TEXT,
  ADD COLUMN IF NOT EXISTS opening_fee_paid_kes INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opening_fee_balance_kes INTEGER NOT NULL DEFAULT 0;

ALTER TABLE app.students
  ALTER COLUMN guardian_phone DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'students_class_name_check'
      AND conrelid = 'app.students'::regclass
  ) THEN
    ALTER TABLE app.students ADD CONSTRAINT students_class_name_check
      CHECK (class_name IS NULL OR char_length(btrim(class_name)) BETWEEN 1 AND 60);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'students_guardian_email_check'
      AND conrelid = 'app.students'::regclass
  ) THEN
    ALTER TABLE app.students ADD CONSTRAINT students_guardian_email_check
      CHECK (guardian_email IS NULL OR guardian_email = lower(guardian_email));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'students_opening_fee_paid_check'
      AND conrelid = 'app.students'::regclass
  ) THEN
    ALTER TABLE app.students ADD CONSTRAINT students_opening_fee_paid_check
      CHECK (opening_fee_paid_kes >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'students_opening_fee_balance_check'
      AND conrelid = 'app.students'::regclass
  ) THEN
    ALTER TABLE app.students ADD CONSTRAINT students_opening_fee_balance_check
      CHECK (opening_fee_balance_kes >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS students_class_name_idx ON app.students(class_name);

RESET ROLE;

GRANT SELECT, INSERT, UPDATE, DELETE ON app.students TO benpal_app;
