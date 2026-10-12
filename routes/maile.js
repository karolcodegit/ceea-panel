const express = require("express");
const router = express.Router();
const supabase = require("../config/supabase");
const { ADMIN_PREFIX, requireAdmin, adminOnly } = require("../middleware/auth");
const { fetchAllCourses } = require("../config/datocms");
const { renderTemplate, getTemplateDefaults } = require("../services/email");

// ═══════════════════════════════════════════════════════════════
// ===== MAILE =====
// ═══════════════════════════════════════════════════════════════

// ── Strona główna modułu mailowego ──
router.get("/maile", adminOnly, requireAdmin, async (req, res) => {
  try {
    const courses = await fetchAllCourses();
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

    res.render("admin-maile", {
      isAdmin: true,
      active: "maile",
      courses,
      stats,
      logs: logs || [],
      sent: req.query.sent || null,
      error: req.query.error || null,
    });
  } catch (err) {
    console.error("[GET /maile] Błąd:", err);
    const courses = await fetchAllCourses().catch(() => []);
    res.render("admin-maile", {
      isAdmin: true,
      active: "maile",
      courses,
      stats: { pending: 0, sentToday: 0, failed: 0, limit: 50 },
      logs: [],
      sent: null,
      error: err.message,
    });
  }
});

// ── API: Pobierz predefiniowane dane szablonu ──
router.post(
  "/maile/template-data",
  adminOnly,
  requireAdmin,
  async (req, res) => {
    try {
      const { templateKey, courseId, courseName, courseDate } = req.body;

      const data = {
        courseTitle: courseName || "Kurs CEEA",
        courseNumber:
          courseId && courseId !== "all" && courseId !== "test"
            ? courseId
            : "6",
        date: courseDate || "22-24.10.2026",
        location: "Hotelu Ilonn w Poznaniu",
        firstName: "Jan",
        total: "2500",
        orderNumber: "CEEA-2026-001",
        panelUrl: "https://panel.ceea.org.pl",
        agendaUrl: "",
      };

      const defaults = getTemplateDefaults(templateKey, data);
      res.json({ ok: true, ...defaults });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  }
);

// ── API: Podgląd maila ──
router.post("/maile/preview", adminOnly, requireAdmin, async (req, res) => {
  try {
    const {
      templateKey,
      courseTitle,
      firstName,
      bodyHtml,
      subject,
      preheader,
    } = req.body;

    const data = {
      courseTitle: courseTitle || "Medycyna okołooperacyjna",
      courseNumber: "6",
      firstName: firstName || "Jan",
      total: "2500",
      orderNumber: "CEEA-2026-001",
      panelUrl: "https://panel.ceea.org.pl",
      date: "22-24.10.2026",
      location: "Hotelu Ilonn w Poznaniu",
      agendaUrl: "https://ceea.org.pl/program",
      subject,
      preheader,
    };

    const rendered = renderTemplate(templateKey, data, bodyHtml);
    res.json({
      ok: true,
      html: rendered.html,
      text: rendered.text,
      subject: rendered.subject,
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ── API: Dodaj do kolejki ──
router.post("/maile", adminOnly, requireAdmin, async (req, res) => {
  try {
    const { courseId, templateKey, subject, bodyHtml, preheader } = req.body;
    const queue = req.app.get("emailQueue");

    if (!queue) {
      throw new Error("Kolejka mailowa nie jest zainicjalizowana");
    }

    // TEST: wyślij tylko na testowy mail
    if (courseId === "test") {
      const data = {
        courseTitle: req.body.courseTitle || "Kurs CEEA",
        firstName: "Karol",
        total: req.body.total || "",
        orderNumber: req.body.orderNumber || "",
        panelUrl: "https://panel.ceea.org.pl",
        date: req.body.date || "",
        location: req.body.location || "",
        agendaUrl: req.body.agendaUrl || "",
        subject,
        preheader,
      };
      const rendered = renderTemplate(templateKey, data, bodyHtml);
      await queue.enqueue({
        recipientEmail: "karol.znojkiewicz@outlook.com",
        recipientName: "Karol Znojkiewicz",
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

      const data = {
        courseTitle: req.body.courseTitle || "Kurs CEEA",
        courseNumber: req.body.courseNumber || "6",
        firstName: user.name || "",
        lastName: user.surname || "",
        total: req.body.total || "",
        orderNumber: req.body.orderNumber || "",
        panelUrl: "https://panel.ceea.org.pl",
        date: req.body.date || "",
        location: req.body.location || "",
        agendaUrl: req.body.agendaUrl || "",
        subject,
        preheader,
      };

      const rendered = renderTemplate(templateKey, data, bodyHtml);

      await queue.enqueue({
        recipientEmail: user.email,
        recipientName: `${user.name || ""} ${user.surname || ""}`.trim(),
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        courseId: courseId === "all" ? null : parseInt(courseId),
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
