const express = require("express");
const router = express.Router();
const supabase = require("../config/supabase");
const { ADMIN_PREFIX, requireAdmin, adminOnly } = require("../middleware/auth");
const { fetchAllCourses } = require("../config/datocms");
const adminModules = require("../config/admin-modules");
const adminIcon = require("../config/admin-icons");
const companyRoutes = require("./firma");

// ── Kontekst wspólny dla całego panelu (moduły montowane NIŻEJ też go dostają,
//    bo przechodzą przez ten middleware przed własnymi route'ami) ──
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
      supabase
        .from("page_views")
        .select("path, created_at")
        .gte("created_at", monthAgo.toISOString()),
    ]);

    stats.users = u.count || 0;
    stats.enrollments = e.count || 0;
    stats.materials = m.count || 0;
    stats.courses = courses.length;

    const views = viewsRes.data || [];
    const now = new Date();
    const startToday = new Date(now);
    startToday.setHours(0, 0, 0, 0);
    const weekAgo = new Date(now.getTime() - 7 * 864e5);

    visits.month = views.length;
    visits.week = views.filter((v) => new Date(v.created_at) >= weekAgo).length;
    visits.today = views.filter(
      (v) => new Date(v.created_at) >= startToday
    ).length;

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
    views.forEach((v) => {
      byPath[v.path] = (byPath[v.path] || 0) + 1;
    });
    topPages = Object.entries(byPath)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([path, count]) => ({ path, count }));
  } catch (err) {
    console.error("pulpit:", err);
  }

  res.render("admin-dashboard", {
    isAdmin: true,
    active: "home",
    stats,
    visits,
    series,
    topPages,
  });
});

// ===== USTAWIENIA ADMINA =====
router.get("/ustawienia", adminOnly, requireAdmin, async (req, res) => {
  const status = {
    supabase: false,
    datocms: false,
    cloudinary: false,
    mailer: false,
  };

  let company = null;
     try {
       const { data: companyRow } = await supabase
         .from("company_settings")
         .select("*")
         .eq("id", 1)
         .maybeSingle();
       company = companyRow;
     } catch (e) { console.error("ustawienia/firma:", e.message); }

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

  status.cloudinary = !!(
    process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_UPLOAD_PRESET
  );
  status.mailer = !!(
    process.env.MAILERSEND_API_KEY || process.env.MAILERSEND_TOKEN
  );

  res.render("admin-ustawienia", {
    isAdmin: true,
    active: "ustawienia",
    status,
    company,
    query: req.query,
  });
});

router.get("/ustawienia/eksport", adminOnly, requireAdmin, async (req, res) => {
  try {
    const [{ data: users }, { data: enrollments }, { data: materials }] =
      await Promise.all([
        supabase
          .from("users")
          .select("id, email, name, surname, phone, created_at"),
        supabase.from("enrollments").select("*"),
        supabase.from("materials").select("*"),
      ]);
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="ceea-backup-${stamp}.json"`
    );
    res.send(
      JSON.stringify(
        { exportedAt: new Date().toISOString(), users, enrollments, materials },
        null,
        2
      )
    );
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

// ═══════════════════════════════════════════════════════════════
// ===== MODUŁY (każdy własny plik w routes/) =====
// ═══════════════════════════════════════════════════════════════
router.use("/", require("./kursy"));          // kursy, materiały, uczestnicy
router.use("/", require("./maile"));          // moduł mailowy + API
router.use("/", require("./platnosci"));      // płatności, faktury PDF, mark-paid
router.use("/", require("./admini"));         // administratorzy + 2FA
router.use("/", require("./notifications"));  // powiadomienia API
router.use("/", require("./faktury"));        // kto potrzebuje faktury (Twój plik)
router.use("/", require("./ksiazki"));        // lista ksiązek
router.use("/", require("./sponsorzy"));      // wszyscy sponsorzy
router.use("/", require("./faq"));            // pytania i odpowiedzi
router.use("/", require("./pracownicy"));     // Pracownicy zarządzający organizacją
router.use("/", require("./firma"));          // Dane firmy CEEA Poznań
router.use("/", require("./media"));          // Galeria z Cloudinary


module.exports = router;
