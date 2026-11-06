const express = require("express");
const router = express.Router();
const supabase = require("../config/supabase");
const { ADMIN_PREFIX, requireAdmin, adminOnly } = require("../middleware/auth");
const {
  listTemplates,
  getTemplateDefaults,
  renderTemplate,
  fetchCourseForTemplates,
} = require("../services/email");

// Adres testowy — "TEST" w selectach wysyła tylko tutaj
const TEST_EMAIL = "karol.znojkiewicz@outlook.com";
const TEST_RECIPIENT = { firstName: "Karol", lastName: "Znojkiewicz", email: TEST_EMAIL };

// Przykładowy odbiorca do podglądu — żeby widać było personalizację
const PREVIEW_RECIPIENT = { firstName: "Anna", lastName: "Kowalska", email: "anna.kowalska@example.com" };

// Kursy z Supabase (do selectów w widoku)
async function fetchCourses() {
  const { data, error } = await supabase
    .from("courses")
    .select("course_id, title, is_active, start_date")
    .order("start_date", { ascending: false });
  if (error) {
    console.error("maile/kursy:", error.message);
    return [];
  }
  return (data || []).map((c) => ({
    id: c.course_id,
    course_id: c.course_id,
    title: c.title,
    nameCourse: c.title,
    is_active: c.is_active,
    start_date: c.start_date,
  }));
}

// values może przyjść jako obiekt (fetch JSON) albo string JSON (formularz)
function parseValues(body) {
  const v = body.values ?? body.valuesJson;
  if (!v) return {};
  if (typeof v === "object") return v;
  try {
    return JSON.parse(v);
  } catch {
    return {};
  }
}

// ═══════════════════════════════════════════════════════════════
// ===== MAILE =====
// ═══════════════════════════════════════════════════════════════

// ── Strona główna modułu mailowego ──
router.get("/maile", adminOnly, requireAdmin, async (req, res) => {
  const render = (params) =>
    res.render("admin-maile", {
      isAdmin: true,
      active: "maile",
      templates: listTemplates(),
      ...params,
    });

  try {
    const courses = await fetchCourses();
    const queue = req.app.get("emailQueue");

    let stats = { pending: 0, sentToday: 0, failed: 0, limit: 50 };
    if (queue && typeof queue.getStats === "function") {
      stats = await queue.getStats();
    }

    const { data: logs } = await supabase
      .from("email_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);

    render({
      courses,
      stats,
      logs: logs || [],
      sent: req.query.sent || null,
      error: req.query.error || null,
    });
  } catch (err) {
    console.error("[GET /maile] Błąd:", err);
    render({
      courses: [],
      stats: { pending: 0, sentToday: 0, failed: 0, limit: 50 },
      logs: [],
      sent: null,
      error: err.message,
    });
  }
});

// ── API: domyślne pola szablonu (dane z Supabase) ──
router.post("/maile/template-data", adminOnly, requireAdmin, async (req, res) => {
  try {
    const { templateKey, courseId } = req.body;
    const defaults = await getTemplateDefaults(templateKey, courseId);
    res.json({ ok: true, ...defaults });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ── API: podgląd maila (dokładny HTML, jak wyjdzie w skrzynce) ──
router.post("/maile/preview", adminOnly, requireAdmin, async (req, res) => {
  try {
    const { templateKey, courseId, subject, preheader } = req.body;
    const values = parseValues(req.body);
    const course = await fetchCourseForTemplates(courseId);

    const rendered = renderTemplate(templateKey, {
      subject,
      preheader,
      values,
      course,
      recipient: PREVIEW_RECIPIENT,
    });

    res.json({
      ok: true,
      html: rendered.html,
      text: rendered.text,
      subject: rendered.subject,
      preheader: rendered.preheader,
      sampleName: PREVIEW_RECIPIENT.firstName,
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ── API: Dodaj do kolejki ──
router.post("/maile", adminOnly, requireAdmin, async (req, res) => {
  try {
    const { courseId, templateKey, subject, preheader } = req.body;
    const values = parseValues(req.body);
    const queue = req.app.get("emailQueue");

    if (!queue) {
      throw new Error("Kolejka mailowa nie jest zainicjalizowana");
    }

    const course = await fetchCourseForTemplates(courseId);

    // TEST: wyślij tylko na testowy mail
    if (courseId === "test") {
      const rendered = renderTemplate(templateKey, {
        subject,
        preheader,
        values,
        course,
        recipient: TEST_RECIPIENT,
      });
      await queue.enqueue({
        recipientEmail: TEST_EMAIL,
        recipientName: `${TEST_RECIPIENT.firstName} ${TEST_RECIPIENT.lastName}`,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        courseId: null,
        templateKey,
      });
      return res.redirect(`${ADMIN_PREFIX}/maile?sent=1`);
    }

    // Normalna wysyłka
    let query = supabase
      .from("enrollments")
      .select("id, status, users(email, name, surname)")
      .or("status.eq.paid,status.eq.active");

    if (courseId && courseId !== "all") {
      query = query.eq("course_id", courseId);
    }

    const { data: enrollments, error: enrollError } = await query;

    if (enrollError) throw enrollError;
    if (!enrollments || enrollments.length === 0) {
      return res.redirect(
        `${ADMIN_PREFIX}/maile?error=${encodeURIComponent(
          "Brak odbiorców dla wybranych kryteriów"
        )}`
      );
    }

    let enqueued = 0;
    for (const enrollment of enrollments) {
      const user = enrollment.users;
      if (!user || !user.email) continue;

      const rendered = renderTemplate(templateKey, {
        subject,
        preheader,
        values,
        course,
        recipient: {
          firstName: user.name || "",
          lastName: user.surname || "",
          email: user.email,
        },
      });

      const courseIdNum = parseInt(courseId, 10);
      await queue.enqueue({
        recipientEmail: user.email,
        recipientName: `${user.name || ""} ${user.surname || ""}`.trim(),
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        courseId:
          courseId === "all" || Number.isNaN(courseIdNum) ? null : courseIdNum,
        templateKey,
      });
      enqueued++;
    }

    res.redirect(`${ADMIN_PREFIX}/maile?sent=${enqueued}`);
  } catch (err) {
    console.error("[POST /maile] Błąd:", err);
    res.redirect(
      `${ADMIN_PREFIX}/maile?error=${encodeURIComponent(err.message)}`
    );
  }
});

// ── API: Status kolejki (dla AJAX) ──
router.get("/maile/stats", adminOnly, requireAdmin, async (req, res) => {
  try {
    const queue = req.app.get("emailQueue");
    if (!queue)
      return res.json({ pending: 0, sentToday: 0, failed: 0, limit: 50 });
    res.json(await queue.getStats());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;