const speakeasy = require("speakeasy");
const bcrypt = require("bcryptjs");
const QRCode = require("qrcode");
const supabase = require("./supabase");

const TABLE = "admin_users";

async function initializeAdmins() {
  const admins = new Map();

  const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "")
    .split(",").map((e) => e.trim()).filter((e) => e);
  const ADMIN_NAMES = (process.env.ADMIN_NAMES || "Admin 1,Admin 2,Admin 3")
    .split(",").map((n) => n.trim());

  if (ADMIN_EMAILS.length === 0) {
    console.warn("⚠️  Brak ADMIN_EMAILS w .env! Panel admina nie działa.");
    return admins;
  }

  const { data: existing, error } = await supabase
    .from(TABLE).select("*").in("email", ADMIN_EMAILS);

  if (error) {
    // Lepiej nie wystartować niż zresetować ludziom 2FA
    throw new Error("Supabase: nie można pobrać adminów: " + error.message);
  }

  const byEmail = new Map((existing || []).map((row) => [row.email, row]));

  for (let i = 0; i < ADMIN_EMAILS.length; i++) {
    const email = ADMIN_EMAILS[i];
    const name = ADMIN_NAMES[i] || `Admin ${i + 1}`;
    const row = byEmail.get(email);

    if (row) {
      // Istnieje w bazie → używamy ZAPISANEGO sekretu, QR bez zmian
      admins.set(email, {
        email,
        name: row.name || name,
        secret: row.totp_secret,
        qrSetup: row.qr_setup,
        backupCodes: row.backup_codes || [],
      });
      continue;
    }

    // Nowy admin → generujemy RAZ i zapisujemy do bazy
    const secret = speakeasy.generateSecret({ name: `CEEA Panel: ${name}`, length: 32 });
    await QRCode.toDataURL(secret.otpauth_url);
    const backupCodes = Array.from({ length: 10 }, () =>
      Math.random().toString(36).substring(2, 8).toUpperCase()
    );
    const hashedCodes = await Promise.all(backupCodes.map((c) => bcrypt.hash(c, 10)));

    const { error: insErr } = await supabase.from(TABLE).insert({
      email,
      name,
      totp_secret: secret.base32,
      qr_setup: false,
      backup_codes: hashedCodes.map((h) => ({ code: h, used: false })),
    });
    if (insErr) throw new Error(`Nie można zapisać admina ${email}: ` + insErr.message);

    admins.set(email, {
      email, name,
      secret: secret.base32,
      qrSetup: false,
      backupCodes: hashedCodes.map((h) => ({ code: h, used: false })),
      _plainCodes: backupCodes,
    });

    console.log(`\n=== NOWY ADMIN: ${email} ===`);
    console.log("Secret:", secret.base32);
    console.log("Kody awaryjne (ZAPISZ!):", backupCodes.join(", "));
  }

  return admins;
}

// Write-through: każda zmiana stanu admina ląduje w bazie
async function persistAdmin(admin) {
  const { error } = await supabase
    .from(TABLE)
    .update({
      qr_setup: admin.qrSetup,
      backup_codes: admin.backupCodes,
      updated_at: new Date().toISOString(),
    })
    .eq("email", admin.email);
  if (error) console.error(`❌ persistAdmin(${admin.email}):`, error.message);
  return !error;
}

module.exports = { initializeAdmins, persistAdmin };