import pg from 'pg';
import bcrypt from 'bcryptjs';

const pool = new pg.Pool({
    connectionString: 'postgresql://postgres.iqpksggpapxwbqlzdovh:Hardik1902020202@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres',
    ssl: { rejectUnauthorized: false }
});

async function run() {
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash('admin123', salt);
    await pool.query("UPDATE accounts SET password_hash = $1 WHERE email = 'hardikverma1902@gmail.com'", [hash]);
    console.log("Password updated successfully!");
    pool.end();
}
run();
