const express = require("express");
const router = express.Router();
const supabase = require("../config/supabase");
const { ADMIN_PREFIX, requireAdmin, adminOnly } = require("../middleware/auth");

// ═══════════════════════════════════════════════════════════════
// ===== KSIĄŻKI (tabela products) =====
// ═══════════════════════════════════════════════════════════════

// ── Lista wszystkich książek ──
router.get("/ksiazki", adminOnly, requireAdmin, async (req, res) => {
  try {
    const { data: products, error } = await supabase
      .from("products")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.render("admin-ksiazki", {
      isAdmin: true,
      active: "ksiazki",
      products: products || [],
      query: req.query,
    });
  } catch (err) {
    console.error("[GET /ksiazki]", err);
    res.render("admin-ksiazki", {
      isAdmin: true,
      active: "ksiazki",
      products: [],
      query: {},
      error: err.message,
    });
  }
});

// ── Dodaj nową książkę LUB edytuj istniejącą (body.id obecne → update) ──
router.post("/ksiazki", adminOnly, requireAdmin, async (req, res) => {
  try {
    const b = req.body;

    const record = {
      name: (b.name || "").trim(),
      author: (b.author || "").trim(),
      price: parseFloat(String(b.price || "0").replace(",", ".")) || 0,
      year: parseInt(b.year, 10) || null,
      publisher: (b.publisher || "").trim() || null,
      cover_type: (b.cover_type || "").trim() || null,
      image_url: (b.image_url || "").trim() || null,
      additional_info: (b.additional_info || "").trim() || null,
      stock_quantity: Math.max(0, parseInt(b.stock_quantity, 10) || 0),
      available: b.available === "1",
      print_on_demand: b.print_on_demand === "1",
      reprint: b.reprint === "1",
    };

    if (!record.name || !record.author) {
      return res.redirect(`${ADMIN_PREFIX}/ksiazki?error=${encodeURIComponent("Tytuł i autor są wymagane")}`);
    }

    if (b.id) {
      // Edycja
      const { error } = await supabase
        .from("products")
        .update(record)
        .eq("id", b.id);
      if (error) throw error;
      return res.redirect(`${ADMIN_PREFIX}/ksiazki?success=${encodeURIComponent("Zapisano zmiany")}`);
    }

    // Nowa pozycja
    const { error } = await supabase.from("products").insert([record]);
    if (error) throw error;
    res.redirect(`${ADMIN_PREFIX}/ksiazki?success=${encodeURIComponent("Dodano książkę")}`);
  } catch (err) {
    console.error("[POST /ksiazki]", err);
    res.redirect(`${ADMIN_PREFIX}/ksiazki?error=${encodeURIComponent(err.message)}`);
  }
});

// ── Usuń pozycję (opcjonalnie – odkomentuj w widoku kolumnę akcji) ──
router.post("/ksiazki/:id/usun", adminOnly, requireAdmin, async (req, res) => {
  try {
    const { error } = await supabase
      .from("products")
      .delete()
      .eq("id", req.params.id);
    if (error) throw error;
    res.redirect(`${ADMIN_PREFIX}/ksiazki?success=${encodeURIComponent("Usunięto książkę")}`);
  } catch (err) {
    console.error("[POST /ksiazki/:id/usun]", err);
    res.redirect(`${ADMIN_PREFIX}/ksiazki?error=${encodeURIComponent(err.message)}`);
  }
});

module.exports = router;
