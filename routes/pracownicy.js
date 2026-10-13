const express = require("express");
const router = express.Router();
const supabase = require("../config/supabase");
const { ADMIN_PREFIX, requireAdmin, adminOnly } = require("../middleware/auth");

// ═══════════════════════════════════════════════════════════════
// ===== PRACOWNICY (tabela employees) =====
// ═══════════════════════════════════════════════════════════════

router.get("/pracownicy", adminOnly, requireAdmin, async (req, res) => {
  try {
    const { data: employees, error } = await supabase
      .from("employees")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) throw error;

    res.render("admin-pracownicy", {
      isAdmin: true,
      active: "pracownicy",
      employees: employees || [],
      query: req.query,
    });
  } catch (err) {
    console.error("[GET /pracownicy]", err);
    res.render("admin-pracownicy", {
      isAdmin: true,
      active: "pracownicy",
      employees: [],
      query: {},
      error: err.message,
    });
  }
});

// Dodaj (bez body.id) lub edytuj (body.id obecne)
router.post("/pracownicy", adminOnly, requireAdmin, async (req, res) => {
  try {
    const b = req.body;

    const record = {
      name: (b.name || "").trim(),
      surname: (b.surname || "").trim(),
      degree: (b.degree || "").trim() || null,
      role: (b.role || "Administracja").trim(),
      phone: (b.phone || "").trim() || null,
      second_phone: (b.second_phone || "").trim() || null,
      email: (b.email || "").trim() || null,
      sort_order: parseInt(b.sort_order, 10) || 0,
      is_active: b.is_active === "1",
    };

    if (!record.name || !record.surname) {
      return res.redirect(`${ADMIN_PREFIX}/pracownicy?error=${encodeURIComponent("Imię i nazwisko są wymagane")}`);
    }

    if (b.id) {
      const { error } = await supabase
        .from("employees")
        .update(record)
        .eq("id", b.id);
      if (error) throw error;
      return res.redirect(`${ADMIN_PREFIX}/pracownicy?success=${encodeURIComponent("Zapisano zmiany")}`);
    }

    const { error } = await supabase.from("employees").insert([record]);
    if (error) throw error;
    res.redirect(`${ADMIN_PREFIX}/pracownicy?success=${encodeURIComponent("Dodano pracownika")}`);
  } catch (err) {
    console.error("[POST /pracownicy]", err);
    res.redirect(`${ADMIN_PREFIX}/pracownicy?error=${encodeURIComponent(err.message)}`);
  }
});

router.post("/pracownicy/:id/usun", adminOnly, requireAdmin, async (req, res) => {
  try {
    const { error } = await supabase
      .from("employees")
      .delete()
      .eq("id", req.params.id);
    if (error) throw error;
    res.redirect(`${ADMIN_PREFIX}/pracownicy?success=${encodeURIComponent("Usunięto pracownika")}`);
  } catch (err) {
    console.error("[POST /pracownicy/:id/usun]", err);
    res.redirect(`${ADMIN_PREFIX}/pracownicy?error=${encodeURIComponent(err.message)}`);
  }
});

module.exports = router;
