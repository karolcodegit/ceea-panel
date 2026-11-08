const express = require("express");
const router = express.Router();
const supabase = require("../config/supabase");
const { adminOnly } = require("../middleware/auth");

// GET /kontakt — kontakt do twórcy panelu / wsparcie techniczne
router.get("/kontakt", adminOnly, async (req, res) => {
  let support = [];
  try {
    // Kontakt do twórcy panelu = konta super admina (dane z profili, edytowalne w /profil)
    const { data, error } = await supabase
      .from("admin_users")
      .select("email, name, phone, position, avatar_url, bio")
      .eq("is_super", true)
      .order("created_at", { ascending: true });
    if (error) throw error;
    support = data || [];
  } catch (e) {
    console.error("Kontakt fetch error:", e.message);
  }
  res.render("admin-kontakt", {
    isAdmin: true,
    active: "kontakt",
    support,
  });
});

module.exports = router;