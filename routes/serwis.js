// ═══════════════════════════════════════════════════════════════
const express = require("express");
const router = express.Router();
const { ADMIN_PREFIX, requireAdmin, adminOnly } = require("../middleware/auth");
const { getFlags, setFlag } = require("../services/flags");

function superOnly(req, res, next) {
  if (res.locals.adminUser?.isSuper) return next();
  return res.redirect(ADMIN_PREFIX + "/ustawienia?error=" + encodeURIComponent("Tryb serwisowy — tylko super admin."));
}

router.post("/ustawienia/serwis", adminOnly, requireAdmin, superOnly, async (req, res) => {
  try {
    const clean = (v, max = 300) => (v || "").toString().trim().slice(0, max);
    const by = res.locals.adminUser?.email;
    await setFlag("maintenance_site",   req.body.site_enabled === "1",   clean(req.body.site_message),   by);
    await setFlag("maintenance_panel",  req.body.panel_enabled === "1",  clean(req.body.panel_message),  by);
    const on = req.body.site_enabled === "1" || req.body.panel_enabled === "1";
    res.redirect(ADMIN_PREFIX + "/ustawienia?success=" + encodeURIComponent(on ? "Tryb serwisowy włączony" : "Tryb serwisowy wyłączony — wszystko działa normalnie"));
  } catch (err) {
    res.redirect(ADMIN_PREFIX + "/ustawienia?error=" + encodeURIComponent(err.message));
  }
});

// Publiczny endpoint flag dla strony Gatsby (GET /api/flags — bez logowania)
async function flagsEndpoint(req, res) {
  try {
    const flags = await getFlags();
    res.json({
      maintenance: !!flags.maintenance_site?.enabled,
      message: flags.maintenance_site?.message || "",
    });
  } catch (e) {
    res.json({ maintenance: false, message: "" });
  }
}

module.exports = { router, flagsEndpoint };