import pg from 'pg';
const pool = new pg.Pool({
    connectionString: 'postgresql://postgres.iqpksggpapxwbqlzdovh:Hardik1902020202@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres',
    ssl: { rejectUnauthorized: false }
});
pool.query("SELECT email, password_hash, is_verified FROM accounts WHERE email = 'hardikverma1902@gmail.com'").then(res => console.log(res.rows)).catch(console.error).finally(() => pool.end());
