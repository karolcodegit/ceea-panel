const express = require("express");
const router = express.Router();
const supabase = require("../config/supabase");
const { ADMIN_PREFIX, requireAdmin, adminOnly } = require("../middleware/auth");
const { grantAccess } = require("../services/access");

// ═══════════════════════════════════════════════════════════════
// ===== KURSY — pełny moduł (lista + definicja + materiały + uczestnicy)
// Źródło: tabela courses (Supabase). DatoCMS nieużywane.
// ═══════════════════════════════════════════════════════════════

// Normalizacja kursu do formatu, który oczekują widoki materials/uczestnicy
// (dawniej obiekt DatoCMS: id / nameCourse / date / image.url / available)
function toViewCourse(c) {
  if (!c) return null;
  return {
    id: c.course_id,
    nameCourse: c.title,
    date: c.date_label || c.start_date || "",
    available: !!c.available,
    image: c.image_url ? { url: c.image_url } : null,
    _raw: c,
  };
}

// ── LISTA + FILTRY ──
router.get("/kursy", adminOnly, requireAdmin, async (req, res) => {
  try {
    const filter = req.query.filter || "all"; // all | active | archive

    let query = supabase.from("courses").select("*");
    if (filter === "active") query = query.eq("available", true);
    if (filter === "archive") query = query.eq("is_archive", true);
    const { data: courses, error } = await query.order("start_date", {
      ascending: false,
      nullsFirst: false,
    });
    if (error) throw error;

    const ids = (courses || []).map((c) => c.course_id);
    let materials = [],
      enrollments = [];
    if (ids.length) {
      [{ data: materials }, { data: enrollments }] = await Promise.all([
        supabase.from("materials").select("course_id").in("course_id", ids),
        supabase.from("enrollments").select("course_id").in("course_id", ids),
      ]);
    }
    const count = (arr, id) =>
      (arr || []).filter((x) => x.course_id === id).length;

    res.render("admin-kursy", {
      isAdmin: true,
      active: "kursy",
      adminPrefix: ADMIN_PREFIX,
      courses: (courses || []).map((c) => ({
        ...toViewCourse(c),
        materialsCount: count(materials, c.course_id),
        participantsCount: count(enrollments, c.course_id),
      })),
      filter,
      query: req.query,
    });
  } catch (err) {
    console.error("Błąd serwera (kursy):", err);
    res.status(500).render("error", { message: "Błąd pobierania kursów" });
  }
});

// ── NOWY / EDYCJA — formularz 6 sekcji ──
router.get("/kursy/nowy", adminOnly, requireAdmin, (req, res) => {
  res.render("admin-kurs-form", {
    isAdmin: true,
    active: "kursy",
    course: null,
    query: req.query,
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    uploadPreset: process.env.CLOUDINARY_UPLOAD_PRESET,
  });
});

router.get("/kursy/:id/edytuj", adminOnly, requireAdmin, async (req, res) => {
  try {
    const { data: course, error } = await supabase
      .from("courses")
      .select("*")
      .eq("course_id", req.params.id)
      .maybeSingle();
    if (error) throw error;
    if (!course) return res.redirect(ADMIN_PREFIX + "/kursy");

    res.render("admin-kurs-form", {
      isAdmin: true,
      active: "kursy",
      course,
      query: req.query,
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      uploadPreset: process.env.CLOUDINARY_UPLOAD_PRESET,
    });
  } catch (err) {
    console.error("[GET /kursy/:id/edytuj]", err);
    res.redirect(ADMIN_PREFIX + "/kursy");
  }
});

// ── ZAPIS (create / update) ──
router.post("/kursy/zapis", adminOnly, requireAdmin, async (req, res) => {
  try {
    const b = req.body;
    const clean = (v) => (v || "").toString().trim() || null;
    const cleanNum = (v) =>
      v === "" || v == null ? null : Number(String(v).replace(",", "."));

    const rawProgram = Array.isArray(b.program)
      ? b.program
      : b.program
      ? [b.program]
      : [];
    const program = rawProgram
      .map((d) => {
        let ev = d?.events;
        if (typeof ev === "string") ev = ev.split("\n");
        const events = (Array.isArray(ev) ? ev : String(ev || "").split("\n"))
          .map((e) =>
            (e && typeof e === "object" ? e.event ?? "" : String(e ?? ""))
              .toString()
              .trim()
          )
          .filter(Boolean);
        return { date: clean(d?.date), events };
      })
      .filter((d) => d.date || d.events.length)
      .slice(0, 3);

    const rawPrices = Array.isArray(b.price_option)
      ? b.price_option
      : b.price_option
      ? [b.price_option]
      : [];
    const info_prices = rawPrices
      .map((p) => ({ price: cleanNum(p?.price), room: clean(p?.room) }))
      .filter((p) => p.price != null || p.room)
      .slice(0, 6);

    // Dodatkowe opcje (posiłki / warsztaty / dodatki)
    const rawMeals = Array.isArray(b.meal_option)
      ? b.meal_option
      : b.meal_option
      ? [b.meal_option]
      : [];
    const meal_options = rawMeals
      .map((m) => ({
        label: clean(m?.label),
        price: cleanNum(m?.price) ?? 0,
        available: m?.available === "1",
      }))
      .filter((m) => m.label)
      .slice(0, 10);

    // Dania
    const rawDishes = Array.isArray(b.dish) ? b.dish : b.dish ? [b.dish] : [];
    const dishes = rawDishes
      .map((d) => clean(d?.name))
      .filter(Boolean)
      .slice(0, 10)
      .map((name) => ({ name }));

    const record = {
      title: clean(b.title),
      course_number:
        b.course_number !== "" && b.course_number != null
          ? parseInt(b.course_number, 10)
          : null,
      date_label: clean(b.date_label),
      start_date: clean(b.start_date),
      end_date: clean(b.end_date),
      description: clean(b.description),
      home_description: clean(b.home_description),
      image_url: clean(b.image_url),
      price: cleanNum(b.price),
      points:
        b.points !== "" && b.points != null ? parseInt(b.points, 10) : null,
      language: b.language === "en" ? "en" : "pl",
      available: b.available === "1",
      is_next: b.is_next === "1",
      is_archive: b.is_archive === "1",
      is_new: b.is_new === "1",
      is_online: b.is_online === "1",
      is_active: b.is_active === "1",
      program,
      info_image_url: clean(b.info_image_url),
      info_description: clean(b.info_description),
      info_password: clean(b.info_password),
      info_email: clean(b.info_email),
      info_phone: clean(b.info_phone),
      info_prices,
      info_additional: clean(b.info_additional),
      participation_condition: clean(b.participation_condition),
      hotel_image_url: clean(b.hotel_image_url),
      hotel_extra: clean(b.hotel_extra),
      meal_options,
      dishes,
    };

    if (!record.title) {
      return res.redirect(
        `${ADMIN_PREFIX}/kursy/nowy?error=${encodeURIComponent(
          "Nazwa kursu jest wymagana"
        )}`
      );
    }

    if (b.course_id) {
      const { error } = await supabase
        .from("courses")
        .update(record)
        .eq("course_id", b.course_id);
      if (error) throw error;
      return res.redirect(
        `${ADMIN_PREFIX}/kursy?success=${encodeURIComponent("Zapisano kurs")}`
      );
    }

    const course_id = clean(b.new_course_id);
    if (!course_id) {
      return res.redirect(
        `${ADMIN_PREFIX}/kursy/nowy?error=${encodeURIComponent(
          "Identyfikator kursu jest wymagany"
        )}`
      );
    }
    const { error } = await supabase
      .from("courses")
      .insert({ ...record, course_id });
    if (error) throw error;
    res.redirect(
      `${ADMIN_PREFIX}/kursy?success=${encodeURIComponent("Dodano kurs")}`
    );
  } catch (err) {
    console.error("[POST /kursy/zapis]", err);
    res.redirect(
      `${ADMIN_PREFIX}/kursy?error=${encodeURIComponent(err.message)}`
    );
  }
});

// ── USUŃ ──
router.post("/kursy/:id/usun", adminOnly, requireAdmin, async (req, res) => {
  try {
    const { error } = await supabase
      .from("courses")
      .delete()
      .eq("course_id", req.params.id);
    if (error) throw error;
    res.redirect(
      `${ADMIN_PREFIX}/kursy?success=${encodeURIComponent("Usunięto kurs")}`
    );
  } catch (err) {
    console.error("[POST /kursy/:id/usun]", err);
    res.redirect(
      `${ADMIN_PREFIX}/kursy?error=${encodeURIComponent(err.message)}`
    );
  }
});

// ── MATERIALY (widok bez zmian — kurs znormalizowany) ──
router.get(
  "/kursy/:id/materials",
  adminOnly,
  requireAdmin,
  async (req, res) => {
    try {
      const { data: row } = await supabase
        .from("courses")
        .select("*")
        .eq("course_id", req.params.id)
        .maybeSingle();
      const course = toViewCourse(row);
      if (!course) return res.redirect(ADMIN_PREFIX + "/kursy");

      const { data: materials, error: materialsError } = await supabase
        .from("materials")
        .select("*")
        .eq("course_id", req.params.id)
        .order("order_num");
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
  }
);

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

// ── UCZESTNICY (widok bez zmian — kurs znormalizowany) ──
router.get(
  "/kursy/:id/uczestnicy",
  adminOnly,
  requireAdmin,
  async (req, res) => {
    try {
      const { data: row } = await supabase
        .from("courses")
        .select("*")
        .eq("course_id", req.params.id)
        .maybeSingle();
      const course = toViewCourse(row);
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

module.exports = router;
