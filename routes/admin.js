const express = require("express");
const router = express.Router();
const supabase = require("../config/supabase");
const { ADMIN_PREFIX, requireAdmin, adminOnly } = require("../middleware/auth");
const { fetchAllCourses, fetchCourseById } = require("../config/datocms");
const { grantAccess } = require("../services/access");
const adminModules = require("../config/admin-modules");
const adminIcon = require("../config/admin-icons");


router.use((req, res, next) => {
  res.locals.adminPrefix = ADMIN_PREFIX;
  res.locals.adminModules = adminModules;
  res.locals.adminIcon = adminIcon;
  next();
});

// Admin login
router.get("/", adminOnly, (req, res) => {
  const token = req.cookies?.adminToken;
  const logged = token && req.app.locals.sessions.has(token);
  if (!logged) {
    return res.render("admin-login", {
      error: null,
      year: new Date().getFullYear(),
      adminPrefix: ADMIN_PREFIX,
    });res.locals
  }
  res.render("admin-dashboard", { isAdmin: true, active: "home" });
});

router.get("/ustawienia", adminOnly, requireAdmin, async (req, res) => {
  const status = { supabase: false, datocms: false, cloudinary: false, mailer: false };
  const stats = { courses: 0, materials: 0, enrollments: 0, users: 0 };

  // Supabase + statystyki (prawdziwe zapytanie = prawdziwy status)
  try {
    const [u, e, m] = await Promise.all([
      supabase.from("users").select("id", { count: "exact", head: true }),
      supabase.from("enrollments").select("id", { count: "exact", head: true }),
      supabase.from("materials").select("id", { count: "exact", head: true }),
    ]);
    if (!u.error && !e.error && !m.error) status.supabase = true;
    stats.users = u.count || 0;
    stats.enrollments = e.count || 0;
    stats.materials = m.count || 0;
  } catch (err) {
    console.error("ustawienia/supabase:", err.message);
  }

  // DatoCMS (jeśli kursy się pobierają — integracja działa)
  try {
    const courses = await fetchAllCourses();
    status.datocms = true;
    stats.courses = courses.length;
  } catch (err) {
    console.error("ustawienia/datocms:", err.message);
  }

  status.cloudinary = !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_UPLOAD_PRESET);
  status.mailer = !!(process.env.MAILERSEND_API_KEY || process.env.MAILERSEND_TOKEN);

  res.render("admin-ustawienia", { isAdmin: true, active: "ustawienia", status, stats });
});

// Kopia zapasowa danych (RODO) — bez haseł
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


router.get("/wyloguj", adminOnly, (req, res) => {
  const token =
    req.headers.authorization?.replace("Bearer ", "") ||
    req.cookies?.adminToken;
  req.app.locals.sessions.delete(token);
  req.session.isAdmin = false;
  res.redirect(ADMIN_PREFIX + "/");
});

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

router.get(
  "/kursy/:id/materials",
  adminOnly,
  requireAdmin,
  async (req, res) => {
    try {
      const course = await fetchCourseById(req.params.id);
      if (!course) return res.redirect(ADMIN_PREFIX + "/kursy");

      const { data: materials, error: materialsError } = await supabase
        .from("materials").select("*").eq("course_id", req.params.id).order("order_num");

      if (materialsError)
        console.error("Błąd pobierania materiałów:", materialsError);

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
  }
);

router.post(
  "/kursy/:id/materials",
  adminOnly,
  requireAdmin,
  async (req, res) => {
    const { title, type, url, order_num } = req.body;
    try {
      const { error } = await supabase
        .from("materials")
        .insert([
          {
            course_id: req.params.id,
            title,
            type,
            url,
            order_num: parseInt(order_num) || 1,
          },
        ]);
      if (error) console.error("Błąd dodawania materiału:", error);
      res.redirect(`${ADMIN_PREFIX}/kursy/${req.params.id}/materials`);
    } catch (err) {
      console.error("Błąd serwera (dodawanie materiału):", err);
      res.redirect(`${ADMIN_PREFIX}/kursy/${req.params.id}/materials`);
    }
  }
);

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

    const { error } = await supabase.from("materials").insert([
      {
        course_id: req.params.id,
        title,
        type: type || "link",
        url,
        order_num: (last?.order_num || 0) + 1,
      },
    ]);
    if (error) console.error("Błąd dodawania materiału:", error);
    res.redirect(`${ADMIN_PREFIX}/kursy/${req.params.id}/materials`);
  } catch (err) {
    console.error("Błąd serwera (dodawanie materiału):", err);
    res.redirect(`${ADMIN_PREFIX}/kursy/${req.params.id}/materials`);
  }
});

router.post(
  "/materials/:id/delete",
  adminOnly,
  requireAdmin,
  async (req, res) => {
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
  }
);

router.get(
  "/kursy/:id/uczestnicy",
  adminOnly,
  requireAdmin,
  async (req, res) => {
    try {
      const course = await fetchCourseById(req.params.id);
      if (!course) return res.redirect(ADMIN_PREFIX + "/kursy");

      const { data: enrollments, error: enrollmentsError } = await supabase
        .from("enrollments")
        .select("id, status, created_at, users(email, name, surname)")
        .eq("course_id", req.params.id);

      if (enrollmentsError)
        console.error("Błąd pobierania uczestników:", enrollmentsError);

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
  }
);

router.post(
  "/kursy/:id/uczestnicy",
  adminOnly,
  requireAdmin,
  async (req, res) => {
    try {
      await grantAccess({ email: req.body.email, courseId: req.params.id });
    } catch (err) {
      console.error("Błąd dodawania uczestnika:", err);
    }
    res.redirect(`${ADMIN_PREFIX}/kursy/${req.params.id}/uczestnicy`);
  }
);


router.get("/maile", adminOnly, requireAdmin, async (req, res) => {
  const courses = await fetchAllCourses();
  res.render("admin-maile", { isAdmin: true, active: "maile", courses, sent: null });
});


module.exports = router;
