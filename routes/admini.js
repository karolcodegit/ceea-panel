const express = require("express");
const router = express.Router();
const { ADMIN_PREFIX, requireAdmin, adminOnly } = require("../middleware/auth");
const adminsService = require("../services/admins");

// ═══════════════════════════════════════════════════════════════
// ===== ADMINISTRATORZY =====
// ═══════════════════════════════════════════════════════════════

router.get("/admini", adminOnly, requireAdmin, async (req, res) => {
  try {
    const admins = await adminsService.listAdmins();

    res.render("admin-admini", {
      isAdmin: true,
      active: 'administratorzy',
      pageTitle: 'Administratorzy',
      pageIcon: 'administratorzy',
      admins,
      currentEmail: res.locals.adminUser?.email || null,
      query: req.query,
    });
  } catch (err) {
    console.error("[GET /admini]", err);
    res.render("admin-admini", {
      isAdmin: true, active: "administratorzy",
      admins: [], currentEmail: null, query: {}, error: err.message,
    });
  }
});

// Tworzenie: bez hasła – nowy admin zobaczy QR przy pierwszym logowaniu (/start)
router.post("/admini", adminOnly, requireAdmin, async (req, res) => {
  try {
    await adminsService.createAdmin(req.body, req.app);
    res.redirect(`${ADMIN_PREFIX}/admini?success=${encodeURIComponent(
      "Dodano. Nowy administrator zaloguje się emailem i zeskanuje QR przy pierwszym wejściu."
    )}`);
  } catch (err) {
    res.redirect(`${ADMIN_PREFIX}/admini?error=${encodeURIComponent(err.message)}`);
  }
});

router.post("/admini/:email/usun", adminOnly, requireAdmin, async (req, res) => {
  try {
    await adminsService.removeAdmin(req.params.email, res.locals.adminUser?.email, req.app);
    res.redirect(`${ADMIN_PREFIX}/admini?success=${encodeURIComponent("Usunięto administratora")}`);
  } catch (err) {
    res.redirect(`${ADMIN_PREFIX}/admini?error=${encodeURIComponent(err.message)}`);
  }
});

router.post("/admini/:email/reset-2fa", adminOnly, requireAdmin, async (req, res) => {
  try {
    await adminsService.reset2fa(req.params.email, req.app);
    res.redirect(`${ADMIN_PREFIX}/admini?success=${encodeURIComponent(
      "Zresetowano 2FA – admin zaloguje się emailem i zeskanuje nowy QR"
    )}`);
  } catch (err) {
    res.redirect(`${ADMIN_PREFIX}/admini?error=${encodeURIComponent(err.message)}`);
  }
});

module.exports = router;
