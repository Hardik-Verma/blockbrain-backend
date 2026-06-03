import crypto from "node:crypto";

export function createCipher(secretKey) {
  if (!secretKey) {
    throw new Error("MINEGPT_SECRET_KEY is required for encrypted provider storage.");
  }
  const key = normalizeSecret(secretKey);
  return {
    encrypt(plainText) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([cipher.update(String(plainText), "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return Buffer.concat([iv, tag, encrypted]).toString("base64");
    },
    decrypt(payload) {
      const buffer = Buffer.from(payload, "base64");
      const iv = buffer.subarray(0, 12);
      const tag = buffer.subarray(12, 28);
      const encrypted = buffer.subarray(28);
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
      return decrypted.toString("utf8");
    },
  };
}

function normalizeSecret(secretKey) {
  const buffer = Buffer.from(secretKey, "base64");
  if (buffer.length === 32) {
    return buffer;
  }
  return crypto.createHash("sha256").update(secretKey).digest();
}
