import pg from 'pg';
const { Pool } = pg;

export let pool;

export async function initDatabase(databaseUrl) {
  pool = new Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    ssl: databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false },
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS accounts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      minecraft_uuid VARCHAR(36) UNIQUE,
      display_name VARCHAR(64),
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255),
      otp_code VARCHAR(6),
      otp_expires_at TIMESTAMPTZ,
      role VARCHAR(16) NOT NULL DEFAULT 'player',
      avatar_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`ALTER TABLE accounts ALTER COLUMN display_name DROP NOT NULL`).catch(()=>{});
  await pool.query(`ALTER TABLE accounts ALTER COLUMN password_hash DROP NOT NULL`).catch(()=>{});
  await pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS otp_code VARCHAR(6)`).catch(()=>{});
  await pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS otp_expires_at TIMESTAMPTZ`).catch(()=>{});
  await pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS avatar_url TEXT`).catch(()=>{});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ended_at TIMESTAMPTZ,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      total_requests INTEGER NOT NULL DEFAULT 0,
      client_version VARCHAR(16)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS request_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id UUID REFERENCES sessions(id),
      account_id UUID REFERENCES accounts(id),
      client_id VARCHAR(64),
      prompt_preview VARCHAR(200),
      tokens_used INTEGER NOT NULL DEFAULT 0,
      latency_ms INTEGER NOT NULL DEFAULT 0,
      status VARCHAR(16) NOT NULL DEFAULT 'success',
      error_message TEXT,
      context_snapshot JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS account_settings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE UNIQUE,
      settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      version INTEGER NOT NULL DEFAULT 1,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      uuid TEXT PRIMARY KEY,
      "freeUses" INTEGER NOT NULL DEFAULT 0,
      "createdAt" BIGINT NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS provider_secrets (
      provider TEXT PRIMARY KEY,
      encrypted_api_key TEXT NOT NULL,
      base_url TEXT NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_request_logs_account_created ON request_logs(account_id, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_id)`);

  return pool;
}
