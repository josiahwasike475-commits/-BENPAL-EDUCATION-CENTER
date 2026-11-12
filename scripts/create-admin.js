import 'dotenv/config';
import readline from 'node:readline/promises';
import { stdin as defaultInput, stdout as defaultOutput } from 'node:process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import argon2 from 'argon2';
import { Pool } from 'pg';

const SCHOOL_ADMIN_ROLE = 'school_admin';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function getDatabaseUrl(env = process.env) {
  return env.NEON_DATABASE_URL || env.NEON_POSTGRES_URL || env.DATABASE_URL || '';
}

export function validateAdminInput(fullName, email, password) {
  if (fullName.length < 2 || fullName.length > 120 || /[\u0000-\u001F\u007F]/.test(fullName)) {
    throw new Error('Staff full name must be 2–120 printable characters.');
  }
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw new Error('Enter a valid staff email address.');
  }
  if (password.length < 12 || password.length > 128) {
    throw new Error('Password must be between 12 and 128 characters.');
  }
}

export async function readHiddenPassword({ input = defaultInput, output = defaultOutput } = {}) {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== 'function') {
    throw new Error('Password entry requires an interactive terminal; piped or redirected input is not allowed.');
  }

  output.write('New password (12+ characters): ');
  input.setRawMode(true);
  input.resume();

  try {
    return await new Promise((resolvePassword, rejectPassword) => {
      let password = '';
      const onData = (chunk) => {
        const keys = chunk.toString('utf8');
        for (const key of keys) {
          if (key === '\r' || key === '\n') {
            cleanup();
            output.write('\n');
            resolvePassword(password);
            return;
          }
          if (key === '\u0003') {
            cleanup();
            output.write('\n');
            rejectPassword(new Error('Password entry cancelled.'));
            return;
          }
          if (key === '\u007F' || key === '\b') {
            password = password.slice(0, -1);
          } else if (key >= ' ') {
            password += key;
          }
        }
      };
      const cleanup = () => {
        input.off('data', onData);
        input.setRawMode(false);
        input.pause();
      };
      input.on('data', onData);
    });
  } catch (error) {
    if (input.isRaw) input.setRawMode(false);
    throw error;
  }
}

export async function createSchoolAdmin({ fullName, email, password, connectionString, PoolClass = Pool, hashPassword = argon2.hash }) {
  validateAdminInput(fullName, email, password);
  const passwordHash = await hashPassword(password, { type: argon2.argon2id });
  const pool = new PoolClass({ connectionString });

  try {
    await pool.query(
      'INSERT INTO app.staff_users (full_name, email, password_hash, role) VALUES ($1, $2, $3, $4::app.staff_role)',
      [fullName, email, passwordHash, SCHOOL_ADMIN_ROLE],
    );
  } catch (error) {
    if (error?.code === '23505') {
      throw new Error('A staff account with that email already exists.');
    }
    throw new Error('Could not create the school admin account. Check the database connection and schema, then try again.');
  } finally {
    await pool.end();
  }
}

export async function run({ input = defaultInput, output = defaultOutput, env = process.env, PoolClass = Pool, hashPassword = argon2.hash } = {}) {
  const connectionString = getDatabaseUrl(env);
  if (!connectionString) {
    throw new Error('Missing database connection string. Set NEON_DATABASE_URL, NEON_POSTGRES_URL, or DATABASE_URL.');
  }
  if (!input.isTTY || !output.isTTY) {
    throw new Error('This script requires an interactive terminal; piped or redirected input is not allowed.');
  }

  const prompt = readline.createInterface({ input, output });
  let fullName;
  let email;
  try {
    fullName = (await prompt.question('Staff full name: ')).trim();
    email = (await prompt.question('Staff email: ')).trim().toLowerCase();
  } finally {
    prompt.close();
  }
  const password = await readHiddenPassword({ input, output });
  await createSchoolAdmin({ fullName, email, password, connectionString, PoolClass, hashPassword });
  output.write('School admin account created.\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error(`Admin provisioning failed: ${error.message}`);
    process.exitCode = 1;
  });
}
