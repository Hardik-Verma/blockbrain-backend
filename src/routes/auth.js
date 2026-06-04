import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { pool } from '../database/index.js';
import { generateToken } from '../auth/auth.js';
import { createAuthMiddleware } from '../auth/authMiddleware.js';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'none',
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/',
};

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  displayName: z.string().min(1).max(64).optional(),
});

export function createAuthRouter({ jwtSecret, smtpUser, smtpPass, brevoApiKey }) {
  const router = Router();
  const authMiddleware = createAuthMiddleware(jwtSecret);
  
  const transporter = (smtpUser && smtpPass) ? nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: smtpUser,
      pass: smtpPass
    }
  }) : null;

  // POST /register
  router.post('/register', async (req, res, next) => {
    try {
      const { email, password, displayName } = registerSchema.parse(req.body);

      const existing = await pool.query('SELECT id FROM accounts WHERE email = $1', [email]);
      if (existing.rows.length > 0) {
        return res.status(409).json({ code: 'EMAIL_IN_USE', message: 'Email is already registered.' });
      }

      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash(password, salt);

      const result = await pool.query(
        `INSERT INTO accounts (email, password_hash, display_name)
         VALUES ($1, $2, $3) RETURNING id, email, role, display_name, avatar_url`,
        [email, hash, displayName || null]
      );

      const row = result.rows[0];
      const token = generateToken({ accountId: row.id, role: row.role }, jwtSecret);
      res.cookie('bb_token', token, COOKIE_OPTIONS);

      return res.status(201).json({
        user: {
          id: row.id,
          email: row.email,
          role: row.role,
          displayName: row.display_name,
          avatarUrl: row.avatar_url
        },
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ code: 'VALIDATION_ERROR', errors: err.errors });
      }
      next(err);
    }
  });

  // POST /login
  router.post('/login', async (req, res, next) => {
    try {
      const { email, password } = loginSchema.parse(req.body);

      const result = await pool.query(
        'SELECT id, email, role, password_hash, display_name, avatar_url FROM accounts WHERE email = $1',
        [email]
      );
      
      if (result.rows.length === 0) {
        return res.status(401).json({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' });
      }

      const row = result.rows[0];
      if (!row.password_hash) {
        return res.status(401).json({ code: 'INVALID_CREDENTIALS', message: 'Account requires password reset or was created via OTP.' });
      }

      const isMatch = await bcrypt.compare(password, row.password_hash);
      if (!isMatch) {
        return res.status(401).json({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' });
      }

      const token = generateToken({ accountId: row.id, role: row.role }, jwtSecret);
      res.cookie('bb_token', token, COOKIE_OPTIONS);

      return res.json({
        user: {
          id: row.id,
          email: row.email,
          role: row.role,
          displayName: row.display_name,
          avatarUrl: row.avatar_url
        },
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ code: 'VALIDATION_ERROR', errors: err.errors });
      }
      next(err);
    }
  });

  // GET /me
  router.get('/me', authMiddleware, async (req, res, next) => {
    try {
      const result = await pool.query(
        'SELECT id, display_name, email, role, minecraft_uuid, avatar_url FROM accounts WHERE id = $1',
        [req.user.accountId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ code: 'NOT_FOUND', message: 'Account not found.' });
      }

      const row = result.rows[0];
      return res.json({
        user: {
          id: row.id,
          displayName: row.display_name,
          email: row.email,
          role: row.role,
          minecraftUuid: row.minecraft_uuid,
          avatarUrl: row.avatar_url,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  const profileSchema = z.object({
    displayName: z.string().min(1).max(64).optional(),
    avatarUrl: z.string().max(1048576).optional().or(z.literal('')),
  });

  // PUT /me
  router.put('/me', authMiddleware, async (req, res, next) => {
    try {
      const { displayName, avatarUrl } = profileSchema.parse(req.body);
      
      const updateFields = [];
      const updateValues = [];
      let paramIdx = 1;

      if (displayName !== undefined) {
        updateFields.push(`display_name = $${paramIdx++}`);
        updateValues.push(displayName);
      }
      if (avatarUrl !== undefined) {
        updateFields.push(`avatar_url = $${paramIdx++}`);
        updateValues.push(avatarUrl === '' ? null : avatarUrl);
      }

      if (updateFields.length === 0) {
        return res.json({ ok: true });
      }

      updateValues.push(req.user.accountId);
      
      await pool.query(
        `UPDATE accounts SET ${updateFields.join(', ')} WHERE id = $${paramIdx}`,
        updateValues
      );

      return res.json({ ok: true });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ code: 'VALIDATION_ERROR', errors: err.errors });
      }
      next(err);
    }
  });

  // POST /logout
  router.post('/logout', (req, res) => {
    res.clearCookie('bb_token', COOKIE_OPTIONS);
    return res.json({ ok: true });
  });

  return router;
}
