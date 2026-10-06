const ADMIN_PREFIX = "/ceea-poznan-admin";

const crypto = require("crypto");

// Flaga: czy żądanie dotyczy panelu admina
const setAdminPathFlag = (req, res, next) => {
  req.isAdminPath = req.originalUrl.startsWith(ADMIN_PREFIX);
  next();
};

// Uwierzytelnienie zwykłego użytkownika (panel kursanta) – bez zmian
const requireAuth = (req, res, next) => {
  if (req.session.user) return next();
  res.redirect("/");
};

// Wymaga zalogowanego admina; ustawia res.locals.adminUser
const requireAdmin = (req, res, next) => {
  const token =
    req.headers.authorization?.replace("Bearer ", "") ||
    req.cookies?.adminToken;

  const session = req.app.locals.sessions.get(token);

  if (session && session.expires > Date.now()) {
    res.locals.adminUser = req.app.locals.admins.get(session.email) || {
      email: session.email,
    };
    req.admin = res.locals.adminUser;
    return next();
  }

  res.redirect(ADMIN_PREFIX + "/");
};

const adminOnly = (req, res, next) => {
  if (!req.isAdminPath) return res.redirect("https://ceea.org.pl/");
  next();
};

const userOnly = (req, res, next) => {
  if (req.isAdminPath) return res.redirect("https://ceea.org.pl/");
  next();
};

// ── Sesje ────────────────────────────────────────────────
function destroySession(app, token) {
  const s = app.locals.sessions.get(token);
  if (s) app.locals.admins.delete(s.email);
  app.locals.sessions.delete(token);
}
function currentSession(req, app) {
  const token = req.cookies?.adminToken;
  const s = token && app.locals.sessions.get(token);
  if (s && s.expires > Date.now()) return { token, ...s };
  return null;
}

module.exports = {
  ADMIN_PREFIX,
  setAdminPathFlag,
  requireAuth,
  requireAdmin,
  adminOnly,
  userOnly,
  destroySession,
  currentSession,
};
