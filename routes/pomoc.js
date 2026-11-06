const express = require("express");
const router = express.Router();
const supabase = require("../config/supabase");

// ── helpers ──
const s = (v) => String(v ?? "").trim();
const toInt = (v, d = 0) => {
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? d : n;
};
const toBool = (v) => v === "1" || v === "on" || v === "true";
const CALLOUT_KINDS = ["info", "warning", "danger"];

// Redirect z powrotem na stronę modułu + komunikat dla flasha
function back(req, params) {
  const base = req.baseUrl || "";
  const qs = new URLSearchParams(params).toString();
  return `${base}/pomoc${qs ? `?${qs}` : ""}`;
}

function categoryPayload(body) {
  return {
    title: s(body.title),
    slug: s(body.slug) || null,
    description: s(body.description) || null,
    icon: s(body.icon) || null,
    sort_order: toInt(body.sort_order),
    is_published: toBool(body.is_published),
  };
}

function questionPayload(body) {
  const kind = s(body.callout_kind);
  return {
    category_id: toInt(body.category_id) || null,
    question: s(body.question),
    answer: s(body.answer),
    callout_kind: CALLOUT_KINDS.includes(kind) ? kind : null,
    callout_content: s(body.callout_content) || null,
    sort_order: toInt(body.sort_order),
    is_published: toBool(body.is_published),
  };
}

// ═══ LISTA ═══
router.get("/pomoc", async (req, res) => {
  try {
    const [{ data: categories, error: cErr }, { data: questions, error: qErr }] =
      await Promise.all([
        supabase
          .from("help_categories")
          .select("*")
          .order("sort_order")
          .order("id"),
        supabase
          .from("help_questions")
          .select("*")
          .order("sort_order")
          .order("id"),
      ]);
    if (cErr) console.error("admin/pomoc kategorie:", cErr.message);
    if (qErr) console.error("admin/pomoc pytania:", qErr.message);

    res.render("admin-pomoc", {
      title: "Pomoc — Panel CEEA",
      query: req.query,
      categories: categories || [],
      questions: questions || [],
    });
  } catch (err) {
    console.error("admin/pomoc:", err);
    res.render("admin-pomoc", {
      title: "Pomoc — Panel CEEA",
      query: { error: "Nie udało się pobrać danych pomocy." },
      categories: [],
      questions: [],
    });
  }
});

// ═══ KATEGORIE ═══
router.post("/pomoc/kategorie", async (req, res) => {
  try {
    const payload = categoryPayload(req.body);
    if (!payload.title) {
      return res.redirect(back(req, { error: "Podaj nazwę kategorii." }));
    }
    payload.is_published = true;

    const { error } = await supabase.from("help_categories").insert([payload]);
    if (error) throw error;
    res.redirect(
      back(req, { success: `Dodano kategorię „${payload.title}".` })
    );
  } catch (err) {
    console.error("admin/pomoc kategorie/add:", err);
    res.redirect(back(req, { error: `Nie zapisano kategorii: ${err.message}` }));
  }
});

router.post("/pomoc/kategorie/:id", async (req, res) => {
  try {
    const id = toInt(req.params.id);
    const payload = categoryPayload(req.body);
    if (!payload.title) {
      return res.redirect(back(req, { error: "Nazwa kategorii nie może być pusta." }));
    }

    const { error } = await supabase
      .from("help_categories")
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
    res.redirect(back(req, { success: `Zapisano kategorię „${payload.title}".` }));
  } catch (err) {
    console.error("admin/pomoc kategorie/update:", err);
    res.redirect(back(req, { error: `Nie zapisano kategorii: ${err.message}` }));
  }
});

router.post("/pomoc/kategorie/:id/usun", async (req, res) => {
  try {
    const id = toInt(req.params.id);
    // Pytania z tej kategorii usuwają się kaskadowo (ON DELETE CASCADE)
    const { error } = await supabase.from("help_categories").delete().eq("id", id);
    if (error) throw error;
    res.redirect(back(req, { success: "Usunięto kategorię wraz z pytaniami." }));
  } catch (err) {
    console.error("admin/pomoc kategorie/delete:", err);
    res.redirect(back(req, { error: `Nie usunięto kategorii: ${err.message}` }));
  }
});

// ═══ PYTANIA ═══
router.post("/pomoc/pytania", async (req, res) => {
  try {
    const payload = questionPayload(req.body);
    if (!payload.question) {
      return res.redirect(back(req, { error: "Podaj treść pytania." }));
    }
    payload.is_published = true;

    const { error } = await supabase.from("help_questions").insert([payload]);
    if (error) throw error;
    res.redirect(back(req, { success: "Dodano pytanie." }));
  } catch (err) {
    console.error("admin/pomoc pytania/add:", err);
    res.redirect(back(req, { error: `Nie zapisano pytania: ${err.message}` }));
  }
});

router.post("/pomoc/pytania/:id", async (req, res) => {
  try {
    const id = toInt(req.params.id);
    const payload = questionPayload(req.body);
    if (!payload.question) {
      return res.redirect(back(req, { error: "Treść pytania nie może być pusta." }));
    }

    const { error } = await supabase
      .from("help_questions")
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
    res.redirect(back(req, { success: "Zapisano pytanie." }));
  } catch (err) {
    console.error("admin/pomoc pytania/update:", err);
    res.redirect(back(req, { error: `Nie zapisano pytania: ${err.message}` }));
  }
});

router.post("/pomoc/pytania/:id/usun", async (req, res) => {
  try {
    const id = toInt(req.params.id);
    const { error } = await supabase.from("help_questions").delete().eq("id", id);
    if (error) throw error;
    res.redirect(back(req, { success: "Usunięto pytanie." }));
  } catch (err) {
    console.error("admin/pomoc pytania/delete:", err);
    res.redirect(back(req, { error: `Nie usunięto pytania: ${err.message}` }));
  }
});

module.exports = router;