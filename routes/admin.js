const express = require("express");
const router = express.Router();
const supabase = require("../config/supabase");
const { ADMIN_PREFIX, requireAdmin, adminOnly } = require("../middleware/auth");
const { fetchAllCourses, fetchCourseById } = require("../config/datocms");
const { grantAccess } = require("../services/access");
const adminModules = require("../config/admin-modules");
const adminIcon = require("../config/admin-icons");

const { renderTemplate, getTemplateDefaults } = require("../services/email");
const EmailQueue = require("../services/emailQueue");

router.use((req, res, next) => {
  res.locals.adminPrefix = ADMIN_PREFIX;
  res.locals.adminModules = adminModules;
  res.locals.adminIcon = adminIcon;

  const token = req.cookies?.adminToken;
  const session = req.app.locals.sessions.get(token);
  if (session && session.expires > Date.now()) {
    res.locals.adminUser = req.app.locals.admins.get(session.email);
  } else {
    res.locals.adminUser = null;
  }
  
  next();
});

// ===== PULPIT (lub login, gdy niezalogowany) =====
router.get("/", adminOnly, async (req, res) => {
  const token = req.cookies?.adminToken;
  const logged = token && req.app.locals.sessions.has(token);
  if (!logged) {
    return res.render("admin-login", {
      error: null,
      year: new Date().getFullYear(),
      adminPrefix: ADMIN_PREFIX,
    });
  }

  const stats = { courses: 0, materials: 0, enrollments: 0, users: 0 };
  const visits = { today: 0, week: 0, month: 0 };
  const series = [];
  let topPages = [];

  try {
    const monthAgo = new Date(Date.now() - 30 * 864e5);
    const [u, e, m, courses, viewsRes] = await Promise.all([
      supabase.from("users").select("id", { count: "exact", head: true }),
      supabase.from("enrollments").select("id", { count: "exact", head: true }),
      supabase.from("materials").select("id", { count: "exact", head: true }),
      fetchAllCourses().catch(() => []),
      supabase.from("page_views").select("path, created_at").gte("created_at", monthAgo.toISOString()),
    ]);

    stats.users = u.count || 0;
    stats.enrollments = e.count || 0;
    stats.materials = m.count || 0;
    stats.courses = courses.length;

    const views = viewsRes.data || [];
    const now = new Date();
    const startToday = new Date(now); startToday.setHours(0, 0, 0, 0);
    const weekAgo = new Date(now.getTime() - 7 * 864e5);

    visits.month = views.length;
    visits.week = views.filter((v) => new Date(v.created_at) >= weekAgo).length;
    visits.today = views.filter((v) => new Date(v.created_at) >= startToday).length;

    for (let i = 13; i >= 0; i--) {
      const dayStart = new Date(now);
      dayStart.setHours(0, 0, 0, 0);
      dayStart.setDate(dayStart.getDate() - i);
      const dayEnd = new Date(dayStart.getTime() + 864e5);
      series.push({
        label: `${dayStart.getDate()}.${dayStart.getMonth() + 1}`,
        count: views.filter((v) => {
          const t = new Date(v.created_at);
          return t >= dayStart && t < dayEnd;
        }).length,
      });
    }

    const byPath = {};
    views.forEach((v) => { byPath[v.path] = (byPath[v.path] || 0) + 1; });
    topPages = Object.entries(byPath)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([path, count]) => ({ path, count }));
  } catch (err) {
    console.error("pulpit:", err);
  }

  res.render("admin-dashboard", { isAdmin: true, active: "home", stats, visits, series, topPages });
});

// ===== USTAWIENIA ADMINA =====
router.get("/ustawienia", adminOnly, requireAdmin, async (req, res) => {
  const status = { supabase: false, datocms: false, cloudinary: false, mailer: false };

  try {
    const [u, e, m] = await Promise.all([
      supabase.from("users").select("id", { count: "exact", head: true }),
      supabase.from("enrollments").select("id", { count: "exact", head: true }),
      supabase.from("materials").select("id", { count: "exact", head: true }),
    ]);
    if (!u.error && !e.error && !m.error) status.supabase = true;
  } catch (err) {
    console.error("ustawienia/supabase:", err.message);
  }

  try {
    await fetchAllCourses();
    status.datocms = true;
  } catch (err) {
    console.error("ustawienia/datocms:", err.message);
  }

  status.cloudinary = !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_UPLOAD_PRESET);
  status.mailer = !!(process.env.MAILERSEND_API_KEY || process.env.MAILERSEND_TOKEN);

  res.render("admin-ustawienia", { isAdmin: true, active: "ustawienia", status });
});

router.get("/ustawienia/eksport", adminOnly, requireAdmin, async (req, res) => {
  try {
    const [{ data: users }, { data: enrollments }, { data: materials }] = await Promise.all([
      supabase.from("users").select("id, email, name, surname, phone, created_at"),
      supabase.from("enrollments").select("*"),
      supabase.from("materials").select("*"),
    ]);
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="ceea-backup-${stamp}.json"`);
    res.send(JSON.stringify({ exportedAt: new Date().toISOString(), users, enrollments, materials }, null, 2));
  } catch (err) {
    console.error("ustawienia/eksport:", err);
    res.redirect(ADMIN_PREFIX + "/ustawienia");
  }
});

// ===== WYLOGOWANIE =====
router.get("/wyloguj", adminOnly, (req, res) => {
  const token =
    req.headers.authorization?.replace("Bearer ", "") ||
    req.cookies?.adminToken;
  req.app.locals.sessions.delete(token);
  req.session.isAdmin = false;
  res.redirect(ADMIN_PREFIX + "/");
});

// ===== KURSY =====
router.get("/kursy", adminOnly, requireAdmin, async (req, res) => {
  try {
    const courses = await fetchAllCourses();
    const ids = courses.map((c) => c.id);

    const [{ data: materials }, { data: enrollments }] = await Promise.all([
      supabase.from("materials").select("course_id").in("course_id", ids),
      supabase.from("enrollments").select("course_id").in("course_id", ids),
    ]);
    const count = (arr, id) =>
      (arr || []).filter((x) => x.course_id === id).length;

    res.render("admin-kursy", {
      isAdmin: true,
      adminPrefix: ADMIN_PREFIX,
      courses: courses.map((c) => ({
        ...c,
        materialsCount: count(materials, c.id),
        participantsCount: count(enrollments, c.id),
      })),
    });
  } catch (err) {
    console.error("Błąd serwera (kursy):", err);
    res.status(500).render("error", { message: "Błąd pobierania kursów" });
  }
});

// ===== MATERIALY =====
router.get("/kursy/:id/materials", adminOnly, requireAdmin, async (req, res) => {
  try {
    const course = await fetchCourseById(req.params.id);
    if (!course) return res.redirect(ADMIN_PREFIX + "/kursy");

    const { data: materials, error: materialsError } = await supabase
      .from("materials").select("*").eq("course_id", req.params.id).order("order_num");

    if (materialsError) console.error("Błąd pobierania materiałów:", materialsError);

    res.render("admin-materials", {
      isAdmin: true,
      adminPrefix: ADMIN_PREFIX,
      course,
      materials: materials || [],
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      uploadPreset: process.env.CLOUDINARY_UPLOAD_PRESET,
    });
  } catch (err) {
    console.error("Błąd serwera (materiały):", err);
    res.redirect(ADMIN_PREFIX + "/kursy");
  }
});

router.post("/kursy/:id/materials", adminOnly, requireAdmin, async (req, res) => {
  const { title, type, url } = req.body;
  try {
    if (!title || !url) {
      return res.redirect(`${ADMIN_PREFIX}/kursy/${req.params.id}/materials`);
    }

    const { data: last } = await supabase
      .from("materials")
      .select("order_num")
      .eq("course_id", req.params.id)
      .order("order_num", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { error } = await supabase.from("materials").insert([{
      course_id: req.params.id,
      title,
      type: type || "link",
      url,
      order_num: (last?.order_num || 0) + 1,
    }]);
    if (error) console.error("Błąd dodawania materiału:", error);
    res.redirect(`${ADMIN_PREFIX}/kursy/${req.params.id}/materials`);
  } catch (err) {
    console.error("Błąd serwera (dodawanie materiału):", err);
    res.redirect(`${ADMIN_PREFIX}/kursy/${req.params.id}/materials`);
  }
});

router.post("/materials/:id/delete", adminOnly, requireAdmin, async (req, res) => {
  try {
    const { data: material, error: fetchError } = await supabase
      .from("materials")
      .select("course_id")
      .eq("id", req.params.id)
      .single();

    if (fetchError) {
      console.error("Błąd pobierania materiału:", fetchError);
      return res.redirect(ADMIN_PREFIX + "/kursy");
    }

    const { error: deleteError } = await supabase
      .from("materials")
      .delete()
      .eq("id", req.params.id);

    if (deleteError) console.error("Błąd usuwania materiału:", deleteError);
    res.redirect(`${ADMIN_PREFIX}/kursy/${material.course_id}/materials`);
  } catch (err) {
    console.error("Błąd serwera (usuwanie materiału):", err);
    res.redirect(ADMIN_PREFIX + "/kursy");
  }
});

// ===== UCZESTNICY =====
router.get("/kursy/:id/uczestnicy", adminOnly, requireAdmin, async (req, res) => {
  try {
    const course = await fetchCourseById(req.params.id);
    if (!course) return res.redirect(ADMIN_PREFIX + "/kursy");

    const { data: enrollments, error: enrollmentsError } = await supabase
      .from("enrollments")
      .select("id, status, created_at, users(email, name, surname)")
      .eq("course_id", req.params.id);

    if (enrollmentsError) console.error("Błąd pobierania uczestników:", enrollmentsError);

    const participants = (enrollments || []).map((e) => ({
      id: e.id,
      status: e.status,
      created_at: e.created_at,
      email: e.users?.email || "",
      name: e.users?.name || "",
      surname: e.users?.surname || "",
    }));

    res.render("admin-uczestnicy", {
      isAdmin: true,
      adminPrefix: ADMIN_PREFIX,
      course,
      enrollments: participants,
    });
  } catch (err) {
    console.error("Błąd serwera (uczestnicy):", err);
    res.redirect(ADMIN_PREFIX + "/kursy");
  }
});

router.post("/kursy/:id/uczestnicy", adminOnly, requireAdmin, async (req, res) => {
  try {
    await grantAccess({ email: req.body.email, courseId: req.params.id });
  } catch (err) {
    console.error("Błąd dodawania uczestnika:", err);
  }
  res.redirect(`${ADMIN_PREFIX}/kursy/${req.params.id}/uczestnicy`);
});

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
router.post("/maile/template-data", adminOnly, requireAdmin, async (req, res) => {
  try {
    const { templateKey, courseId, courseName, courseDate } = req.body;

    const data = {
      courseTitle: courseName || "Kurs CEEA",
      courseNumber: courseId && courseId !== "all" && courseId !== "test" ? courseId : "6",
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
});

// ── API: Podgląd maila ──
router.post("/maile/preview", adminOnly, requireAdmin, async (req, res) => {
  try {
    const { templateKey, courseTitle, firstName, bodyHtml, subject, preheader } = req.body;

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
    res.json({ ok: true, html: rendered.html, text: rendered.text, subject: rendered.subject });
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
      return res.redirect(`${ADMIN_PREFIX}/maile?error=${encodeURIComponent("Brak odbiorców dla wybranych kryteriów")}`);
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
    res.redirect(`${ADMIN_PREFIX}/maile?error=${encodeURIComponent(err.message)}`);
  }
});

// ── API: Status kolejki (dla AJAX) ──
router.get("/maile/stats", adminOnly, requireAdmin, async (req, res) => {
  try {
    const queue = req.app.get("emailQueue");
    if (!queue) return res.json({ pending: 0, sentToday: 0, failed: 0, limit: 50 });
    res.json(await queue.getStats());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;