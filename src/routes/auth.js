import { Router } from 'express';
import { z } from 'zod';
import nodemailer from 'nodemailer';
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

const emailSchema = z.object({
  email: z.string().email(),
});

const verifySchema = z.object({
  email: z.string().email(),
  code: z.string().length(6),
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

  // POST /request-code
  router.post('/request-code', async (req, res, next) => {
    try {
      const { email } = emailSchema.parse(req.body);
      const otp = Math.floor(100000 + Math.random() * 900000).toString(); // 6 digit
      const expiresAt = new Date(Date.now() + 10 * 60000); // 10 mins

      const emailHtml = `
<!DOCTYPE html>
<html>
<head>
<style>
  body { margin: 0; padding: 0; background-color: #050608; font-family: 'Inter', -apple-system, sans-serif; color: #F3F4F6; }
  .container { max-width: 600px; margin: 40px auto; background-color: #0B0D11; border: 1px solid #1f2937; border-radius: 16px; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.5); }
  .header { background: linear-gradient(135deg, #11141B 0%, #050608 100%); padding: 30px; text-align: center; border-bottom: 1px solid #1f2937; }
  .logo { font-size: 24px; font-weight: 800; letter-spacing: 2px; color: #ffffff; margin: 0; text-transform: uppercase; }
  .content { padding: 40px 30px; text-align: center; }
  .title { font-size: 20px; font-weight: 600; margin-bottom: 10px; color: #ffffff; }
  .text { font-size: 15px; color: #9CA3AF; line-height: 1.6; margin-bottom: 30px; }
  .code-box { background: linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.01) 100%); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 20px; margin-bottom: 30px; }
  .code { font-size: 36px; font-weight: 700; color: #ffffff; letter-spacing: 8px; font-family: monospace; margin: 0; text-shadow: 0 0 20px rgba(255,255,255,0.2); }
  .footer { padding: 20px; text-align: center; font-size: 12px; color: #4B5563; border-top: 1px solid #1f2937; background-color: #050608; }
</style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 class="logo">BLOCKBRAIN</h1>
    </div>
    <div class="content">
      <h2 class="title">Authentication Request</h2>
      <p class="text">We received a request to log in to your BlockBrain companion account. Please use the secure code below to authenticate your session.</p>
      <div class="code-box">
        <p class="code">${otp}</p>
      </div>
      <p class="text" style="font-size: 13px;">This code will expire in 10 minutes. If you did not request this, you can safely ignore this email.</p>
    </div>
    <div class="footer">
      &copy; ${new Date().getFullYear()} BlockBrain Cloud. All rights reserved.
    </div>
  </div>
</body>
</html>
      `;

      if (brevoApiKey) {
        const response = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: {
            'accept': 'application/json',
            'api-key': brevoApiKey,
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            sender: { email: smtpUser || "noreply@blockbrain.dev", name: "BlockBrain AI" },
            to: [{ email: email }],
            subject: 'Your BlockBrain Login Code',
            htmlContent: emailHtml
          })
        });

        if (!response.ok) {
          const errText = await response.text();
          console.error("[AUTH SYSTEM] Brevo API Error:", errText);
          throw new Error("Failed to send email via Brevo.");
        }
        console.log(`[AUTH SYSTEM] EMAIL SENT to ${email} via Brevo API.`);
      } else {
        console.log(`[AUTH SYSTEM] MOCK EMAIL SENT to ${email} -> CODE: ${otp}`);
      }

      // Upsert account with new OTP code
      await pool.query(
        `INSERT INTO accounts (email, otp_code, otp_expires_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (email) DO UPDATE 
         SET otp_code = EXCLUDED.otp_code, otp_expires_at = EXCLUDED.otp_expires_at`,
        [email, otp, expiresAt]
      );

      return res.status(200).json({ ok: true, message: 'Code sent.' });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ code: 'VALIDATION_ERROR', errors: err.errors });
      }
      next(err);
    }
  });

  // POST /verify-code
  router.post('/verify-code', async (req, res, next) => {
    try {
      const { email, code } = verifySchema.parse(req.body);

      const result = await pool.query(
        'SELECT id, email, role, otp_code, otp_expires_at, display_name, avatar_url FROM accounts WHERE email = $1',
        [email]
      );
      
      if (result.rows.length === 0) {
        return res.status(401).json({ code: 'INVALID_CODE', message: 'Invalid or expired code.' });
      }

      const row = result.rows[0];
      if (!row.otp_code || row.otp_code !== code || new Date() > new Date(row.otp_expires_at)) {
        return res.status(401).json({ code: 'INVALID_CODE', message: 'Invalid or expired code.' });
      }

      // Clear OTP
      await pool.query('UPDATE accounts SET otp_code = NULL, otp_expires_at = NULL WHERE id = $1', [row.id]);

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
