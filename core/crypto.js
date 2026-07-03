/**
 * AES-256-GCM helpers for encrypting sensitive per-agent credentials at rest
 * (currently: agents.vow_token_encrypted). Never store a raw VOW API token
 * in the database — it's a real credential granting MLS data access.
 *
 * Requires ENCRYPTION_KEY in env: a 32-byte key, base64-encoded.
 * Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 */

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

function getKey() {
  const keyB64 = process.env.ENCRYPTION_KEY;
  if (!keyB64) throw new Error('ENCRYPTION_KEY not set — cannot encrypt/decrypt credentials');
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY must decode to exactly 32 bytes');
  return key;
}

/** @param {string} plaintext @returns {string} `iv:authTag:ciphertext`, all base64 */
export function encrypt(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(':');
}

/** @param {string} payload  the `iv:authTag:ciphertext` string from encrypt() @returns {string} plaintext */
export function decrypt(payload) {
  const key = getKey();
  const [ivB64, authTagB64, ciphertextB64] = payload.split(':');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextB64, 'base64')), decipher.final()]);
  return plaintext.toString('utf-8');
}
