import nodemailer from 'nodemailer';
import 'dotenv/config';

// Load config from process.env like the backend does
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;

console.log("SMTP USER is:", smtpUser ? smtpUser : "UNDEFINED!");

if (smtpUser && smtpPass) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: smtpUser,
      pass: smtpPass
    }
  });

  console.log("Transporter created, attempting to send email to hardikverma1902@gmail.com...");
  try {
    const info = await transporter.sendMail({
      from: smtpUser,
      to: 'hardikverma1902@gmail.com',
      subject: 'BlockBrain Direct Test',
      text: 'This is a direct test from the local backend.'
    });
    console.log("Email sent successfully! Message ID:", info.messageId);
  } catch (e) {
    console.error("Failed to send email:", e);
  }
} else {
  console.log("Missing credentials.");
}
