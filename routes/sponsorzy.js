const express = require("express");
const router = express.Router();
const supabase = require("../config/supabase");
const { ADMIN_PREFIX, requireAdmin, adminOnly } = require("../middleware/auth");

// ═══════════════════════════════════════════════════════════════
// ===== SPONSORZY (tabela sponsors) =====
// ═══════════════════════════════════════════════════════════════

router.get("/sponsorzy", adminOnly, requireAdmin, async (req, res) => {
  try {
    const { data: sponsors, error } = await supabase
      .from("sponsors")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) throw error;

    res.render("admin-sponsorzy", {
      isAdmin: true,
      active: "sponsorzy",
      sponsors: sponsors || [],
      query: req.query,
    });
  } catch (err) {
    console.error("[GET /sponsorzy]", err);
    res.render("admin-sponsorzy", {
      isAdmin: true,
      active: "sponsorzy",
      sponsors: [],
      query: {},
      error: err.message,
    });
  }
});

// Dodaj (bez body.id) lub edytuj (body.id obecne)
router.post("/sponsorzy", adminOnly, requireAdmin, async (req, res) => {
  try {
    const b = req.body;

    const record = {
      name: (b.name || "").trim(),
      logo_url: (b.logo_url || "").trim() || null,
      website_url: (b.website_url || "").trim() || null,
      sort_order: parseInt(b.sort_order, 10) || 0,
      is_active: b.is_active === "1",
    };

    if (!record.name) {
      return res.redirect(`${ADMIN_PREFIX}/sponsorzy?error=${encodeURIComponent("Nazwa sponsora jest wymagana")}`);
    }

    if (b.id) {
      const { error } = await supabase
        .from("sponsors")
        .update(record)
        .eq("id", b.id);
      if (error) throw error;
      return res.redirect(`${ADMIN_PREFIX}/sponsorzy?success=${encodeURIComponent("Zapisano zmiany")}`);
    }

    const { error } = await supabase.from("sponsors").insert([record]);
    if (error) throw error;
    res.redirect(`${ADMIN_PREFIX}/sponsorzy?success=${encodeURIComponent("Dodano sponsora")}`);
  } catch (err) {
    console.error("[POST /sponsorzy]", err);
    res.redirect(`${ADMIN_PREFIX}/sponsorzy?error=${encodeURIComponent(err.message)}`);
  }
});

router.post("/sponsorzy/:id/usun", adminOnly, requireAdmin, async (req, res) => {
  try {
    const { error } = await supabase
      .from("sponsors")
      .delete()
      .eq("id", req.params.id);
    if (error) throw error;
    res.redirect(`${ADMIN_PREFIX}/sponsorzy?success=${encodeURIComponent("Usunięto sponsora")}`);
  } catch (err) {
    console.error("[POST /sponsorzy/:id/usun]", err);
    res.redirect(`${ADMIN_PREFIX}/sponsorzy?error=${encodeURIComponent(err.message)}`);
  }
});

module.exports = router;
