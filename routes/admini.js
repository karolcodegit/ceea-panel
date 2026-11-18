const express = require("express");
const router = express.Router();
const { ADMIN_PREFIX, requireAdmin, adminOnly } = require("../middleware/auth");
const adminsService = require("../services/admins");
const { sendAdminSetupEmail } = require("../services/mailer");

// Buduje jednorazowy link konfiguracji 2FA (host z żądania — działa lokalnie i na Northflank)
function setupLink(req, email, setupToken) {
  return `${req.protocol}://${req.get("host")}${ADMIN_PREFIX}/?setup=${setupToken}&email=${encodeURIComponent(email)}`;
}

// Wysyła link mailem; gdy mail nie wyjdzie, link ląduje w komunikacie (fallback ręczny)
async function sendSetupLink(req, res, email, name, setupToken) {
  const link = setupLink(req, email, setupToken);
  try {
    await sendAdminSetupEmail(email, { setupLink: link, firstName: name || "" });
    return null; // sukces
  } catch (mailErr) {
    console.error("admini/setup-mail:", mailErr.message);
    return link; // fallback — super admin przekazuje link ręcznie
  }
}

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

// Tworzenie: bez hasła – nowy admin dostaje MAILEM jednorazowy link do konfiguracji 2FA
router.post("/admini", adminOnly, requireAdmin, async (req, res) => {
  try {
    const { email, setupToken } = await adminsService.createAdmin(req.body, req.app);
    const fallbackLink = await sendSetupLink(req, res, email, req.body.name, setupToken);
    if (fallbackLink) {
      return res.redirect(`${ADMIN_PREFIX}/admini?error=${encodeURIComponent(
        "Konto dodane, ale mail z linkiem nie wyszedł. Przekaż administratorowi ten link ręcznie (ważny 24 h): " + fallbackLink
      )}`);
    }
    res.redirect(`${ADMIN_PREFIX}/admini?success=${encodeURIComponent(
      "Dodano. Na adres administratora wysłaliśmy jednorazowy link do konfiguracji 2FA (ważny 24 h)."
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
    const { setupToken } = await adminsService.reset2fa(req.params.email, req.app);
    const fallbackLink = await sendSetupLink(req, res, req.params.email, "", setupToken);
    if (fallbackLink) {
      return res.redirect(`${ADMIN_PREFIX}/admini?error=${encodeURIComponent(
        "2FA zresetowane, ale mail z linkiem nie wyszedł. Przekaż administratorowi ten link ręcznie (ważny 24 h): " + fallbackLink
      )}`);
    }
    res.redirect(`${ADMIN_PREFIX}/admini?success=${encodeURIComponent(
      "Zresetowano 2FA — administrator dostał maila z jednorazowym linkiem do nowej konfiguracji (ważny 24 h)."
    )}`);
  } catch (err) {
    res.redirect(`${ADMIN_PREFIX}/admini?error=${encodeURIComponent(err.message)}`);
  }
});

module.exports = router;
