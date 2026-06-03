import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../database/index.js';

const putSettingsSchema = z.object({
  settings: z.record(z.unknown()),
  expectedVersion: z.number().int().min(0),
});

export function createSettingsRouter() {
  const router = Router();

  // GET / — Retrieve settings
  router.get('/', async (req, res, next) => {
    try {
      const result = await pool.query(
        'SELECT settings_json, version, updated_at FROM account_settings WHERE account_id = $1',
        [req.user.accountId]
      );

      if (result.rows.length === 0) {
        return res.json({ settings: {}, version: 0, updatedAt: null });
      }

      const row = result.rows[0];
      return res.json({
        settings: row.settings_json,
        version: row.version,
        updatedAt: row.updated_at,
      });
    } catch (err) {
      next(err);
    }
  });

  // PUT / — Update settings with optimistic concurrency
  router.put('/', async (req, res, next) => {
    try {
      const body = putSettingsSchema.parse(req.body);

      if (body.expectedVersion === 0) {
        // First save — upsert
        const result = await pool.query(
          `INSERT INTO account_settings (account_id, settings_json, version)
           VALUES ($1, $2, 1)
           ON CONFLICT (account_id) DO UPDATE
             SET settings_json = $2,
                 version = account_settings.version + 1,
                 updated_at = NOW()
           RETURNING version, updated_at`,
          [req.user.accountId, JSON.stringify(body.settings)]
        );

        const row = result.rows[0];
        return res.json({
          settings: body.settings,
          version: row.version,
          updatedAt: row.updated_at,
        });
      }

      // Subsequent save — conditional update
      const result = await pool.query(
        `UPDATE account_settings
         SET settings_json = $1, version = version + 1, updated_at = NOW()
         WHERE account_id = $2 AND version = $3
         RETURNING version, updated_at`,
        [JSON.stringify(body.settings), req.user.accountId, body.expectedVersion]
      );

      if (result.rowCount === 0) {
        // Version conflict — fetch current state
        const current = await pool.query(
          'SELECT settings_json, version, updated_at FROM account_settings WHERE account_id = $1',
          [req.user.accountId]
        );

        const row = current.rows[0];
        return res.status(409).json({
          error: 'VERSION_CONFLICT',
          serverSettings: row?.settings_json || {},
          serverVersion: row?.version || 0,
          serverUpdatedAt: row?.updated_at || null,
        });
      }

      const row = result.rows[0];
      return res.json({
        settings: body.settings,
        version: row.version,
        updatedAt: row.updated_at,
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ code: 'VALIDATION_ERROR', errors: err.errors });
      }
      next(err);
    }
  });

  return router;
}
