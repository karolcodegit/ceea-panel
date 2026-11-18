// services/admins.js — zarządzanie administratorami (model: TOTP, bez haseł)
// Źródłem prawdy jest tabela admin_users; app.locals.admins (Map) to cache
// używany przez routes/auth.js – zawsze trzymaj je w synchronizacji.
//
// BEZPIECZEŃSTWO 2FA: nowy/zresetowany admin NIE dostaje QR od razu po
// wpisaniu emaila. Dostaje mailem jednorazowy link z tokenem (SHA-256 w bazie,
// ważny 24 h) i dopiero z ważnym tokenem /api/auth/start zwraca kod QR.
// To zamyka okno przejęcia konta między utworzeniem konta a zeskanowaniem QR.
const speakeasy = require("speakeasy");
const crypto = require("crypto");
const supabase = require("../config/supabase");

const SETUP_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // link konfiguracyjny ważny 24 h

const hashToken = (token) =>
  crypto.createHash("sha256").update(String(token)).digest("hex");

// Mapowanie wiersz DB <-> obiekt w app.locals.admins
const rowToAdmin = (r) => ({
  email: r.email,
  name: r.name || "",
  secret: r.totp_secret,
  qrSetup: !!r.qr_setup,
  backupCodes: r.backup_codes || [],
  isSuper: !!r.is_super,
  avatar_url: r.avatar_url || null,
  position: r.position || null,
  setupTokenHash: r.setup_token_hash || null,
  setupTokenExpires: r.setup_token_expires || null,
});
const adminToRow = (a) => ({
  email: a.email,
  name: a.name,
  totp_secret: a.secret,
  qr_setup: a.qrSetup,
  backup_codes: a.backupCodes || [],
});

const listAdmins = async () => {
  const { data, error } = await supabase
    .from("admin_users")
    .select("email, name, qr_setup, created_at, updated_at, last_login, is_super")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
};

// Generuje nowy sekret TOTP + jednorazowy token konfiguracji (zapis do bazy i cache).
// Zwraca surowy token — trafia TYLKO do maila, nigdy do logów ani odpowiedzi API.
async function issueSetupToken(email, app) {
  const setupToken = crypto.randomBytes(32).toString("hex");
  const updates = {
    setup_token_hash: hashToken(setupToken),
    setup_token_expires: new Date(Date.now() + SETUP_TOKEN_TTL_MS).toISOString(),
  };
  const { error } = await supabase.from("admin_users").update(updates).eq("email", email);
  if (error) throw error;

  const cached = app.locals.admins.get(email);
  if (cached) {
    cached.setupTokenHash = updates.setup_token_hash;
    cached.setupTokenExpires = updates.setup_token_expires;
  }
  return setupToken;
}

// Weryfikacja tokenu konfiguracji (stałoczasowa) + ważność.
function verifySetupToken(admin, token) {
  if (!admin || !token || !admin.setupTokenHash || !admin.setupTokenExpires) return false;
  if (new Date(admin.setupTokenExpires).getTime() < Date.now()) return false;
  const a = Buffer.from(admin.setupTokenHash, "hex");
  const b = Buffer.from(hashToken(token), "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Po udanej konfiguracji 2FA token staje się bezużyteczny.
async function clearSetupToken(email, app) {
  await supabase
    .from("admin_users")
    .update({ setup_token_hash: null, setup_token_expires: null })
    .eq("email", email);
  const cached = app.locals.admins.get(email);
  if (cached) {
    cached.setupTokenHash = null;
    cached.setupTokenExpires = null;
  }
}

// Zwraca { email, setupToken } — route wysyła link mailem.
const createAdmin = async ({ email, name }, app) => {
  email = email.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("Nieprawidłowy email");

  const { data: existing } = await supabase
    .from("admin_users").select("email").eq("email", email).maybeSingle();
  if (existing) throw new Error("Ten email już istnieje");

  const secret = speakeasy.generateSecret({ length: 32 }).base32;
  const row = { email, name: name || null, totp_secret: secret, qr_setup: false, backup_codes: [] };

  const { error } = await supabase.from("admin_users").insert(row);
  if (error) throw error;

  // synchronizacja cache (format zgodny z routes/auth.js)
  app.locals.admins.set(email, rowToAdmin(row));

  const setupToken = await issueSetupToken(email, app);
  return { email, setupToken };
};

const removeAdmin = async (email, currentEmail, app) => {
  if (email === currentEmail) throw new Error("Nie możesz usunąć własnego konta");
  const admins = await listAdmins();
  if (admins.length <= 1) throw new Error("Musi zostać przynajmniej jeden administrator");

  const { error } = await supabase.from("admin_users").delete().eq("email", email);
  if (error) throw error;
  app.locals.admins.delete(email);
};

const reset2fa = async (email, app) => {
  const secret = speakeasy.generateSecret({ length: 32 }).base32;
  const { error } = await supabase.from("admin_users")
    .update({ totp_secret: secret, qr_setup: false, backup_codes: [] })
    .eq("email", email);
  if (error) throw error;

  const cached = app.locals.admins.get(email);
  if (cached) {
    cached.secret = secret;
    cached.qrSetup = false;
    cached.backupCodes = [];
  }

  // Reset 2FA = nowy link konfiguracyjny (stary QR i stary token przestają działać)
  const setupToken = await issueSetupToken(email, app);
  return { setupToken };
};

// Start aplikacji: załaduj adminów z bazy do app.locals.admins
// (wywołaj w app.js ZAMIAST obecnego ładowania z config/admins.js)
const loadAdminsIntoMemory = async (app) => {
  const { data, error } = await supabase.from("admin_users").select("*");
  if (error) throw error;
  app.locals.admins = new Map((data || []).map(r => [r.email, rowToAdmin(r)]));
  console.log(`✅ Załadowano ${app.locals.admins.size} administratorów z bazy`);
};

module.exports = {
  listAdmins,
  createAdmin,
  removeAdmin,
  reset2fa,
  loadAdminsIntoMemory,
  verifySetupToken,
  clearSetupToken,
};
