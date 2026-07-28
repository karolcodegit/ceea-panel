const express = require("express");
const router = express.Router();
const supabase = require("../config/supabase");
const { ADMIN_PREFIX, requireAdmin, adminOnly } = require("../middleware/auth");
const { fetchAllCourses, fetchCourseById } = require("../config/datocms");


// Admin login
router.get("/", adminOnly, (req, res) => {
  res.render("admin-login", {
    error: null,
    year: new Date().getFullYear(),
    adminPrefix: ADMIN_PREFIX,
  });
});

router.get("/wyloguj", adminOnly, (req, res) => {
  const token =
    req.headers.authorization?.replace("Bearer ", "") ||
    req.cookies?.adminToken;
  req.app.locals.sessions.delete(token);
  req.session.isAdmin = false;
  res.redirect(ADMIN_PREFIX + "/");
});

const course = await fetchCourseById(req.params.id);
if (!course) return res.redirect(ADMIN_PREFIX + "/kursy");

router.get("/kursy", adminOnly, requireAdmin, async (req, res) => {
    try {
      const courses = await fetchAllCourses();
      const ids = courses.map((c) => c.id);
  
      const [{ data: materials }, { data: enrollments }] = await Promise.all([
        supabase.from("materials").select("course_id").in("course_id", ids),
        supabase.from("enrollments").select("course_id").in("course_id", ids),
      ]);
      const count = (arr, id) => (arr || []).filter((x) => x.course_id === id).length;
  
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

router.get("/kursy/:id/materials", adminOnly, requireAdmin, async (req, res) => {
  try {
    const { data: course, error: courseError } = await supabase
      .from("courses").select("*").eq("id", req.params.id).single();

    if (courseError) {
      console.error("Błąd pobierania kursu:", courseError);
      return res.redirect(ADMIN_PREFIX + "/kursy");
    }

    const { data: materials, error: materialsError } = await supabase
      .from("materials").select("*").eq("course_id", req.params.id).order("order");

    if (materialsError) console.error("Błąd pobierania materiałów:", materialsError);

    res.render("admin-materials", { isAdmin: true, course, materials: materials || [] });
  } catch (err) {
    console.error("Błąd serwera (materiały):", err);
    res.redirect(ADMIN_PREFIX + "/kursy");
  }
});



router.post("/kursy/:id/materials", adminOnly, requireAdmin, async (req, res) => {
  const { title, type, url, order } = req.body;
  try {
    const { error } = await supabase.from("materials").insert([
      { course_id: req.params.id, title, type, url, order: parseInt(order) || 1 },
    ]);
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
      .from("materials").select("course_id").eq("id", req.params.id).single();

    if (fetchError) {
      console.error("Błąd pobierania materiału:", fetchError);
      return res.redirect(ADMIN_PREFIX + "/kursy");
    }

    const { error: deleteError } = await supabase
      .from("materials").delete().eq("id", req.params.id);

    if (deleteError) console.error("Błąd usuwania materiału:", deleteError);

    res.redirect(`${ADMIN_PREFIX}/kursy/${material.course_id}/materials`);
  } catch (err) {
    console.error("Błąd serwera (usuwanie materiału):", err);
    res.redirect(ADMIN_PREFIX + "/kursy");
  }
});

router.get("/kursy/:id/uczestnicy", adminOnly, requireAdmin, async (req, res) => {
  try {
    const { data: course, error: courseError } = await supabase
      .from("courses").select("*").eq("id", req.params.id).single();

    if (courseError) {
      console.error("Błąd pobierania kursu:", courseError);
      return res.redirect(ADMIN_PREFIX + "/kursy");
    }

    const { data: enrollments, error: enrollmentsError } = await supabase
      .from("enrollments").select("*").eq("course_id", req.params.id);

    if (enrollmentsError) console.error("Błąd pobierania uczestników:", enrollmentsError);

    res.render("admin-uczestnicy", { isAdmin: true, course, enrollments: enrollments || [] });
  } catch (err) {
    console.error("Błąd serwera (uczestnicy):", err);
    res.redirect(ADMIN_PREFIX + "/kursy");
  }
});

router.post("/kursy/:id/uczestnicy", adminOnly, requireAdmin, async (req, res) => {
  const { email } = req.body;
  try {
    const { error } = await supabase.from("enrollments").insert([
      { course_id: req.params.id, email, status: "active" },
    ]);
    if (error) console.error("Błąd dodawania uczestnika:", error);
    res.redirect(`${ADMIN_PREFIX}/kursy/${req.params.id}/uczestnicy`);
  } catch (err) {
    console.error("Błąd serwera (dodawanie uczestnika):", err);
    res.redirect(`${ADMIN_PREFIX}/kursy/${req.params.id}/uczestnicy`);
  }
});

module.exports = router;