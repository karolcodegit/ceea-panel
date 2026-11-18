const ADMIN_PREFIX = "/ceea-poznan-admin";

const adminSessions = require("../services/adminSessions");

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

// Wymaga zalogowanego admina; ustawia res.locals.adminUser.
// Sesja admina żyje w tabeli admin_sessions (hash tokenu) — przetrwa restart.
const requireAdmin = async (req, res, next) => {
  const token =
    req.headers.authorization?.replace("Bearer ", "") ||
    req.cookies?.adminToken;

  const session = await adminSessions.getSession(token);

  if (session) {
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

// ── Sesje adminów (baza, hash tokenu) ─────────────────────────
async function destroySession(app, token) {
  await adminSessions.deleteSession(token);
}
async function currentSession(req, app) {
  const token = req.cookies?.adminToken;
  const s = token && (await adminSessions.getSession(token));
  return s ? { token, ...s } : null;
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
