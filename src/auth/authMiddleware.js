import { verifyToken } from './auth.js';

export function createAuthMiddleware(jwtSecret) {
  return (req, res, next) => {
    const token = req.cookies.bb_token;

    if (!token) {
      return res.status(401).json({
        code: 'UNAUTHORIZED',
        message: 'Authentication required.',
      });
    }

    try {
      const decoded = verifyToken(token, jwtSecret);
      req.user = { accountId: decoded.accountId, role: decoded.role };
      next();
    } catch (err) {
      return res.status(401).json({
        code: 'UNAUTHORIZED',
        message: 'Authentication required.',
      });
    }
  };
}
