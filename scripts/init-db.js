import 'dotenv/config';
import fs from 'fs/promises';
import { Pool } from 'pg';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required in .env');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const schema = await fs.readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
  await pool.query(schema);
  console.log('Database schema created.');
} finally {
  await pool.end();
}