const speakeasy = require('speakeasy');
const bcrypt = require('bcryptjs');

// Parsuj emaile z .env
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(e => e.trim())
    .filter(e => e);

const ADMIN_NAMES = (process.env.ADMIN_NAMES || 'Admin 1,Admin 2,Admin 3')
    .split(',')
    .map(n => n.trim());

async function initializeAdmins() {
    const admins = new Map();
    
    if (ADMIN_EMAILS.length === 0) {
        console.warn('⚠️  Brak ADMIN_EMAILS w .env! Panel admina nie działa.');
        return admins;
    }
    
    for (let i = 0; i < ADMIN_EMAILS.length; i++) {
        const email = ADMIN_EMAILS[i];
        const name = ADMIN_NAMES[i] || `Admin ${i + 1}`;
        
        const secret = speakeasy.generateSecret({
            name: `Panel: ${name}`,
            length: 32
        });
        
        const backupCodes = Array.from({ length: 10 }, () => 
            Math.random().toString(36).substring(2, 8).toUpperCase()
        );
        
        const hashedCodes = await Promise.all(
            backupCodes.map(code => bcrypt.hash(code, 10))
        );
        
        admins.set(email, {
            email,
            name,
            secret: secret.base32,
            qrSetup: false,
            backupCodes: hashedCodes.map(hash => ({ code: hash, used: false })),
            _plainCodes: backupCodes
        });
        
        console.log(`\n=== ADMIN: ${email} ===`);
        console.log('Kody awaryjne (ZAPISZ!):', backupCodes);
    }
    
    return admins;

    
}
module.exports = { initializeAdmins };