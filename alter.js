import pg from 'pg';

const pool = new pg.Pool({
    connectionString: 'postgresql://postgres.iqpksggpapxwbqlzdovh:Hardik1902020202@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres',
    ssl: { rejectUnauthorized: false }
});

async function run() {
    try {
        await pool.query("ALTER TABLE accounts ALTER COLUMN otp_code TYPE VARCHAR(255);");
        console.log("Database schema updated successfully! otp_code is now VARCHAR(255)");
    } catch (e) {
        console.error(e);
    } finally {
        pool.end();
    }
}
run();
