import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

export function hashPassword(plaintext) {
  return bcrypt.hash(plaintext, 12);
}

export function verifyPassword(plaintext, hash) {
  return bcrypt.compare(plaintext, hash);
}

export function generateToken(payload, secret) {
  return jwt.sign(payload, secret, { expiresIn: '7d' });
}

export function verifyToken(token, secret) {
  return jwt.verify(token, secret);
}
