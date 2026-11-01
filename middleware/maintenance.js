// middleware/maintenance.js — bramka trybu serwisowego
// Blokuje ROUTY UCZESTNIKA (app.use("/", userRoutes)), gdy flaga maintenance_panel jest włączona.
// Przepuszcza: zasoby statyczne, API auth (logowanie admina) oraz zalogowanych adminów.
const { getFlags } = require("../services/flags");

module.exports = async function maintenanceGate(req, res, next) {
  try {
    const p = req.path;
    // zawsze przepuszczaj zasoby + admina + api auth
    if (/^\/(css|js|images|favicon)/.test(p)) return next();
    if (p.startsWith(process.env.ADMIN_PREFIX || "/ceea-poznan-admin")) return next();
    if (p.startsWith("/api/auth")) return next();

    const flags = await getFlags();
    const m = flags.maintenance_panel;
    if (!m || !m.enabled) return next();

    // zalogowany admin może wejść (sprawdzamy sesję admina)
    const token = req.cookies?.adminToken;
    const session = token && req.app.locals.sessions.get(token);
    if (session && session.expires > Date.now()) return next();

    res.status(503).render("maintenance", {
      title: "Przerwa techniczna",
      message: m.message,
      contact: true,
    });
  } catch (e) {
    next();   // przy błędzie bazy nie blokuj ruchu
  }
};