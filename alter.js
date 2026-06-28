import pg from 'pg';

const pool = new pg.Pool({
    connectionString: 'postgresql://postgres.iqpksggpapxwbqlzdovh:Hardik1902020202@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres',
    ssl: { rejectUnauthorized: false }
});

async function run() {
    try {
        const res = await pool.query("SELECT email FROM accounts");
        console.log("Registered Emails:");
        console.log(res.rows.map(r => r.email));
    } catch (e) {
        console.error(e);
    } finally {
        pool.end();
    }
}
run();
