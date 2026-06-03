import { pool } from '../database/index.js';

export class UsageService {
  async ensureClient(clientId) {
    const now = Date.now();
    await pool.query(
      `INSERT INTO users(uuid, "freeUses", "createdAt") VALUES ($1, 0, $2) ON CONFLICT(uuid) DO NOTHING`,
      [clientId, now]
    );
    const result = await pool.query(`SELECT uuid, "freeUses", "createdAt" FROM users WHERE uuid = $1`, [clientId]);
    return result.rows[0];
  }

  async consumeIfAvailable(clientId, limit = 3) {
    await this.ensureClient(clientId);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const usageResult = await client.query(`SELECT "freeUses" FROM users WHERE uuid = $1 FOR UPDATE`, [clientId]);
      const usage = usageResult.rows[0];
      if (!usage || usage.freeUses >= limit) {
        await client.query('ROLLBACK');
        return { allowed: false, remaining: 0, used: usage?.freeUses || 0 };
      }
      const next = usage.freeUses + 1;
      await client.query(`UPDATE users SET "freeUses" = $1 WHERE uuid = $2`, [next, clientId]);
      await client.query('COMMIT');
      return { allowed: true, remaining: Math.max(0, limit - next), used: next };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
}
