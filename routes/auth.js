const express = require("express");
const speakeasy = require("speakeasy");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const { persistAdmin } = require("../config/admins");

const router = express.Router();

// Rate limiting — max 5 prób na 15 min
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: "Za dużo prób. Spróbuj za 15 minut." },
  standardHeaders: true,
});

// KROK 1: Podaj email
router.post("/start", loginLimiter, async (req, res) => {
  const { email } = req.body;
  const admins = req.app.locals.admins;
  const admin = admins.get(email);

  if (!admin) {
    return res.status(400).json({
      error: "Nieprawidłowy email",
      exists: false,
    });
  }

  if (!admin.qrSetup) {
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

  res.json({
    step: "verify",
    message: "Wpisz kod z aplikacji",
  });
});

// KROK 2a: Potwierdź QR (pierwszy raz)
router.post("/verify-setup", loginLimiter, async (req, res) => {
  const { email, token } = req.body;
  const admins = req.app.locals.admins;
  const admin = admins.get(email);

  if (!admin) return res.status(400).json({ error: "Nieprawidłowe dane" });

  const verified = speakeasy.totp.verify({
    secret: admin.secret,
    encoding: "base32",
    token: String(token).replace(/\s/g, ""),
    window: 2,
  });

  if (!verified) {
    return res.status(400).json({ error: "Nieprawidłowy kod" });
  }

  admin.qrSetup = true;
  delete admin._plainCodes;
  await persistAdmin(admin);

  const sessionToken = crypto.randomBytes(32).toString("hex");
  req.app.locals.sessions.set(sessionToken, {
    email: admin.email,
    expires: Date.now() + 8 * 60 * 60 * 1000,
  });

  res.cookie("adminToken", sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 8 * 60 * 60 * 1000, // 8h
    path: "/",
  });

  res.json({
    success: true,
    admin: { email: admin.email, name: admin.name },
  });
});

// KROK 2b: Standardowe logowanie
router.post("/verify", loginLimiter, async (req, res) => {
  const { email, token } = req.body;
  const admins = req.app.locals.admins;
  const admin = admins.get(email);

  if (!admin || !admin.qrSetup) {
    return res.status(400).json({ error: "Nieprawidłowe dane" });
  }

  let verified = speakeasy.totp.verify({
    secret: admin.secret,
    encoding: "base32",
    token: String(token).replace(/\s/g, ""),
    window: 1,
  });

  if (!verified) {
    const backupIndex = admin.backupCodes.findIndex(
      (bc) => !bc.used && bcrypt.compareSync(token, bc.code)
    );

    if (backupIndex !== -1) {
      admin.backupCodes[backupIndex].used = true;
      await persistAdmin(admin);
      verified = true;
    }
  }

  if (!verified) {
    return res.status(400).json({ error: "Nieprawidłowy kod" });
  }

  const sessionToken = crypto.randomBytes(32).toString("hex");
  req.app.locals.sessions.set(sessionToken, {
    email: admin.email,
    expires: Date.now() + 8 * 60 * 60 * 1000,
  });

  res.cookie("adminToken", sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 8 * 60 * 60 * 1000,
    path: "/",
  });

  res.json({
    success: true,
    admin: { email: admin.email, name: admin.name },
  });
});

// Wylogowanie
router.post("/wyloguj", (req, res) => {
  const token =
    req.headers.authorization?.replace("Bearer ", "") ||
    req.cookies?.adminToken;
  req.app.locals.sessions.delete(token);
  res.clearCookie("adminToken");
  res.json({ success: true });
});

module.exports = router;