-- Align existing fee-payment verification with the M-Pesa callback.
-- Apply as the owner of app.fee_payments. No payment rows are changed.
BEGIN;
ALTER TABLE app.fee_payments DROP CONSTRAINT IF EXISTS fee_payments_check;
ALTER TABLE app.fee_payments ADD CONSTRAINT fee_payments_check CHECK (
  (is_verified = FALSE AND verified_by IS NULL AND verified_at IS NULL)
  OR (is_verified = TRUE AND verified_at IS NOT NULL
      AND (verified_by IS NOT NULL OR payment_method = 'mpesa'))
);
COMMIT;
