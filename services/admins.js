// services/admins.js — zarządzanie administratorami (model: TOTP, bez haseł)
// Źródłem prawdy jest tabela admin_users; app.locals.admins (Map) to cache
// używany przez routes/auth.js – zawsze trzymamy je w synchronizacji.
const speakeasy = require("speakeasy");
const supabase = require("../config/supabase");

// Mapowanie wiersz DB <-> obiekt w app.locals.admins
const rowToAdmin = (r) => ({
  email: r.email,
  name: r.name || "",
  secret: r.totp_secret,          // wymagane przez Twój auth.js
  qrSetup: !!r.qr_setup,
  backupCodes: r.backup_codes || [],
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
    .select("email, name, qr_setup, created_at, updated_at")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
};

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
  return { email };
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
};

// Start aplikacji: załaduj adminów z bazy do app.locals.admins
// (wywołaj w app.js ZAMIAST obecnego ładowania z config/admins.js)
const loadAdminsIntoMemory = async (app) => {
  const { data, error } = await supabase.from("admin_users").select("*");
  if (error) throw error;
  app.locals.admins = new Map((data || []).map(r => [r.email, rowToAdmin(r)]));
  console.log(`✅ Załadowano ${app.locals.admins.size} administratorów z bazy`);
};

module.exports = { listAdmins, createAdmin, removeAdmin, reset2fa, loadAdminsIntoMemory };
