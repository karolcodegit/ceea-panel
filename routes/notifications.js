const express = require("express");
const router = express.Router();
const supabase = require("../config/supabase");
const { ADMIN_PREFIX, requireAdmin, adminOnly } = require("../middleware/auth");

// ── Strona pełnej listy powiadomień ──
router.get("/powiadomienia", adminOnly, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("notifications")
      .select("id, type, title, body, link, read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;

    res.render("admin-powiadomienia", {
      isAdmin: true,
      active: "powiadomienia",
      notifications: data || [],
      query: req.query,
    });
  } catch (err) {
    console.error("[GET /powiadomienia]", err);
    res.render("admin-powiadomienia", {
      isAdmin: true,
      active: "powiadomienia",
      notifications: [],
      query: {},
      error: err.message,
    });
  }
});

// ── API: lista dla dzwonka ──
router.get("/api/notifications", adminOnly, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("notifications")
      .select("id, type, title, body, link, read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) throw error;
    res.json({ notifications: data || [] });
  } catch (err) {
    res.status(500).json({ notifications: [], error: err.message });
  }
});

// ── API: oznacz jedno jako przeczytane ──
router.post("/api/notifications/:id/read", adminOnly, requireAdmin, async (req, res) => {
  try {
    await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", req.params.id)
      .is("read_at", null);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── API: oznacz wszystkie jako przeczytane ──
router.post("/api/notifications/read", adminOnly, requireAdmin, async (req, res) => {
  try {
    await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .is("read_at", null);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
