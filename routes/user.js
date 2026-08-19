const express = require("express");
const router = express.Router();
const MarkdownIt = require("markdown-it");
const supabase = require("../config/supabase");
const { userOnly, requireAuth } = require("../middleware/auth");
const { fetchCompany, fetchHelpPage, fetchActiveCourse } = require("../config/datocms");
const { ICONS } = require("../config/icons");
const { fetchAllCourses } = require("../config/datocms");
const { getYearFromDate } = require("../utils/getYearFromDate");

const rateLimit = require("express-rate-limit");
const { sendPasswordEmail } = require("../services/mailer");
const { generatePassword, hashPassword, verifyPassword } = require("../services/passwords");


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

const emailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { status: "error", error: "Za dużo prób. Spróbuj za 15 minut." },
  standardHeaders: true,
});

const passwordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { ok: false, error: "Za dużo prób. Spróbuj za 15 minut." },
  standardHeaders: true,
});

router.post("/login/sprawdz", userOnly, emailLimiter, async (req, res) => {
  const email = (req.body.email || "").toLowerCase().trim();
  const reset = req.body.reset === true;

  // Ta sama odpowiedź dla nieistniejących adresów — nie zdradzamy, kto jest w bazie
  const sent = () => res.json({ status: "sent" });

  if (!email) return sent();

  try {
    // 1. użytkownik
    const { data: user, error: userErr } = await supabase
      .from("users")
      .select("id, email, password_hash")
      .ilike("email", email)
      .maybeSingle();

    if (userErr) console.error("sprawdz/users:", userErr);
    if (!user) return sent();

    // 2. aktywny zapis na kurs
    const { data: enrollment, error: enrErr } = await supabase
      .from("enrollments")
      .select("id")
      .eq("user_id", user.id)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();

    if (enrErr) console.error("sprawdz/enrollments:", enrErr);
    if (!enrollment) return sent();

    // 3. ma już hasło i nie prosi o reset → widok hasła
    if (user.password_hash && !reset) {
      return res.json({ status: "password" });
    }

    // 4. pierwszy raz albo reset — nowe hasło
    const password = generatePassword();
    const password_hash = await hashPassword(password);

    const { error: updErr } = await supabase
      .from("users")
      .update({ password_hash })
      .eq("id", user.id);

    if (updErr) {
      console.error("sprawdz/update:", updErr);
      return sent();
    }

    try {
      await sendPasswordEmail(user.email, password);
    } catch (mailErr) {
      console.error("MailerSend:", mailErr.message);
    }

    return sent();
  } catch (err) {
    console.error("sprawdz:", err);
    return sent();
  }
});

router.post("/login", userOnly, passwordLimiter, async (req, res) => {
  const email = (req.body.email || "").toLowerCase().trim();
  const password = String(req.body.password || "");

  const fail = () =>
    res.status(401).json({ ok: false, error: "Nieprawidłowy email lub hasło." });

  try {
    const { data: user, error } = await supabase
      .from("users")
      .select("id, email, password_hash")
      .ilike("email", email)
      .maybeSingle();

    if (error) console.error("login/users:", error);
    if (!user?.password_hash) return fail();

    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) return fail();

    req.session.user = { id: user.id, email: user.email };
    res.json({ ok: true, redirect: "/kursy" });
  } catch (err) {
    console.error("login:", err);
    res.status(500).json({ ok: false, error: "Błąd serwera. Spróbuj ponownie." });
  }
});

// ===== PANEL UCZESTNIKA =====
router.get("/kursy", userOnly, requireAuth, async (req, res) => {
  try {
    // 1. użytkownik po emailu z sesji
    const { data: user } = await supabase
      .from("users").select("id, name, email")
      .eq("email", req.session.user.email).maybeSingle();

    console.log("[/kursy] session email:", req.session.user.email);
    console.log("[/kursy] user z bazy:", user);

    // 2. jego dostępy
    const { data: enrollments } = user
      ? await supabase
          .from("enrollments").select("course_id")
          .eq("user_id", user.id).eq("status", "active")
      : { data: [] };

    console.log("[/kursy] enrollments:", enrollments);

    const ids = (enrollments || []).map((e) => e.course_id);

    const [datoCourses, { data: materials }] = await Promise.all([
      fetchAllCourses(),
      ids.length
        ? supabase.from("materials").select("*").in("course_id", ids).order("order_num")
        : Promise.resolve({ data: [] }),
    ]);

    console.log("[/kursy] ids z Supabase:", ids);
    console.log("[/kursy] ids z DatoCMS:", datoCourses.map((c) => ({ id: c.id, available: c.available })));

    const myCourses = datoCourses
      .filter((c) => ids.includes(c.id))
      .map((c) => ({
        ...c,
        year: getYearFromDate(c.date),
        materials: (materials || []).filter((m) => m.course_id === c.id),
      }));

    console.log("[/kursy] myCourses:", myCourses.length);

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

// router.post("/login/sprawdz", async (req, res) => {
//   const email = (req.body.email || "").toLowerCase().trim();
//   if (!email) return res.status(400).json({ status: "error" });
//   if (email === "test@test.pl") return res.json({ status: "password" }); // pokazuje pole hasła
//   return res.json({ status: "sent" }); // każdy inny → animacja "wysłano"
// });

// router.post("/login", async (req, res) => {
//   if (req.body.password === "123456") {
//     req.session.user = { email: (req.body.email || "").toLowerCase().trim() }; // ← sesja
//     return res.json({ ok: true, redirect: "/kursy" });
//   }
//   return res.json({ ok: false, error: "Nieprawidłowe hasło. Spróbuj ponownie." });
// });

module.exports = router;