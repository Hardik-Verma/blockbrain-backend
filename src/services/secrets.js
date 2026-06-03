import { pool } from '../database/index.js';

export class SecretStore {
  constructor(cipher) {
    this.cipher = cipher;
  }

  async seedProvider(provider, apiKey, baseUrl) {
    if (!apiKey) return;
    await pool.query(
      `INSERT INTO provider_secrets(provider, encrypted_api_key, base_url, updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT(provider) DO UPDATE SET encrypted_api_key = EXCLUDED.encrypted_api_key, base_url = EXCLUDED.base_url, updated_at = EXCLUDED.updated_at`,
      [provider, this.cipher.encrypt(apiKey), baseUrl, Date.now()]
    );
  }

  async getProviderSecret(provider) {
    const result = await pool.query(`SELECT * FROM provider_secrets WHERE provider = $1`, [provider]);
    const row = result.rows[0];
    if (!row) return null;
    return {
      provider: row.provider,
      apiKey: this.cipher.decrypt(row.encrypted_api_key),
      baseUrl: row.base_url,
      updatedAt: row.updated_at,
    };
  }
}
