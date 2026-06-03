import 'dotenv/config';
import dns from 'node:dns';
import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';

dns.setDefaultResultOrder('ipv4first');

import { loadConfig } from './config.js';
import { initDatabase } from './database/index.js';
import { createChatRouter } from './routes/chat.js';
import { createUploadRouter } from './routes/upload.js';
import { createCipher } from './crypto.js';
import { SecretStore } from './services/secrets.js';
import { UsageService } from './services/usage.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { createProvider } from './providers/index.js';
import { createApiLimiter, errorHandler, notFoundHandler } from './middleware/index.js';
import { createAuthMiddleware } from './auth/authMiddleware.js';

const config = await loadConfig();
const pool = await initDatabase(config.databaseUrl);
const secretKey = config.secretKey || crypto.randomBytes(32).toString('base64');
const cipher = createCipher(secretKey);
const secretStore = new SecretStore(cipher);
const usageService = new UsageService();
const providerService = createProvider(config, secretStore);
const authMiddleware = createAuthMiddleware(config.jwtSecret);

await secretStore.seedProvider(config.upstreamProvider, config.upstreamApiKey, config.upstreamBaseUrl);

const { createModelsRouter } = await import('./routes/models.js');
const { createVersionRouter } = await import('./routes/version.js');
const { createAuthRouter } = await import('./routes/auth.js');
const { createSettingsRouter } = await import('./routes/settings.js');
const { createDashboardRouter } = await import('./routes/dashboard.js');

const app = express();
app.disable('x-powered-by');
app.use(helmet({ 
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(cors({
  origin: process.env.CORS_ORIGIN || true,
  credentials: true,
}));
app.use(compression());
app.use(express.json({ limit: '32kb' }));
app.use(cookieParser());
app.use(createApiLimiter());

// Serve uploads directory statically
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Public routes
app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/version', await createVersionRouter(config));
app.use('/models', await createModelsRouter({ providerService }));
app.use('/chat', await createChatRouter({ providerService, usageService, authMiddleware }));
app.use('/upload', createUploadRouter());

// Auth routes
app.use('/auth', await createAuthRouter({ 
  jwtSecret: config.jwtSecret,
  smtpUser: config.smtpUser,
  smtpPass: config.smtpPass,
  brevoApiKey: config.brevoApiKey
}));

// Protected routes (require authentication)
app.use('/settings', authMiddleware, await createSettingsRouter());
app.use('/dashboard', authMiddleware, await createDashboardRouter());

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`BlockBrain Cloud v2.0 listening on port ${config.port}`);
});
