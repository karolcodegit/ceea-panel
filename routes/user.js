const express = require("express");
const router = express.Router();
const MarkdownIt = require("markdown-it");
const supabase = require("../config/supabase");
const { userOnly, requireAuth } = require("../middleware/auth");
const { fetchCompany, fetchHelpPage, fetchActiveCourse } = require("../config/datocms");
const { ICONS } = require("../config/icons");
const { fetchAllCourses, getYearFromDate } = require("../config/datocms");


const md = new MarkdownIt({ html: false, linkify: true, breaks: true });
const MAIN_SITE_URL = "https://ceea.org.pl";
const CALLOUT_ICONS = { info: "ℹ️", warning: "⚠️", danger: "🚨" };
const DEFAULT_ICON = `<svg class="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`;

function renderAnswer(q) {
  const answerHtml = md.render(q.answer || "");
  const c = q.callout;
  if (!c) return answerHtml;
  const icon = CALLOUT_ICONS[c.kind] || CALLOUT_ICONS.info;
  const html = md.renderInline(c.content || "");
  return answerHtml + `<div class="callout callout-${c.kind}"><span>${icon}</span><div>${html}</div></div>`;
}

// ===== LOGOWANIE =====
router.get("/", userOnly, async (req, res) => {
  if (req.session.user) return res.redirect("/kursy");
  const course = await fetchActiveCourse();
  res.render("login", {
    title: "Logowanie — CEEA",
    error: null,
    message: null,
    registrationUrl: course
      ? `${MAIN_SITE_URL}/kursy/${course.year}/${course.slug}/rejestracja`
      : null,
  });
});

// ===== PANEL UCZESTNIKA =====
// ===== PANEL UCZESTNIKA =====
router.get("/kursy", userOnly, requireAuth, async (req, res) => {
  try {
    // 1. użytkownik po emailu z sesji
    const { data: user } = await supabase
      .from("users").select("id, name, email")
      .eq("email", req.session.user.email).maybeSingle();

    // 2. jego dostępy
    const { data: enrollments } = user
      ? await supabase
          .from("enrollments").select("course_id")
          .eq("user_id", user.id).eq("status", "active")
      : { data: [] };

    const ids = (enrollments || []).map((e) => e.course_id);

    const [datoCourses, { data: materials }] = await Promise.all([
      fetchAllCourses(),
      ids.length
        ? supabase.from("materials").select("*").in("course_id", ids).order("order")
        : Promise.resolve({ data: [] }),
    ]);

    const myCourses = datoCourses
      .filter((c) => ids.includes(c.id))
      .map((c) => ({
        ...c,
        year: getYearFromDate(c.date),
        materials: (materials || []).filter((m) => m.course_id === c.id),
      }));

    res.render("dashboard", {
      title: "Moje kursy — CEEA",
      user: req.session.user,
      active: myCourses.filter((c) => c.available),
      archive: myCourses.filter((c) => !c.available),
    });
  } catch (err) {
    console.error("Błąd serwera (dashboard):", err);
    res.render("dashboard", { title: "Moje kursy — CEEA", user: req.session.user, active: [], archive: [] });
  }
});

router.get("/logout", userOnly, (req, res) => {
  req.session.destroy();
  res.redirect("/");
});

// ===== STRONA POMOCY =====
router.get("/pomoc", async (req, res) => {
  try {
    const [company, help] = await Promise.all([fetchCompany(), fetchHelpPage()]);
    const questionsByCategory = {};
    (help?.questions || []).forEach((q) => {
      const catId = q.category?.id || "uncategorized";
      (questionsByCategory[catId] ||= []).push({ question: q.question, answer: renderAnswer(q) });
    });

    const categories = (help?.categories || []).map((cat) => ({
      id: cat.slug || cat.id,
      slug: cat.slug || cat.id,
      title: cat.title,
      description: cat.description,
      icon: ICONS[cat.icon] || DEFAULT_ICON,
      questions: questionsByCategory[cat.id] || [],
    }));

    res.render("help/index", {
      title: help?.page?.title || "Centrum Pomocy — CEEA Panel",
      company,
      page: help?.page,
      categories,
      lastUpdated: new Date().toISOString(),
    });
  } catch (err) {
    console.error("⚠️ /pomoc error:", err.message);
    res.status(500).render("error", { message: "Błąd ładowania centrum pomocy" });
  }
});

// ===== POLITYKA PRYWATNOŚCI =====
router.get("/polityka-prywatnosci", async (req, res) => {
  try {
    const [company, privacyPage] = await Promise.all([fetchCompany() /*, fetchPrivacyPage() */]);
    res.render("privacy/index", {
      title: privacyPage?.title || "Polityka Prywatności — CEEA Panel",
      company,
      page: privacyPage,
      lastUpdated: privacyPage?.lastUpdated || new Date().toISOString(),
    });
  } catch (err) {
    console.error("Błąd ładowania polityki prywatności:", err);
    res.status(500).render("error", { message: "Błąd ładowania polityki prywatności" });
  }
});

// ===== REGULAMIN =====
router.get("/regulamin", async (req, res) => {
  try {
    const [company, termsPage] = await Promise.all([fetchCompany() /*, fetchTermsPage() */]);
    res.render("terms/index", {
      title: termsPage?.title || "Regulamin — CEEA Panel",
      company,
      page: termsPage,
      lastUpdated: termsPage?.lastUpdated || new Date().toISOString(),
    });
  } catch (err) {
    console.error("Błąd ładowania regulaminu:", err);
    res.status(500).render("error", { message: "Błąd ładowania regulaminu" });
  }
});


// TYMCZASOWE 

router.post("/login/sprawdz", async (req, res) => {
  const email = (req.body.email || "").toLowerCase().trim();
  if (!email) return res.status(400).json({ status: "error" });
  if (email === "test@test.pl") return res.json({ status: "password" }); // pokazuje pole hasła
  return res.json({ status: "sent" }); // każdy inny → animacja "wysłano"
});

router.post("/login", async (req, res) => {
  if (req.body.password === "123456") {
    req.session.user = { email: (req.body.email || "").toLowerCase().trim() }; // ← sesja
    return res.json({ ok: true, redirect: "/kursy" });
  }
  return res.json({ ok: false, error: "Nieprawidłowe hasło. Spróbuj ponownie." });
});

module.exports = router;