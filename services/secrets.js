// services/secrets.js — szyfrowanie wartości kluczy API (AES-256-GCM)
// Klucz szyfrujący pochodzi z ENV: SECRETS_ENCRYPTION_KEY (min. 16 znaków).
const crypto = require("crypto");

const PASS = process.env.SECRETS_ENCRYPTION_KEY || "";
if (PASS.length < 16) {
  console.warn("⚠️  SECRETS_ENCRYPTION_KEY nieustawione (<16 znaków) — klucze API nie zostaną zapisane.");
}
const KEY = crypto.scryptSync(PASS, "ceea-panel-salt", 32);

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

function decrypt(payload) {
  const buf = Buffer.from(String(payload), "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

function mask(plain) {
  const s = String(plain || "");
  if (s.length <= 8) return "••••••••";
  return s.slice(0, 4) + "••••••••" + s.slice(-4);
}

module.exports = { encrypt, decrypt, mask, isConfigured: () => PASS.length >= 16 };