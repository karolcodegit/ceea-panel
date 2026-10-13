const express = require("express");
const router = express.Router();
const supabase = require("../config/supabase");
const { ADMIN_PREFIX, requireAdmin, adminOnly } = require("../middleware/auth");

// ═══════════════════════════════════════════════════════════════
// ===== FAQ (tabela faq_items) =====
// ═══════════════════════════════════════════════════════════════

router.get("/faq", adminOnly, requireAdmin, async (req, res) => {
  try {
    const { data: items, error } = await supabase
      .from("faq_items")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) throw error;

    res.render("admin-faq", {
      isAdmin: true,
      active: "faq",
      items: items || [],
      query: req.query,
    });
  } catch (err) {
    console.error("[GET /faq]", err);
    res.render("admin-faq", {
      isAdmin: true,
      active: "faq",
      items: [],
      query: {},
      error: err.message,
    });
  }
});

// Dodaj (bez body.id) lub edytuj (body.id obecne)
router.post("/faq", adminOnly, requireAdmin, async (req, res) => {
  try {
    const b = req.body;

    const record = {
      question: (b.question || "").trim(),
      answer: (b.answer || "").trim(),
      sort_order: parseInt(b.sort_order, 10) || 0,
      is_active: b.is_active === "1",
    };

    if (!record.question || !record.answer) {
      return res.redirect(`${ADMIN_PREFIX}/faq?error=${encodeURIComponent("Pytanie i odpowiedź są wymagane")}`);
    }

    if (b.id) {
      const { error } = await supabase
        .from("faq_items")
        .update(record)
        .eq("id", b.id);
      if (error) throw error;
      return res.redirect(`${ADMIN_PREFIX}/faq?success=${encodeURIComponent("Zapisano zmiany")}`);
    }

    const { error } = await supabase.from("faq_items").insert([record]);
    if (error) throw error;
    res.redirect(`${ADMIN_PREFIX}/faq?success=${encodeURIComponent("Dodano pytanie")}`);
  } catch (err) {
    console.error("[POST /faq]", err);
    res.redirect(`${ADMIN_PREFIX}/faq?error=${encodeURIComponent(err.message)}`);
  }
});

router.post("/faq/:id/usun", adminOnly, requireAdmin, async (req, res) => {
  try {
    const { error } = await supabase
      .from("faq_items")
      .delete()
      .eq("id", req.params.id);
    if (error) throw error;
    res.redirect(`${ADMIN_PREFIX}/faq?success=${encodeURIComponent("Usunięto pytanie")}`);
  } catch (err) {
    console.error("[POST /faq/:id/usun]", err);
    res.redirect(`${ADMIN_PREFIX}/faq?error=${encodeURIComponent(err.message)}`);
  }
});

module.exports = router;
