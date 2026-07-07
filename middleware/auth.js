// Middleware do ochrony endpointów admina
function requireAuth(req, res, next) {
    const token = req.headers.authorization?.replace('Bearer ', '') 
               || req.cookies?.session;
    
    const sessions = req.app.locals.sessions;
    const admins = req.app.locals.admins;
    
    const session = sessions?.get(token);
    
    if (!session || session.expires < Date.now()) {
        return res.status(401).json({ error: 'Wymagane logowanie' });
    }
    
    req.admin = admins.get(session.email);
    next();
}

module.exports = { requireAuth };