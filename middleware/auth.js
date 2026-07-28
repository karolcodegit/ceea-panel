const ADMIN_PREFIX = "/ceea-poznan-admin";

const setAdminPathFlag = (req, res, next) => {
  req.isAdminPath = req.path.startsWith(ADMIN_PREFIX);
  next();
};

const requireAuth = (req, res, next) => {
  if (req.session.user) return next();
  res.redirect("/");
};

const requireAdmin = (req, res, next) => {
  const token =
    req.headers.authorization?.replace("Bearer ", "") ||
    req.cookies?.adminToken;

  const session = req.app.locals.sessions.get(token);

  if (session && session.expires > Date.now()) {
    req.admin = req.app.locals.admins.get(session.email);
    req.session.isAdmin = true;
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

module.exports = {
  ADMIN_PREFIX,
  setAdminPathFlag,
  requireAuth,
  requireAdmin,
  adminOnly,
  userOnly,
};