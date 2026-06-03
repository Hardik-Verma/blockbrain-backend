import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function loadConfig() {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const fallbackVersion = JSON.parse(await fs.readFile(path.resolve(moduleDir, '..', 'version.json'), 'utf8'));
  return {
    port: Number(process.env.PORT || 3000),
    databaseUrl: process.env.DATABASE_URL || 'postgresql://localhost:5432/blockbrain',
    jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
    smtpUser: process.env.SMTP_USER || '',
    smtpPass: process.env.SMTP_PASS || '',
    secretKey: process.env.BLOCKBRAIN_SECRET_KEY || '',
    upstreamProvider: (process.env.BLOCKBRAIN_UPSTREAM_PROVIDER || 'openrouter').toLowerCase(),
    upstreamApiKey: process.env.BLOCKBRAIN_UPSTREAM_API_KEY || '',
    upstreamBaseUrl: process.env.BLOCKBRAIN_UPSTREAM_BASE_URL || 'https://openrouter.ai/api/v1',
    version: process.env.BLOCKBRAIN_VERSION || fallbackVersion.latestVersion,
    downloadUrl: process.env.BLOCKBRAIN_DOWNLOAD_URL || fallbackVersion.downloadUrl,
    changelog: safeParseChangelog(process.env.BLOCKBRAIN_CHANGELOG) || fallbackVersion.changelog,
  };
}

function safeParseChangelog(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : null;
  } catch {
    return null;
  }
}
