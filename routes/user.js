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

router.post("/login", userOnly, async (req, res) => {
  const { email } = req.body;
  try {
    const { data: enrollments, error: enrollmentsError } = await supabase
      .from("enrollments").select("id").eq("email", email).eq("status", "active").limit(1);

    if (enrollmentsError) console.error("Błąd sprawdzania zapisu:", enrollmentsError);

    if (!enrollments?.length) {
      return res.render("login", { error: "Ten email nie jest zapisany na kurs.", message: null });
    }

    const { error } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo: "https://panel.ceea.org.pl/auth/callback" },
    });

    if (error) {
      console.error("Błąd wysyłania magic link:", error);
      return res.render("login", { error: "Błąd wysyłania. Spróbuj ponownie.", message: null });
    }

    res.render("login", { error: null, message: "Sprawdź email z linkiem logowania!" });
  } catch (err) {
    console.error("Błąd serwera (login):", err);
    res.render("login", { error: "Wystąpił błąd serwera. Spróbuj ponownie.", message: null });
  }
});

router.get("/auth/callback", userOnly, async (req, res) => {
  const { token_hash } = req.query;

  if (!token_hash) {
    return res.render("login", { error: "Brak tokenu w linku.", message: null });
  }

  try {
    const { data, error } = await supabase.auth.verifyOtp({ token_hash, type: "magiclink" });

    if (error) {
      console.error("Błąd weryfikacji OTP:", error);
      return res.render("login", { error: "Link wygasł lub jest nieprawidłowy.", message: null });
    }

    req.session.user = { id: data.user.id, email: data.user.email };
    res.redirect("/kursy");
  } catch (err) {
    console.error("Błąd serwera (callback):", err);
    res.render("login", { error: "Wystąpił błąd serwera.", message: null });
  }
});

// ===== PANEL UCZESTNIKA =====
router.get("/kursy", userOnly, requireAuth, async (req, res) => {
    try {
      const { data: enrollments } = await supabase
        .from("enrollments").select("course_id")
        .eq("email", req.session.user.email).eq("status", "active");
  
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

module.exports = router;