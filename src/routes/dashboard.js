import { Router } from 'express';
import { pool } from '../database/index.js';

export function createDashboardRouter() {
  const router = Router();

  // GET /stats — Aggregated usage statistics
  router.get('/stats', async (req, res, next) => {
    try {
      const statsResult = await pool.query(
        `SELECT
           COUNT(*) as total_sessions,
           COALESCE(SUM(tokens_used), 0) as total_tokens,
           COALESCE(ROUND(AVG(latency_ms)), 0) as avg_latency,
           CASE WHEN COUNT(*) > 0
             THEN ROUND(COUNT(*) FILTER (WHERE status = 'error') * 100.0 / COUNT(*), 1)
             ELSE 0 END as error_rate
         FROM request_logs WHERE account_id = $1`,
        [req.user.accountId]
      );

      const dailyResult = await pool.query(
        `SELECT DATE(created_at) as date, COUNT(*) as count
         FROM request_logs
         WHERE account_id = $1 AND created_at > NOW() - INTERVAL '30 days'
         GROUP BY DATE(created_at)
         ORDER BY date`,
        [req.user.accountId]
      );

      const stats = statsResult.rows[0];
      return res.json({
        totalSessions: parseInt(stats.total_sessions, 10),
        totalTokens: parseInt(stats.total_tokens, 10),
        avgLatency: parseInt(stats.avg_latency, 10),
        errorRate: parseFloat(stats.error_rate),
        dailyVolume: dailyResult.rows.map((r) => ({
          date: r.date,
          count: parseInt(r.count, 10),
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /logs — Cursor-paginated request logs
  router.get('/logs', async (req, res, next) => {
    try {
      const cursor = req.query.cursor || null;
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);

      const result = await pool.query(
        `SELECT id, prompt_preview, tokens_used, latency_ms, status, error_message, context_snapshot, created_at
         FROM request_logs
         WHERE account_id = $1 AND ($2::timestamptz IS NULL OR created_at < $2)
         ORDER BY created_at DESC
         LIMIT $3`,
        [req.user.accountId, cursor, limit]
      );

      const logs = result.rows;
      const lastRow = logs[logs.length - 1];

      return res.json({
        logs,
        nextCursor: lastRow?.created_at || null,
      });
    } catch (err) {
      next(err);
    }
  });

  // POST /sync — Sync context snapshot without an AI generation request (for Custom API Keys)
  router.post('/sync', async (req, res, next) => {
    try {
      const { context_snapshot } = req.body;
      if (!context_snapshot) {
        return res.status(400).json({ error: 'context_snapshot is required' });
      }

      await pool.query(
        `INSERT INTO request_logs (account_id, prompt_preview, tokens_used, latency_ms, status, context_snapshot)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [req.user.accountId, 'Live Context Sync', 0, 0, 'sync', context_snapshot]
      );

      return res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
