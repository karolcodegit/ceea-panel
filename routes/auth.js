const express = require("express");
const speakeasy = require("speakeasy");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");

const router = express.Router();

// Rate limiting — max 5 prób na 15 min
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: "Za dużo prób. Spróbuj za 15 minut." },
  standardHeaders: true,
});

// ── Zapis admina do bazy (dawniej config/admins.js) ──
const supabase = require("../config/supabase");
const adminsService = require("../services/admins");
const adminSessions = require("../services/adminSessions");

async function persistAdmin(admin) {
  const { error } = await supabase
    .from("admin_users")
    .update({
      name: admin.name,
      totp_secret: admin.secret,
      qr_setup: admin.qrSetup,
      backup_codes: admin.backupCodes || [],
      updated_at: new Date().toISOString(),
    })
    .eq("email", admin.email);
  if (error) console.error("persistAdmin:", error.message);
}

// Ostatnie logowanie — wywoływane przy KAŻDym udanym zalogowaniu
async function touchLastLogin(email) {
  const { error } = await supabase
    .from("admin_users")
    .update({ last_login: new Date().toISOString() })
    .eq("email", email);
  if (error) console.error("touchLastLogin:", error.message);
}

// Sesja admina w bazie (hash tokenu) — przetrwa restart serwera (audyt #9)
async function issueAdminSession(req, res, admin) {
  const sessionToken = await adminSessions.createSession(admin.email);
  if (!sessionToken) throw new Error("Nie udało się utworzyć sesji admina");

  res.cookie("adminToken", sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 8 * 60 * 60 * 1000,
    path: "/",
  });
}

// KROK 1: Podaj email
// BEZPIECZEŃSTWO: odpowiedź jest IDENTYCZNA dla trzech przypadków:
//   a) email nie należy do admina,
//   b) admin z aktywnym 2FA,
//   c) admin bez 2FA, ale bez ważnego tokenu konfiguracji.
// Dzięki temu endpoint nie zdradza, kto jest administratorem (brak enumeracji),
// a kod QR (sekret TOTP) trafia wyłącznie do posiadacza jednorazowego linku z maila.
router.post("/start", loginLimiter, async (req, res) => {
  const { email, setupToken } = req.body;
  const admins = req.app.locals.admins;
  const admin = admins.get((email || "").trim().toLowerCase());

  const VERIFY_RESPONSE = { step: "verify", message: "Wpisz kod z aplikacji" };

  if (!admin) {
    return res.json(VERIFY_RESPONSE); // bez zdradzania, że email nie istnieje
  }

  if (!admin.qrSetup) {
    // Konto czeka na konfigurację 2FA — QR tylko z ważnym tokenem z linku mailowego
    if (!adminsService.verifySetupToken(admin, setupToken)) {
      return res.json(VERIFY_RESPONSE); // celowo: taka sama odpowiedź jak wyżej
    }

    const otpauthUrl = `otpauth://totp/${encodeURIComponent(
      admin.email
    )}?secret=${admin.secret}&issuer=Panel%20Admin`;
    const QRCode = require("qrcode");
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl);

    return res.json({
      step: "setup",
      message: "Zeskanuj kod QR w Google Authenticator",
      qrCode: qrDataUrl,
    });
  }

  res.json(VERIFY_RESPONSE);
});

// KROK 2a: Potwierdź QR (pierwszy raz)
// Token konfiguracji wymagany PONOWNIE — to on, a nie sam email, uprawnia do setupu.
router.post("/verify-setup", loginLimiter, async (req, res) => {
  const { email, token, setupToken } = req.body;
  const admins = req.app.locals.admins;
  const admin = admins.get((email || "").trim().toLowerCase());

  if (!admin || admin.qrSetup) {
    return res.status(400).json({ error: "Nieprawidłowe dane" });
  }
  if (!adminsService.verifySetupToken(admin, setupToken)) {
    return res
      .status(400)
      .json({ error: "Link konfiguracyjny jest nieprawidłowy lub wygasł. Poproś super administratora o nowy." });
  }

  const verified = speakeasy.totp.verify({
    secret: admin.secret,
    encoding: "base32",
    token: String(token).replace(/\s/g, ""),
    window: 1,
  });

  if (!verified) return res.status(400).json({ error: "Nieprawidłowy kod" });

  admin.qrSetup = true;
  await persistAdmin(admin);
  await adminsService.clearSetupToken(admin.email, req.app); // token jednorazowy

  await issueAdminSession(req, res, admin);

  // ← ostatnie logowanie (pierwsze — po aktywacji QR)
  await touchLastLogin(admin.email);

  res.json({ success: true, admin: { email: admin.email, name: admin.name } });
});

// KROK 2b: Standardowe logowanie (kod TOTP lub backup)
router.post("/verify", loginLimiter, async (req, res) => {
  const { email, token } = req.body;
  const admins = req.app.locals.admins;
  const admin = admins.get((email || "").trim().toLowerCase());

  if (!admin || !admin.qrSetup) {
    return res.status(400).json({ error: "Nieprawidłowe dane" });
  }

  let verified = speakeasy.totp.verify({
    secret: admin.secret,
    encoding: "base32",
    token: String(token).replace(/\s/g, ""),
    window: 1,
  });

  if (!verified && Array.isArray(admin.backupCodes)) {
    const backupIndex = admin.backupCodes.findIndex(
      (bc) => !bc.used && bcrypt.compareSync(token, bc.code)
    );
    if (backupIndex !== -1) {
      admin.backupCodes[backupIndex].used = true;
      await persistAdmin(admin);
      verified = true;
    }
  }

  if (!verified) return res.status(400).json({ error: "Nieprawidłowy kod" });

  await issueAdminSession(req, res, admin);

  // ← ostatnie logowanie (standardowe logowanie)
  await touchLastLogin(admin.email);

  res.json({ success: true, admin: { email: admin.email, name: admin.name } });
});

// Wylogowanie
router.post("/wyloguj", async (req, res) => {
  const token =
    req.headers.authorization?.replace("Bearer ", "") ||
    req.cookies?.adminToken;
  await adminSessions.deleteSession(token);
  res.clearCookie("adminToken");
  res.json({ success: true });
});

module.exports = router;
