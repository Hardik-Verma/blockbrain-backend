import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { pool } from '../database/index.js';
import { generateToken, verifyToken } from '../auth/auth.js';
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

      const existing = await pool.query('SELECT id, is_verified FROM accounts WHERE email = $1', [email]);
      if (existing.rows.length > 0) {
        if (existing.rows[0].is_verified) {
          return res.status(409).json({ code: 'EMAIL_IN_USE', message: 'Email is already registered.' });
        }
        // If not verified, we can just resend OTP or overwrite. Handled in /resend-otp.
        return res.status(409).json({ code: 'EMAIL_PENDING', message: 'Account exists but is not verified. Please verify your OTP.' });
      }

      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash(password, salt);

      const otp = crypto.randomInt(100000, 999999).toString();
      const otpHash = await bcrypt.hash(otp, 5); // Fast hash
      const expiresAt = new Date(Date.now() + 10 * 60000); // 10 minutes

      const result = await pool.query(
        `INSERT INTO accounts (email, password_hash, display_name, otp_code, otp_expires_at, is_verified)
         VALUES ($1, $2, $3, $4, $5, FALSE) RETURNING id, email`,
        [email, hash, displayName || null, otpHash, expiresAt]
      );

      if (transporter) {
        transporter.sendMail({
          from: smtpUser,
          to: email,
          subject: 'BlockBrain Verification Code',
          text: `Your BlockBrain verification code is: ${otp}. It expires in 10 minutes.`,
        }).catch(e => console.error('Failed to send OTP email:', e));
      }

      return res.status(201).json({
        code: 'OTP_SENT',
        message: 'Registration pending. Please verify the OTP sent to your email.',
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ code: 'VALIDATION_ERROR', errors: err.errors });
      }
      next(err);
    }
  });

  const verifySchema = z.object({
    email: z.string().email(),
    otp: z.string().length(6),
  });

  // POST /verify-otp
  router.post('/verify-otp', async (req, res, next) => {
    try {
      const { email, otp } = verifySchema.parse(req.body);

      const result = await pool.query(
        'SELECT id, email, role, display_name, avatar_url, otp_code, otp_expires_at FROM accounts WHERE email = $1',
        [email]
      );

      if (result.rows.length === 0) {
        return res.status(400).json({ code: 'INVALID_OTP', message: 'Invalid or expired OTP.' });
      }

      const row = result.rows[0];

      if (!row.otp_code || !row.otp_expires_at || new Date() > new Date(row.otp_expires_at)) {
        return res.status(410).json({ code: 'OTP_EXPIRED', message: 'OTP has expired.' });
      }

      const isMatch = await bcrypt.compare(otp, row.otp_code);
      if (!isMatch) {
        return res.status(400).json({ code: 'INVALID_OTP', message: 'Invalid OTP.' });
      }

      // Activate account
      await pool.query(
        'UPDATE accounts SET is_verified = TRUE, otp_code = NULL, otp_expires_at = NULL WHERE id = $1',
        [row.id]
      );

      const token = generateToken({ accountId: row.id, role: row.role, email: row.email }, jwtSecret);
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

  const forgotPasswordSchema = z.object({
    email: z.string().email(),
  });

  // POST /forgot-password
  router.post('/forgot-password', async (req, res, next) => {
    try {
      const { email } = forgotPasswordSchema.parse(req.body);

      const existing = await pool.query('SELECT id, is_verified FROM accounts WHERE email = $1', [email]);
      if (existing.rows.length === 0) {
        // Return 200 to prevent email enumeration, but do nothing
        return res.status(200).json({ code: 'OTP_SENT', message: 'If an account exists, an OTP has been sent.' });
      }

      const otp = crypto.randomInt(100000, 999999).toString();
      const otpHash = await bcrypt.hash(otp, 5);
      const expiresAt = new Date(Date.now() + 10 * 60000);

      await pool.query(
        'UPDATE accounts SET otp_code = $1, otp_expires_at = $2 WHERE email = $3',
        [otpHash, expiresAt, email]
      );

      if (transporter) {
        transporter.sendMail({
          from: smtpUser,
          to: email,
          subject: 'BlockBrain Password Reset',
          text: `Your BlockBrain password reset code is: ${otp}. It expires in 10 minutes. If you did not request this, please ignore this email.`,
        }).catch(e => console.error('Failed to send forgot password email:', e));
      } else {
        console.error('CRITICAL: Cannot send email because SMTP_USER or SMTP_PASS is missing in environment variables.');
      }

      return res.status(200).json({
        code: 'OTP_SENT',
        message: 'If an account exists, an OTP has been sent.',
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ code: 'VALIDATION_ERROR', errors: err.errors });
      }
      next(err);
    }
  });

  const resetPasswordSchema = z.object({
    email: z.string().email(),
    otp: z.string().length(6),
    newPassword: z.string().min(6),
  });

  // POST /reset-password
  router.post('/reset-password', async (req, res, next) => {
    try {
      const { email, otp, newPassword } = resetPasswordSchema.parse(req.body);

      const result = await pool.query(
        'SELECT id, email, role, display_name, avatar_url, otp_code, otp_expires_at FROM accounts WHERE email = $1',
        [email]
      );

      if (result.rows.length === 0) {
        return res.status(400).json({ code: 'INVALID_OTP', message: 'Invalid or expired OTP.' });
      }

      const row = result.rows[0];

      if (!row.otp_code || !row.otp_expires_at || new Date() > new Date(row.otp_expires_at)) {
        return res.status(410).json({ code: 'OTP_EXPIRED', message: 'OTP has expired.' });
      }

      const isMatch = await bcrypt.compare(otp, row.otp_code);
      if (!isMatch) {
        return res.status(400).json({ code: 'INVALID_OTP', message: 'Invalid OTP.' });
      }

      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash(newPassword, salt);

      await pool.query(
        'UPDATE accounts SET password_hash = $1, is_verified = TRUE, otp_code = NULL, otp_expires_at = NULL WHERE id = $2',
        [hash, row.id]
      );

      const token = generateToken({ accountId: row.id, role: row.role, email: row.email }, jwtSecret);
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

  // POST /login
  router.post('/login', async (req, res, next) => {
    try {
      const { email, password } = loginSchema.parse(req.body);

      const result = await pool.query(
        'SELECT id, email, role, password_hash, display_name, avatar_url, is_verified FROM accounts WHERE email = $1',
        [email]
      );
      
      if (result.rows.length === 0) {
        return res.status(401).json({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' });
      }

      const row = result.rows[0];
      if (!row.password_hash) {
        return res.status(401).json({ code: 'INVALID_CREDENTIALS', message: 'Account requires password reset or was created via OTP.' });
      }

      if (!row.is_verified) {
        return res.status(403).json({ code: 'NOT_VERIFIED', message: 'Account is not verified. Please verify your OTP.' });
      }

      const isMatch = await bcrypt.compare(password, row.password_hash);
      if (!isMatch) {
        return res.status(401).json({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' });
      }

      const token = generateToken({ accountId: row.id, role: row.role, email: row.email }, jwtSecret);
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
