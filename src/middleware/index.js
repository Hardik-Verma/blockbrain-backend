import rateLimit from "express-rate-limit";

export function createApiLimiter() {
  return rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.body?.clientId || req.socket?.remoteAddress || "unknown",
    message: { code: "RATE_LIMITED", message: "Slow down and try again." },
  });
}

export function notFoundHandler(_req, res) {
  res.status(404).json({ code: "NOT_FOUND", message: "Route not found." });
}

export function errorHandler(err, _req, res, _next) {
  console.error(err);
  const status = err.statusCode || 500;
  res.status(status).json({
    code: err.code || "SERVER_ERROR",
    message: err.message || "Something went wrong.",
  });
}
