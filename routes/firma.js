const express = require("express");
const router = express.Router();
const supabase = require("../config/supabase");
const { ADMIN_PREFIX, requireAdmin, adminOnly } = require("../middleware/auth");

// ═══════════════════════════════════════════════════════════════
// ===== DANE FIRMY (pojedynczy rekord company_settings, id=1) =====
// Widok: sekcja w /ustawienia (admin-ustawienia.ejs)
// ═══════════════════════════════════════════════════════════════

router.post("/ustawienia/firma", adminOnly, requireAdmin, async (req, res) => {
  try {
    const b = req.body;
    const clean = v => (v || "").toString().trim() || null;

    const record = {
      id: 1,
      name_company: clean(b.name_company),
      description: clean(b.description),
      street: clean(b.street),
      number_home: clean(b.number_home),
      zip_code: clean(b.zip_code),
      city: clean(b.city),
      email: clean(b.email),
      regon: clean(b.regon),
      nip: clean(b.nip),
      krs: clean(b.krs),
      bank_account_name: clean(b.bank_account_name),
      bank_account: clean(b.bank_account),
      facebook: clean(b.facebook),
      youtube: clean(b.youtube),
      opening_hours: clean(b.opening_hours),
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("company_settings")
      .upsert(record, { onConflict: "id" });

    if (error) throw error;
    res.redirect(`${ADMIN_PREFIX}/ustawienia?success=${encodeURIComponent("Zapisano dane firmy")}`);
  } catch (err) {
    console.error("[POST /ustawienia/firma]", err);
    res.redirect(`${ADMIN_PREFIX}/ustawienia?error=${encodeURIComponent(err.message)}`);
  }
});

module.exports = router;
