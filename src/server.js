
import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import cors from 'cors';
import { csrfSync } from 'csrf-sync';
import { Pool } from 'pg';
import { z } from 'zod';

const required = ['DATABASE_URL', 'SESSION_SECRET', 'APP_ORIGIN'];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing ${name} in .env`);
}
const mpesaConfigured = ['MPESA_CONSUMER_KEY', 'MPESA_CONSUMER_SECRET', 'MPESA_SHORTCODE', 'MPESA_PASSKEY', 'MPESA_CALLBACK_URL', 'MPESA_CALLBACK_TOKEN']
  .every((name) => Boolean(process.env[name]));
const mpesaBaseUrl = process.env.MPESA_ENVIRONMENT === 'production'
  ? 'https://api.safaricom.co.ke'
  : 'https://sandbox.safaricom.co.ke';

const production = process.env.NODE_ENV === 'production';
const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: production ? { rejectUnauthorized: true } : false });
const PgStore = connectPgSimple(session);

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: production ? undefined : false }));
app.use(cors({ origin: process.env.APP_ORIGIN, credentials: true, methods: ['GET', 'POST'] }));
app.use(express.json({ limit: '10kb' }));
app.use(express.static('public'));
app.use(rateLimit({ windowMs: 60_000, limit: 100, standardHeaders: 'draft-7', legacyHeaders: false }));
app.use(session({
  store: new PgStore({ pool, tableName: 'user_session', createTableIfMissing: true }),
  name: 'benpal.sid',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, secure: process.env.COOKIE_SECURE === 'true', sameSite: 'lax', maxAge: 8 * 60 * 60 * 1000 }
}));

const { generateToken, csrfSynchronisedProtection } = csrfSync();
const csrfProtection = csrfSynchronisedProtection;
const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 5, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many sign-in attempts. Try again later.' } });
const loginInput = z.object({ email: z.string().email().max(254), password: z.string().min(12).max(128) });
const admissionInput = z.object({ childName: z.string().trim().min(2).max(60), dateOfBirth: z.string().date(), applyingFor: z.string().trim().min(2).max(30), guardianName: z.string().trim().min(2).max(60), guardianPhone: z.string().regex(/^(07|01)\d{8}$/) });
const attendanceInput = z.object({
  studentId: z.string().uuid(),
  attendanceDate: z.string().date(),
  status: z.enum(['present', 'absent', 'late', 'excused'])
});
const staffCreateInput = z.object({
  fullName: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(128),
  role: z.enum(['school_admin', 'admissions_officer', 'finance_officer', 'teacher'])
});
const studentCreateInput = z.object({
  className: z.string().trim().min(1).max(60),
  fullName: z.string().trim().min(2).max(120),
  guardianName: z.string().trim().min(2).max(120),
  guardianEmail: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  feePaidKes: z.coerce.number().int().min(0).max(10_000_000),
  feeBalanceKes: z.coerce.number().int().min(0).max(10_000_000)
});
const parentReportInput = z.object({
  studentId: z.string().uuid(),
  academicTerm: z.string().trim().min(2).max(60),
  reportDate: z.string().date(),
  teacherComment: z.string().trim().min(10).max(2000),
  strengths: z.string().trim().max(1000).optional().default(''),
  supportNeeded: z.string().trim().max(1000).optional().default('')
});
const feePaymentInput = z.object({
  studentId: z.string().uuid(),
  amountKes: z.coerce.number().int().positive().max(10_000_000),
  paidAt: z.string().datetime({ offset: true }),
  paymentMethod: z.enum(['mpesa', 'bank', 'cash', 'other']),
  paymentReference: z.string().trim().min(3).max(100)
});
const mpesaStkInput = z.object({
  studentNumber: z.string().trim().regex(/^BEC-[A-Z0-9]{10}$/),
  phoneNumber: z.string().trim().regex(/^(?:254|0)(?:7|1)\d{8}$/),
  amountKes: z.coerce.number().int().positive().max(150_000)
});

const roles = (...allowed) => (req, res, next) => {
  if (!req.session.user) return res.status(401).json({ error: 'Sign in required.' });
  if (!allowed.includes(req.session.user.role)) return res.status(403).json({ error: 'You are not allowed to do that.' });
  next();
};
const hashIp = (req) => crypto.createHash('sha256').update(`${req.ip}|${process.env.SESSION_SECRET}`).digest('hex');
const audit = async (req, action, targetType, targetId = null) => {
  const staffId = req.session.user?.id || null;
  await pool.query('INSERT INTO audit_log (staff_user_id, action, target_type, target_id, ip_hash) VALUES ($1,$2,$3,$4,$5)', [staffId, action, targetType, targetId, hashIp(req)]);
};
const toMpesaPhone = (phone) => phone.startsWith('0') ? `254${phone.slice(1)}` : phone;
const timestampNairobi = () => {
  const pieces = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const part = (type) => pieces.find((item) => item.type === type)?.value;
  return `${part('year')}${part('month')}${part('day')}${part('hour')}${part('minute')}${part('second')}`;
};
const getMpesaToken = async () => {
  const basic = Buffer.from(`${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`).toString('base64');
  const response = await fetch(`${mpesaBaseUrl}/oauth/v1/generate?grant_type=client_credentials`, { headers: { Authorization: `Basic ${basic}` } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error('M-Pesa authorisation failed. Check the Daraja setup.');
  return data.access_token;
};
const sendStkPush = async ({ phoneNumber, amountKes, studentNumber }) => {
  const token = await getMpesaToken();
  const timestamp = timestampNairobi();
  const shortcode = process.env.MPESA_SHORTCODE;
  const password = Buffer.from(`${shortcode}${process.env.MPESA_PASSKEY}${timestamp}`).toString('base64');
  const response = await fetch(`${mpesaBaseUrl}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: amountKes,
      PartyA: phoneNumber,
      PartyB: shortcode,
      PhoneNumber: phoneNumber,
      CallBackURL: mpesaCallbackUrl(),
      AccountReference: studentNumber,
      TransactionDesc: `School fees ${studentNumber}`
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ResponseCode !== '0' || !data.CheckoutRequestID) {
    throw new Error(data.errorMessage || data.ResponseDescription || 'M-Pesa could not send the phone prompt.');
  }
  return data;
};
const callbackValue = (items, name) => items.find((item) => item.Name === name)?.Value;
const mpesaCallbackUrl = () => {
  const url = new URL(process.env.MPESA_CALLBACK_URL);
  url.searchParams.set('token', process.env.MPESA_CALLBACK_TOKEN);
  return url.toString();
};
const mpesaStkLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 3, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many payment prompts. Try again later.' } });
const mpesaStatusLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 36, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many status checks. Try again shortly.' } });

app.get('/api/csrf', (req, res) => res.json({ csrfToken: generateToken(req) }));
app.get('/api/auth/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Sign in required.' });
  res.json({ user: req.session.user });
});
app.get('/api/health', async (req, res) => { await pool.query('SELECT 1'); res.json({ ok: true }); });

app.post('/api/admissions', csrfProtection, async (req, res, next) => {
  try {
    const input = admissionInput.parse(req.body);
    const result = await pool.query('INSERT INTO admissions_applications (child_name, date_of_birth, applying_for, guardian_name, guardian_phone) VALUES ($1,$2,$3,$4,$5) RETURNING id', [input.childName, input.dateOfBirth, input.applyingFor, input.guardianName, input.guardianPhone]);
    res.status(201).json({ reference: result.rows[0].id });
  } catch (error) { next(error); }
});

app.post('/api/public/mpesa/stk-push', mpesaStkLimiter, csrfProtection, async (req, res, next) => {
  if (!mpesaConfigured) return res.status(503).json({ error: 'M-Pesa payments are not configured yet. Please contact the school office.' });
  try {
    const input = mpesaStkInput.parse(req.body);
    const phoneNumber = toMpesaPhone(input.phoneNumber);
    const student = await pool.query(`SELECT id FROM students
      WHERE student_number = $1 AND guardian_phone IN ($2, $3) AND status = 'active'`,
      [input.studentNumber.toUpperCase(), input.phoneNumber, `0${phoneNumber.slice(3)}`]);
    if (!student.rowCount) return res.status(404).json({ error: 'We could not match that learner number and guardian phone.' });
    const created = await pool.query(`INSERT INTO mpesa_checkout_requests
      (student_id, phone_number, amount_kes, status) VALUES ($1, $2, $3, 'initiated') RETURNING id`,
      [student.rows[0].id, phoneNumber, input.amountKes]);
    try {
      const response = await sendStkPush({ phoneNumber, amountKes: input.amountKes, studentNumber: input.studentNumber.toUpperCase() });
      await pool.query(`UPDATE mpesa_checkout_requests SET status = 'pending', merchant_request_id = $1,
        checkout_request_id = $2, response_code = $3, response_description = $4, updated_at = now() WHERE id = $5`,
        [response.MerchantRequestID, response.CheckoutRequestID, response.ResponseCode, response.ResponseDescription || null, created.rows[0].id]);
      await audit(req, 'mpesa_stk_push_requested', 'mpesa_checkout_request', created.rows[0].id);
      res.status(202).json({ message: 'Check the phone for the M-Pesa prompt. Enter the PIN only on the phone.', requestId: created.rows[0].id });
    } catch (error) {
      await pool.query("UPDATE mpesa_checkout_requests SET status = 'failed', response_description = $1, updated_at = now() WHERE id = $2", [error.message.slice(0, 500), created.rows[0].id]);
      throw error;
    }
  } catch (error) { next(error); }
});

app.get('/api/public/mpesa/status/:id', mpesaStatusLimiter, async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const result = await pool.query(`SELECT status, result_description, created_at
      FROM mpesa_checkout_requests WHERE id = $1`, [id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Payment request not found.' });
    res.json({ payment: result.rows[0] });
  } catch (error) { next(error); }
});

app.post('/api/public/mpesa/callback', async (req, res, next) => {
  const suppliedToken = String(req.query.token || '');
  const expectedToken = process.env.MPESA_CALLBACK_TOKEN || '';
  if (!expectedToken || suppliedToken.length !== expectedToken.length || !crypto.timingSafeEqual(Buffer.from(suppliedToken), Buffer.from(expectedToken))) return res.sendStatus(401);
  let client;
  try {
    const callback = req.body?.Body?.stkCallback;
    if (!callback?.CheckoutRequestID || !Number.isInteger(Number(callback.ResultCode))) return res.status(400).json({ ResultCode: 1, ResultDesc: 'Invalid callback.' });
    client = await pool.connect();
    await client.query('BEGIN');
    const request = await client.query('SELECT * FROM mpesa_checkout_requests WHERE checkout_request_id = $1 FOR UPDATE', [callback.CheckoutRequestID]);
    if (!request.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ ResultCode: 1, ResultDesc: 'Checkout request not found.' }); }
    const checkout = request.rows[0];
    if (checkout.status === 'succeeded') { await client.query('ROLLBACK'); return res.json({ ResultCode: 0, ResultDesc: 'Accepted' }); }
    const metadata = Array.isArray(callback.CallbackMetadata?.Item) ? callback.CallbackMetadata.Item : [];
    const amount = Number(callbackValue(metadata, 'Amount'));
    const receipt = callbackValue(metadata, 'MpesaReceiptNumber');
    const phone = String(callbackValue(metadata, 'PhoneNumber') || '');
    const resultCode = Number(callback.ResultCode);
    let status = resultCode === 0 ? 'review' : 'failed';
    if (resultCode === 0 && receipt && Number.isInteger(amount) && amount === checkout.amount_kes && phone === checkout.phone_number) {
      const payment = await client.query(`INSERT INTO fee_payments
        (student_id, amount_kes, paid_at, payment_method, payment_reference, is_verified, verified_at)
        VALUES ($1, $2, now(), 'mpesa', $3, true, now()) ON CONFLICT (payment_reference) DO NOTHING RETURNING id`,
        [checkout.student_id, amount, receipt]);
      status = payment.rowCount ? 'succeeded' : 'review';
    }
    await client.query(`UPDATE mpesa_checkout_requests SET status = $1, result_code = $2, result_description = $3,
      mpesa_receipt_number = $4, transaction_at = now(), callback_payload = $5, updated_at = now() WHERE id = $6`,
      [status, resultCode, callback.ResultDesc || null, receipt || null, JSON.stringify(req.body), checkout.id]);
    await client.query('INSERT INTO audit_log (action, target_type, target_id, ip_hash) VALUES ($1,$2,$3,$4)',
      [status === 'succeeded' ? 'mpesa_payment_verified' : 'mpesa_callback_needs_review', 'mpesa_checkout_request', checkout.id, hashIp(req)]);
    await client.query('COMMIT');
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally { client?.release(); }
});

app.post('/api/auth/login', loginLimiter, csrfProtection, async (req, res, next) => {
  try {
    const { email, password } = loginInput.parse(req.body);
    const row = await pool.query('SELECT id, email, password_hash, role, full_name FROM staff_users WHERE email=$1 AND is_active=true', [email.toLowerCase()]);
    const user = row.rows[0];
    const argon2 = await import('argon2');
    if (!user || !(await argon2.verify(user.password_hash, password))) return res.status(401).json({ error: 'Email or password is not correct.' });
    req.session.regenerate(async (sessionError) => {
      if (sessionError) return next(sessionError);
      req.session.user = { id: user.id, role: user.role, name: user.full_name };
      await audit(req, 'staff_login', 'staff_user', user.id);
      res.json({ user: { name: user.full_name, role: user.role } });
    });
  } catch (error) { next(error); }
});

app.post('/api/auth/logout', csrfProtection, async (req, res, next) => {
  try {
    await audit(req, 'staff_logout', 'staff_user', req.session.user?.id);
    req.session.destroy((error) => error ? next(error) : res.sendStatus(204));
  } catch (error) { next(error); }
});

app.get('/api/admin/applications', roles('school_admin', 'admissions_officer'), async (req, res, next) => {
  try {
    const result = await pool.query("SELECT id, child_name, date_of_birth, applying_for, guardian_name, guardian_phone, created_at FROM admissions_applications WHERE status='pending' ORDER BY created_at ASC");
    res.json({ applications: result.rows });
  } catch (error) { next(error); }
});

app.get('/api/admin/students', roles('school_admin', 'admissions_officer', 'finance_officer'), async (req, res, next) => {
  try {
    const result = await pool.query(`SELECT s.id, s.student_number, s.class_name, s.full_name, s.guardian_name,
      s.guardian_email, s.status, s.opening_fee_paid_kes, s.opening_fee_balance_kes,
      COALESCE((SELECT SUM(c.amount_kes) FROM app.fee_charges c WHERE c.student_id = s.id), 0)::int AS charged_kes,
      COALESCE((SELECT SUM(p.amount_kes) FROM app.fee_payments p WHERE p.student_id = s.id AND p.is_verified = true), 0)::int AS verified_paid_kes
      FROM app.students s ORDER BY s.full_name ASC`);
    res.json({ students: result.rows.map((student) => ({
      ...student,
      paid_kes: student.opening_fee_paid_kes + student.verified_paid_kes,
      balance_kes: student.opening_fee_balance_kes + student.charged_kes - student.verified_paid_kes
    })) });
  } catch (error) { next(error); }
});

app.post('/api/admin/students', csrfProtection, roles('school_admin', 'admissions_officer'), async (req, res, next) => {
  let client;
  try {
    const input = studentCreateInput.parse(req.body);
    client = await pool.connect();
    await client.query('BEGIN');
    const result = await client.query(`INSERT INTO app.students
      (class_name, full_name, guardian_name, guardian_email, opening_fee_paid_kes, opening_fee_balance_kes)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, student_number, class_name, full_name, guardian_name, guardian_email, status,
        opening_fee_paid_kes, opening_fee_balance_kes, created_at`,
      [input.className, input.fullName, input.guardianName, input.guardianEmail, input.feePaidKes, input.feeBalanceKes]);
    await client.query('INSERT INTO app.audit_log (staff_user_id, action, target_type, target_id, ip_hash) VALUES ($1,$2,$3,$4,$5)',
      [req.session.user.id, 'student_created', 'student', result.rows[0].id, hashIp(req)]);
    await client.query('COMMIT');
    res.status(201).json({ student: { ...result.rows[0], charged_kes: 0, paid_kes: input.feePaidKes, balance_kes: input.feeBalanceKes } });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally { client?.release(); }
});

app.get('/api/admin/report-students', roles('school_admin', 'teacher'), async (req, res, next) => {
  try {
    const result = await pool.query(`SELECT id, student_number, full_name
      FROM students WHERE status = 'active' ORDER BY full_name ASC`);
    res.json({ students: result.rows });
  } catch (error) { next(error); }
});

app.get('/api/admin/staff', roles('school_admin'), async (req, res, next) => {
  try {
    const result = await pool.query(`SELECT id, full_name, email, role, is_active, created_at
      FROM staff_users ORDER BY full_name ASC`);
    res.json({ staff: result.rows });
  } catch (error) { next(error); }
});

app.post('/api/admin/staff', csrfProtection, roles('school_admin'), async (req, res, next) => {
  try {
    const input = staffCreateInput.parse(req.body);
    const argon2 = await import('argon2');
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    const result = await pool.query(`INSERT INTO staff_users (full_name, email, password_hash, role)
      VALUES ($1,$2,$3,$4) RETURNING id, full_name, email, role, is_active, created_at`,
      [input.fullName, input.email, passwordHash, input.role]);
    await audit(req, 'staff_created', 'staff_user', result.rows[0].id);
    res.status(201).json({ staff: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'That staff email is already in use.' });
    next(error);
  }
});

app.post('/api/admin/fee-payments', csrfProtection, roles('school_admin', 'finance_officer'), async (req, res, next) => {
  try {
    const input = feePaymentInput.parse(req.body);
    const payment = await pool.query(`INSERT INTO fee_payments
      (student_id, amount_kes, paid_at, payment_method, payment_reference, is_verified, verified_by, verified_at)
      SELECT id, $2, $3, $4, $5, true, $6, now()
      FROM students WHERE id = $1 AND status = 'active'
      RETURNING id, student_id, amount_kes, paid_at, payment_method, payment_reference`,
      [input.studentId, input.amountKes, input.paidAt, input.paymentMethod, input.paymentReference, req.session.user.id]);
    if (!payment.rowCount) return res.status(404).json({ error: 'Active student not found.' });
    await audit(req, 'fee_payment_verified', 'fee_payment', payment.rows[0].id);
    res.status(201).json({ payment: payment.rows[0] });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'That payment reference already exists. Check before saving again.' });
    next(error);
  }
});

app.get('/api/admin/parent-reports', roles('school_admin', 'teacher'), async (req, res, next) => {
  try {
    const result = await pool.query(`SELECT r.id, r.academic_term, r.report_date, r.teacher_comment,
      r.strengths, r.support_needed, r.created_at, s.id AS student_id, s.student_number, s.full_name,
      u.full_name AS author_name
      FROM student_parent_reports r
      JOIN students s ON s.id = r.student_id
      JOIN staff_users u ON u.id = r.created_by
      ORDER BY r.report_date DESC, r.created_at DESC`);
    res.json({ reports: result.rows });
  } catch (error) { next(error); }
});

app.post('/api/admin/parent-reports', csrfProtection, roles('school_admin', 'teacher'), async (req, res, next) => {
  try {
    const input = parentReportInput.parse(req.body);
    const result = await pool.query(`INSERT INTO student_parent_reports
      (student_id, academic_term, report_date, teacher_comment, strengths, support_needed, created_by)
      SELECT id, $2, $3, $4, NULLIF($5, ''), NULLIF($6, ''), $7
      FROM students WHERE id = $1 AND status = 'active'
      ON CONFLICT (student_id, academic_term) DO UPDATE SET
        report_date = EXCLUDED.report_date,
        teacher_comment = EXCLUDED.teacher_comment,
        strengths = EXCLUDED.strengths,
        support_needed = EXCLUDED.support_needed,
        created_by = EXCLUDED.created_by,
        updated_at = now()
      RETURNING id`, [input.studentId, input.academicTerm, input.reportDate, input.teacherComment,
      input.strengths, input.supportNeeded, req.session.user.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Active student not found.' });
    await audit(req, 'parent_report_saved', 'student_parent_report', result.rows[0].id);
    res.status(201).json({ id: result.rows[0].id });
  } catch (error) { next(error); }
});

app.get('/api/admin/attendance', roles('school_admin', 'admissions_officer', 'teacher'), async (req, res, next) => {
  try {
    const attendanceDate = z.string().date().parse(req.query.date || new Date().toISOString().slice(0, 10));
    const result = await pool.query(`SELECT s.id AS student_id, s.student_number, s.full_name,
      a.status, a.recorded_at
      FROM students s
      LEFT JOIN student_attendance a ON a.student_id = s.id AND a.attendance_date = $1
      WHERE s.status = 'active'
      ORDER BY s.full_name ASC`, [attendanceDate]);
    res.json({ attendanceDate, attendance: result.rows });
  } catch (error) { next(error); }
});

app.post('/api/admin/attendance', csrfProtection, roles('school_admin', 'admissions_officer', 'teacher'), async (req, res, next) => {
  try {
    const input = attendanceInput.parse(req.body);
    const result = await pool.query(`INSERT INTO student_attendance (student_id, attendance_date, status, recorded_by)
      SELECT id, $2, $3, $4 FROM students WHERE id = $1 AND status = 'active'
      ON CONFLICT (student_id, attendance_date) DO UPDATE
      SET status = EXCLUDED.status, recorded_by = EXCLUDED.recorded_by, updated_at = now()
      RETURNING id`, [input.studentId, input.attendanceDate, input.status, req.session.user.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Active student not found.' });
    await audit(req, 'attendance_recorded', 'student_attendance', result.rows[0].id);
    res.sendStatus(204);
  } catch (error) { next(error); }
});

app.post('/api/admin/applications/:id/approve', csrfProtection, roles('school_admin', 'admissions_officer'), async (req, res, next) => {
  let client;
  try {
    const id = z.string().uuid().parse(req.params.id);
    client = await pool.connect();
    await client.query('BEGIN');
    const result = await client.query("UPDATE admissions_applications SET status='approved', reviewed_by=$1, reviewed_at=now() WHERE id=$2 AND status='pending' RETURNING id, child_name, guardian_name, guardian_phone", [req.session.user.id, id]);
    if (!result.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Pending application not found.' }); }
    const application = result.rows[0];
    await client.query('INSERT INTO students (admission_application_id, full_name, guardian_name, guardian_phone) VALUES ($1,$2,$3,$4) ON CONFLICT (admission_application_id) DO NOTHING', [application.id, application.child_name, application.guardian_name, application.guardian_phone]);
    await client.query('COMMIT');
    await audit(req, 'admission_approved', 'admissions_application', id);
    res.sendStatus(204);
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally { client?.release(); }
});

app.use((error, req, res, next) => {
  if (error.code === 'EBADCSRFTOKEN') return res.status(403).json({ error: 'Your form expired. Refresh and try again.' });
  if (error instanceof z.ZodError) return res.status(400).json({ error: 'Check the information you entered.' });
  console.error(error);
  res.status(500).json({ error: 'Server error.' });
});

 if (!process.env.VERCEL) {
   app.listen(Number(process.env.PORT || 3000), () => console.log('BENPAL EDUCATION CENTRE server started.'));
 }
 export default app;