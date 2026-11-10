import 'dotenv/config';
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import argon2 from 'argon2';
import { Pool } from 'pg';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required in .env');
const prompt = readline.createInterface({ input, output });
try {
  const fullName = (await prompt.question('Staff full name: ')).trim();
  const email = (await prompt.question('Staff email: ')).trim().toLowerCase();
  const password = await prompt.question('New password (12+ characters): ');
  if (fullName.length < 2 || !/^\S+@\S+\.\S+$/.test(email) || password.length < 12) throw new Error('Use a valid name, email and a password of at least 12 characters.');
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query("INSERT INTO staff_users (full_name, email, password_hash, role) VALUES ($1,$2,$3,'school_admin')", [fullName, email, passwordHash]);
    console.log('School admin account created.');
  } finally { await pool.end(); }
} finally { prompt.close(); }