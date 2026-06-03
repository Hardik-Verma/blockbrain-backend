import 'dotenv/config';
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function fix() {
  await pool.query('ALTER TABLE provider_secrets ALTER COLUMN updated_at TYPE BIGINT');
  await pool.query('ALTER TABLE users ALTER COLUMN "createdAt" TYPE BIGINT');
  console.log('Fixed');
  process.exit(0);
}

fix();
