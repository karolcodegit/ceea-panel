const express = require('express');
const speakeasy = require('speakeasy');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

const router = express.Router();

// Rate limiting — max 5 prób na 15 min
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { error: 'Za dużo prób. Spróbuj za 15 minut.' },
    standardHeaders: true
});

// KROK 1: Podaj email
router.post('/start', loginLimiter, async (req, res) => {
    const { email } = req.body;
    const admins = req.app.locals.admins;
    const admin = admins.get(email);

    console.log('=== DEBUG QR ===');
    console.log('Email:', email);
    console.log('Admin secret:', admin?.secret);
    console.log('Admin qrSetup:', admin?.qrSetup);


    if (!admin) {
        return res.status(400).json({ 
            error: 'Nieprawidłowy email',
            exists: false 
        });
    }

    if (!admin.qrSetup) {
        const otpauthUrl = `otpauth://totp/${encodeURIComponent(admin.email)}?secret=${admin.secret}&issuer=Panel%20Admin`;

        console.log('OTP URL:', otpauthUrl);
        
        // WYCIĄGNIJ sekret z URL
        const urlSecret = new URL(otpauthUrl).searchParams.get('secret');
        console.log('Sekret w URL:', urlSecret);
        console.log('Sekret w admin:', admin.secret);
        console.log('Czy zgadza się?', urlSecret === admin.secret);


        const QRCode = require('qrcode');
        const qrDataUrl = await QRCode.toDataURL(otpauthUrl);

        return res.json({
            step: 'setup',
            message: 'Zeskanuj kod QR w Google Authenticator',
            qrCode: qrDataUrl
        });
    }

    res.json({
        step: 'verify',
        message: 'Wpisz kod z aplikacji'
    });
});

// KROK 2a: Potwierdź QR (pierwszy raz)
router.post('/verify-setup', loginLimiter, (req, res) => {
    const { email, token } = req.body;
    const admins = req.app.locals.admins;
    const admin = admins.get(email);

    if (!admin) return res.status(400).json({ error: 'Nieprawidłowe dane' });

    const verified = speakeasy.totp.verify({
        secret: admin.secret,
        encoding: 'base32',
        token: String(token).replace(/\s/g, ""),
        window: 2
    });

    if (!verified) {
        return res.status(400).json({ error: 'Nieprawidłowy kod' });
    }

    admin.qrSetup = true;
    delete admin._plainCodes;

    const sessionToken = crypto.randomBytes(32).toString('hex');
    req.app.locals.sessions.set(sessionToken, {
        email: admin.email,
        expires: Date.now() + 8 * 60 * 60 * 1000
    });

    // Ustaw cookie po stronie serwera
    res.cookie('adminToken', sessionToken, {
        httpOnly: true,
        secure: false, // true w produkcji (HTTPS)
        maxAge: 8 * 60 * 60 * 1000, // 8h
        path: '/'
    });

    res.json({
        success: true,
        admin: { email: admin.email, name: admin.name }
    });
});

// KROK 2b: Standardowe logowanie
router.post('/verify', loginLimiter, (req, res) => {
    const { email, token } = req.body;
    const admins = req.app.locals.admins;
    const admin = admins.get(email);

    if (!admin || !admin.qrSetup) {
        return res.status(400).json({ error: 'Nieprawidłowe dane' });
    }

    let verified = speakeasy.totp.verify({
        secret: admin.secret,
        encoding: 'base32',
        token: token,
        window: 1
    });

    if (!verified) {
        const backupIndex = admin.backupCodes.findIndex(
            bc => !bc.used && bcrypt.compareSync(token, bc.code)
        );

        if (backupIndex !== -1) {
            admin.backupCodes[backupIndex].used = true;
            verified = true;
        }
    }

    if (!verified) {
        return res.status(400).json({ error: 'Nieprawidłowy kod' });
    }

    const sessionToken = crypto.randomBytes(32).toString('hex');
    req.app.locals.sessions.set(sessionToken, {
        email: admin.email,
        expires: Date.now() + 8 * 60 * 60 * 1000
    });

    // Ustaw cookie po stronie serwera
    res.cookie('adminToken', sessionToken, {
        httpOnly: true,
        secure: false, // true w produkcji (HTTPS)
        maxAge: 8 * 60 * 60 * 1000,
        path: '/'
    });

    res.json({
        success: true,
        admin: { email: admin.email, name: admin.name }
    });
});

// Wylogowanie
router.post('/logout', (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.adminToken;
    req.app.locals.sessions.delete(token);
    res.clearCookie('adminToken');
    res.json({ success: true });
});

module.exports = router;