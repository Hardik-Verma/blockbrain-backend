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
  email: z.string().email().transform(e => e.toLowerCase()),
  password: z.string().min(6),
});

const registerSchema = z.object({
  email: z.string().email().transform(e => e.toLowerCase()),
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

  const getHtmlTemplate = (title, code, message) => `
    <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #0a0a0a; color: #ffffff; padding: 40px; border-radius: 16px; border: 1px solid rgba(255,255,255,0.1);">
      <div style="text-align: center; margin-bottom: 30px;">
        <h1 style="background: linear-gradient(to right, #ffffff, #888888); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-size: 28px; font-weight: 800; margin: 0;">BlockBrain</h1>
      </div>
      <div style="background-color: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 12px; padding: 30px; text-align: center;">
        <h2 style="font-size: 20px; font-weight: 600; margin-top: 0; margin-bottom: 15px; color: #ffffff;">${title}</h2>
        <p style="color: #a3a3a3; font-size: 14px; line-height: 1.6; margin-bottom: 25px;">${message}</p>
        <div style="background-color: rgba(0,0,0,0.5); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 8px; padding: 15px; margin-bottom: 10px;">
          <span style="font-family: monospace; font-size: 32px; letter-spacing: 8px; font-weight: bold; color: #3b82f6;">${code}</span>
        </div>
        <p style="color: #666666; font-size: 12px; margin-top: 20px;">This code will expire in 10 minutes.</p>
      </div>
      <div style="text-align: center; margin-top: 30px; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 20px;">
        <p style="color: #444444; font-size: 12px; margin: 0;">If you didn't request this email, you can safely ignore it.</p>
        <p style="color: #444444; font-size: 12px; margin: 5px 0 0 0;">&copy; ${new Date().getFullYear()} BlockBrain. All rights reserved.</p>
      </div>
    </div>
  `;

  // Helper function to send email bypassing SMTP blocks by using HTTP API if possible
  const sendEmail = async (to, subject, title, code, message) => {
    const htmlContent = getHtmlTemplate(title, code, message);
    if (brevoApiKey) {
      try {
        const response = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: {
            'accept': 'application/json',
            'api-key': brevoApiKey,
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            sender: { email: smtpUser || 'noreply@blockbrain.com', name: 'BlockBrain' },
            to: [{ email: to }],
            subject: subject,
            htmlContent: htmlContent
          })
        });
        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Brevo HTTP API failed: ${response.status} ${errText}`);
        }
        console.log('Successfully sent email via Brevo HTTP API to', to);
        return;
      } catch (err) {
        console.error('Brevo API error:', err);
      }
    }
    
    // Fallback to Nodemailer (Gmail SMTP)
    if (transporter) {
      transporter.sendMail({
        from: smtpUser,
        to: to,
        subject: subject,
        html: htmlContent,
      }).then(info => console.log('Successfully sent email via Gmail SMTP! MessageID:', info.messageId))
        .catch(e => console.error('Failed to send email via SMTP:', e));
    } else {
      console.error('CRITICAL: Cannot send email because no email provider is configured.');
    }
  };

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

      sendEmail(email, 'BlockBrain Verification Code', 'Verify your email address', otp, 'Use the verification code below to verify your BlockBrain account.');

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

  // POST /resend-otp
  router.post('/resend-otp', async (req, res, next) => {
    try {
      const { email } = z.object({ email: z.string().email().transform(e => e.toLowerCase()) }).parse(req.body);

      const existing = await pool.query('SELECT id, is_verified FROM accounts WHERE email = $1', [email]);
      if (existing.rows.length === 0 || existing.rows[0].is_verified) {
        return res.status(400).json({ code: 'INVALID_REQUEST', message: 'Account not found or already verified.' });
      }

      const otp = crypto.randomInt(100000, 999999).toString();
      const otpHash = await bcrypt.hash(otp, 5);
      const expiresAt = new Date(Date.now() + 10 * 60000);

      await pool.query(
        'UPDATE accounts SET otp_code = $1, otp_expires_at = $2 WHERE email = $3',
        [otpHash, expiresAt, email]
      );

      sendEmail(email, 'BlockBrain Verification Code', 'Verify your email address', otp, 'Use the verification code below to verify your BlockBrain account.');

      return res.status(200).json({
        code: 'OTP_SENT',
        message: 'A new verification code has been sent.',
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ code: 'VALIDATION_ERROR', errors: err.errors });
      }
      next(err);
    }
  });

  const verifySchema = z.object({
    email: z.string().email().transform(e => e.toLowerCase()),
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

  // GET /debug-email
  router.get('/debug-email', (req, res) => {
    res.json({
      smtpUserConfigured: !!smtpUser,
      smtpUserValue: smtpUser || 'MISSING',
      smtpPassConfigured: !!smtpPass,
      hasTransporter: !!transporter
    });
  });

  const forgotPasswordSchema = z.object({
    email: z.string().email().transform(e => e.toLowerCase()),
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

      sendEmail(email, 'BlockBrain Password Reset', 'Password Reset Request', otp, 'Use the code below to reset your BlockBrain password.');

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
    email: z.string().email().transform(e => e.toLowerCase()),
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

  // POST /delete-account/request
  router.post('/delete-account/request', authMiddleware, async (req, res, next) => {
    try {
      const { password } = z.object({ password: z.string() }).parse(req.body);
      const email = req.user.email;
      
      const result = await pool.query('SELECT password_hash FROM accounts WHERE id = $1', [req.user.accountId]);
      if (result.rows.length === 0) return res.status(404).json({ message: 'Account not found' });
      
      const isMatch = await bcrypt.compare(password, result.rows[0].password_hash);
      if (!isMatch) return res.status(401).json({ code: 'INVALID_PASSWORD', message: 'Incorrect password.' });

      const otp = crypto.randomInt(100000, 999999).toString();
      const otpHash = await bcrypt.hash(otp, 5);
      const expiresAt = new Date(Date.now() + 10 * 60000);

      await pool.query(
        'UPDATE accounts SET otp_code = $1, otp_expires_at = $2 WHERE id = $3',
        [otpHash, expiresAt, req.user.accountId]
      );

      sendEmail(email, 'BlockBrain Account Deletion', 'Account Deletion Request', otp, 'Use the code below to permanently delete your BlockBrain account. This action cannot be undone.');

      return res.status(200).json({ code: 'OTP_SENT', message: 'Deletion OTP sent.' });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ errors: err.errors });
      next(err);
    }
  });

  // POST /delete-account/confirm
  router.post('/delete-account/confirm', authMiddleware, async (req, res, next) => {
    try {
      const { otp } = z.object({ otp: z.string().length(6) }).parse(req.body);
      
      const result = await pool.query('SELECT otp_code, otp_expires_at FROM accounts WHERE id = $1', [req.user.accountId]);
      if (result.rows.length === 0) return res.status(404).json({ message: 'Account not found' });
      
      const row = result.rows[0];
      if (!row.otp_code || !row.otp_expires_at || new Date() > new Date(row.otp_expires_at)) {
        return res.status(410).json({ code: 'OTP_EXPIRED', message: 'OTP has expired.' });
      }

      const isMatch = await bcrypt.compare(otp, row.otp_code);
      if (!isMatch) return res.status(400).json({ code: 'INVALID_OTP', message: 'Invalid OTP.' });

      // Wipe everything
      await pool.query('DELETE FROM accounts WHERE id = $1', [req.user.accountId]);

      res.clearCookie('bb_token', COOKIE_OPTIONS);
      return res.status(200).json({ success: true, message: 'Account deleted.' });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ errors: err.errors });
      next(err);
    }
  });

  return router;
}
