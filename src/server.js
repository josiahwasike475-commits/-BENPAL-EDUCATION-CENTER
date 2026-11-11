$(cat /home/daytona/workspace/benpal-server-repair.js)

import 'dotenv/config';
//  import path from 'path';
// import { fileURLToPath } from 'url';
import crypto from 'crypto';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import cors from 'cors';
import { csrfSync } from 'csrf-sync';
import { Pool } from 'pg';
import { z } from 'zod'; import path from 'path';
import { fileURLToPath } from 'url';


const databaseUrl = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;
const required = ['SESSION_SECRET', 'APP_ORIGIN'];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing ${name} in .env`);
}
if (!databaseUrl) throw new Error('Missing NEON_DATABASE_URL or DATABASE_URL in .env');
const mpesaConfigured = ['MPESA_CONSUMER_KEY', 'MPESA_CONSUMER_SECRET', 'MPESA_SHORTCODE', 'MPESA_PASSKEY', 'MPESA_CALLBACK_URL', 'MPESA_CALLBACK_TOKEN']
  .every((name) => Boolean(process.env[name]));
const mpesaBaseUrl = process.env.MPESA_ENVIRONMENT === 'production'
  ? 'https://api.safaricom.co.ke'
  : 'https://sandbox.safaricom.co.ke';


const production = process.env.NODE_ENV === 'production';
const app = express();
const pool = new Pool({ connectionString: databaseUrl, ssl: production ? { rejectUnauthorized: true } : false });
const PgStore = connectPgSimple(session);


app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: production ? undefined : false }));
app.use(cors({ origin: process.env.APP_ORIGIN, credentials: true, methods: ['GET', 'POST'] }));
app.use(express.json({ limit: '10kb' }));
// app.use(express.static('public'));
 const __dirname = path.dirname(fileURLToPath(import.meta.url));
 app.use(express.static(path.join(__dirname, '../public')));
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
