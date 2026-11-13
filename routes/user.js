const express = require("express");
const router = express.Router();
const MarkdownIt = require("markdown-it");
const supabase = require("../config/supabase");
const { userOnly, requireAuth } = require("../middleware/auth");
const { resolveIcon } = require("../config/user-icons");
const { getYearFromDate } = require("../utils/getYearFromDate");
const { wrapIcon } = require("../config/user-icons");
const rateLimit = require("express-rate-limit");
const { sendPasswordEmail } = require("../services/mailer");
const { generatePassword, hashPassword, verifyPassword } = require("../services/passwords");
const md = new MarkdownIt({ html: false, linkify: true, breaks: true });
const MAIN_SITE_URL = "https://ceea.org.pl";
const CALLOUT_ICONS = { info: "ℹ️", warning: "⚠️", danger: "🚨" };

function renderAnswer(q) {
  const answerHtml = md.render(q.answer || "");
  const c = q.callout;
  if (!c) return answerHtml;
  const icon = CALLOUT_ICONS[c.kind] || CALLOUT_ICONS.info;
  const html = md.renderInline(c.content || "");
  return answerHtml + `<div class="callout callout-${c.kind}"><span>${icon}</span><div>${html}</div></div>`;
}


// ═══════════════════════════════════════════════════════════════
// ── Dane po migracji z DatoCMS ──
// ═══════════════════════════════════════════════════════════════

const COMPANY = {
  nameCompany: "Europejska Fundacja ds. Szkolenia w Anestezjologii",
  street: "ul. Sokolnicka",
  numberHome: "56",
  zipCode: "62-021",
  city: "Paczkowo",
  nip: "777-314-61-00",
  krs: "0000347155",
  mail: process.env.ORG_EMAIL || "sekretariat@ceea.org.pl",
  openingHours: "pon.–pt. 8:00–16:00",
  name: "Europejska Fundacja ds. Szkolenia w Anestezjologii",
  shortName: "CEEA Poznań",
  address: "ul. Sokolnicka 56, 62-021 Paczkowo",
  regon: "301341024",
  email: process.env.ORG_EMAIL || "sekretariat@ceea.org.pl",
  phone: process.env.ORG_PHONE || "61 869 13 57",
  site: MAIN_SITE_URL,
};
// Dane firmy — z Supabase (tabela company_settings, pierwszy rekord).
// Mapowanie snake_case → historyczne nazwy pól używane przez widoki.
// Statyczny COMPANY zostaje jako awaryjny fallback (pusta tabela / błąd).
async function fetchCompany() {
  try {
    const { data, error } = await supabase
      .from("company_settings")
      .select("*")
      .order("id", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error("company_settings:", error.message);
      return COMPANY;
    }
    if (!data) return COMPANY;

    const streetLine = [data.street, data.number_home].filter(Boolean).join(" ");
    const cityLine = [data.zip_code, data.city].filter(Boolean).join(" ");
    return {
      ...COMPANY,
      // ── pola używane przez widoki (nazwy historyczne) ← kolumny z bazy ──
      nameCompany: data.name_company || COMPANY.nameCompany,
      street: data.street || COMPANY.street,
      numberHome: data.number_home || COMPANY.numberHome,
      zipCode: data.zip_code || COMPANY.zipCode,
      city: data.city || COMPANY.city,
      nip: data.nip || COMPANY.nip,
      krs: data.krs || COMPANY.krs,
      mail: data.email || COMPANY.mail,
      openingHours: data.opening_hours || COMPANY.openingHours,
      // ── aliasy / dodatkowe ──
      name: data.name_company || COMPANY.name,
      email: data.email || COMPANY.email,
      regon: data.regon || "",
      description: data.description || "",
      bankAccountName: data.bank_account_name || "",
      bankAccount: data.bank_account || "",
      facebook: data.facebook || "",
      youtube: data.youtube || "",
      address: [streetLine, cityLine].filter(Boolean).join(", ") || COMPANY.address,
    };
  } catch (err) {
    console.error("company_settings:", err.message);
    return COMPANY;
  }
}

// Kursy z Supabase. Mapowanie zachowuje pola używane przez widoki:
// id (= course_id, do enrollments/payments), date (= start_date, do getYearFromDate),
// nameCourse (= title, historyczna nazwa z DatoCMS — widoki jej używają),
// dateLabel (polski zakres dat do wyświetlenia),
// available (fallback z is_active), slug — jeśli kolumna istnieje w tabeli.
const MONTHS_PL = [
  "stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca",
  "lipca", "sierpnia", "września", "października", "listopada", "grudnia",
];
const fmtDayPL = (d) => `${d.getDate()} ${MONTHS_PL[d.getMonth()]} ${d.getFullYear()}`;

function formatDateRangePL(start, end) {
  if (!start) return "";
  const s = new Date(start);
  if (Number.isNaN(s.getTime())) return "";
  if (!end) return fmtDayPL(s);
  const e = new Date(end);
  if (Number.isNaN(e.getTime())) return fmtDayPL(s);
  if (s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth()) {
    return `${s.getDate()}–${e.getDate()} ${MONTHS_PL[s.getMonth()]} ${s.getFullYear()}`;
  }
  return `${fmtDayPL(s)} – ${fmtDayPL(e)}`;
}

function mapCourse(c) {
  return {
    available: c.is_active,
    ...c,
    id: c.course_id,
    nameCourse: c.title || "Kurs CEEA",
    date: c.start_date,
    dateLabel: formatDateRangePL(c.start_date, c.end_date),
  };
}

async function fetchAllCourses() {
  const { data, error } = await supabase
    .from("courses")
    .select("*")
    .order("start_date", { ascending: false });
  if (error) {
    console.error("user/kursy:", error.message);
    return [];
  }
  return (data || []).map(mapCourse);
}

async function fetchActiveCourse() {
  const { data, error } = await supabase
    .from("courses")
    .select("*")
    .eq("is_active", true)
    .order("start_date", { ascending: false })
    .limit(1);
  if (error) {
    console.error("user/aktywny kurs:", error.message);
    return null;
  }
  const c = (data || [])[0];
  if (!c) return null;
  return { ...mapCourse(c), year: getYearFromDate(c.start_date) };
}

// Strona pomocy (FAQ) — kategorie i pytania z Supabase
// (help_categories / help_questions, edytowalne w panelu — moduł „Pomoc").
// Zwraca strukturę zgodną z dawnym DatoCMS: { page, categories, questions },
// gdzie questions mają category.id oraz callout { kind, content }.
async function fetchHelpPage() {
  try {
    const [{ data: cats, error: cErr }, { data: qs, error: qErr }] =
      await Promise.all([
        supabase
          .from("help_categories")
          .select("*")
          .eq("is_published", true)
          .order("sort_order")
          .order("id"),
        supabase
          .from("help_questions")
          .select("*")
          .eq("is_published", true)
          .order("sort_order")
          .order("id"),
      ]);
    if (cErr) console.error("pomoc/kategorie:", cErr.message);
    if (qErr) console.error("pomoc/pytania:", qErr.message);
    if (!cats && !qs) return null;

    return {
      page: { title: "Centrum Pomocy — CEEA Panel" },
      categories: (cats || []).map((c) => ({
        id: c.id,
        slug: c.slug || String(c.id),
        title: c.title,
        description: c.description,
        icon: c.icon,
      })),
      questions: (qs || []).map((q) => ({
        question: q.question,
        answer: q.answer,
        callout: q.callout_kind
          ? { kind: q.callout_kind, content: q.callout_content || "" }
          : null,
        category: { id: q.category_id },
      })),
    };
  } catch (err) {
    console.error("pomoc:", err.message);
    return null;
  }
}

// Doładowanie profilu (name, surname, phone) do sesji — 1 lekkie zapytanie na request
router.use(async (req, res, next) => {
  if (!req.session?.user?.id) return next();
  try {
    const { data: profile } = await supabase
      .from("users")
      .select("name, surname, phone")
      .eq("id", req.session.user.id)
      .maybeSingle();

    if (
      profile &&
      (req.session.user.name !== profile.name ||
        req.session.user.surname !== profile.surname ||
        req.session.user.phone !== profile.phone)
    ) {
      Object.assign(req.session.user, profile);
    }
  } catch (err) {
    console.error("profil middleware:", err.message);
  }
  next();
});

// ===== LOGOWANIE =====
router.get("/", userOnly, async (req, res) => {
  if (req.session.user) return res.redirect("/kursy");
  const course = await fetchActiveCourse();
  res.render("login", {
    title: "Logowanie — CEEA",
    error: null,
    message: null,
    registrationUrl:
      course && course.slug
        ? `${MAIN_SITE_URL}/kursy/${course.year}/${course.slug}/rejestracja`
        : course
          ? `${MAIN_SITE_URL}/kursy`
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
    const { data: user, error: userErr } = await supabase
      .from("users")
      .select("id, email, password_hash")
      .ilike("email", email)
      .maybeSingle();

    if (userErr) console.error("sprawdz/users:", userErr);
    if (!user) return sent();

       // Dostęp = OPŁACONA płatność (nowy model; enrollments = stary kurs)
       const { data: paidPayment, error: payErr } = await supabase
       .from("payments")
       .select("id")
       .eq("user_id", user.id)
       .eq("status", "paid")
       .limit(1)
       .maybeSingle();
 
     if (payErr) console.error("sprawdz/payments:", payErr);
     if (!paidPayment) return sent();

    // ma już hasło i nie prosi o reset → widok hasła
    if (user.password_hash && !reset) {
      return res.json({ status: "password" });
    }

    // pierwszy raz albo reset — nowe hasło
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
      .select("id, email, name, surname, phone, password_hash")
      .ilike("email", email)
      .maybeSingle();

    if (error) console.error("login/users:", error);
    if (!user?.password_hash) return fail();

    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) return fail();

    req.session.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      surname: user.surname,
      phone: user.phone,
    };
    res.json({ ok: true, redirect: "/kursy" });
  } catch (err) {
    console.error("login:", err);
    res.status(500).json({ ok: false, error: "Błąd serwera. Spróbuj ponownie." });
  }
});

// ===== PANEL UCZESTNIKA =====
router.get("/kursy", userOnly, requireAuth, async (req, res) => {
  try {
    const { data: user } = await supabase
      .from("users").select("id, name, email")
      .eq("email", req.session.user.email).maybeSingle();

      const { data: enrollments } = user
      ? await supabase
          .from("enrollments").select("course_id")
          .eq("user_id", user.id).eq("status", "active")
      : { data: [] };

    const { data: paidPayments } = user
      ? await supabase
          .from("payments").select("course_id")
          .eq("user_id", user.id).eq("status", "paid")
      : { data: [] };

    const ids = [...new Set([
      ...(enrollments || []).map((e) => e.course_id),
      ...(paidPayments || []).map((p) => p.course_id),
    ])];

    const [datoCourses, { data: materials }] = await Promise.all([
      fetchAllCourses(),
      ids.length
        ? supabase.from("materials").select("*").in("course_id", ids).order("order_num")
        : Promise.resolve({ data: [] }),
    ]);

    const myCourses = datoCourses
      .filter((c) => ids.includes(c.id))
      .map((c) => ({
        ...c,
        year: getYearFromDate(c.date),
        materials: (materials || []).filter((m) => m.course_id === c.id),
      }));

    res.render("user-dashboard", {
      title: "Moje kursy — CEEA",
      user: req.session.user,
      active: myCourses.filter((c) => c.available),
      archive: myCourses.filter((c) => !c.available),
    });
  } catch (err) {
    console.error("Błąd serwera (dashboard):", err);
    res.render("user-dashboard", { title: "Moje kursy — CEEA", user: req.session.user, active: [], archive: [] });
  }
});

// ===== PROFIL =====
router.get("/profil", userOnly, requireAuth, (req, res) => {
  res.render("profil", {
    title: "Profil — CEEA",
    user: req.session.user,
    sent: req.query.sent === "1",
  });
});

router.post("/profil/reset-hasla", userOnly, requireAuth, passwordLimiter, async (req, res) => {
  try {
    const { data: user } = await supabase
      .from("users").select("id, email").eq("id", req.session.user.id).maybeSingle();
    if (user) {
      const password = generatePassword();
      const hash = await hashPassword(password);
      await supabase.from("users").update({ password_hash: hash }).eq("id", user.id);
      await sendPasswordEmail(user.email, password);
    }
  } catch (err) {
    console.error("reset hasła:", err);
  }
  res.redirect("/profil?sent=1");
});

// ===== USTAWIENIA =====
router.get("/ustawienia", userOnly, requireAuth, async (req, res) => {
  const { data: prefs } = await supabase
    .from("users").select("notify_materials").eq("id", req.session.user.id).maybeSingle();
  res.render("ustawienia", {
    title: "Ustawienia — CEEA",
    user: { ...req.session.user, ...prefs },
  });
});

router.post("/ustawienia/powiadomienia", userOnly, requireAuth, async (req, res) => {
  await supabase
    .from("users")
    .update({ notify_materials: req.body.notify === "1" })
    .eq("id", req.session.user.id);
  res.redirect("/ustawienia");
});

// Eksport danych (RODO)
router.get("/ustawienia/eksport", userOnly, requireAuth, async (req, res) => {
  const [{ data: user }, { data: enrollments }, { data: payments }] = await Promise.all([
    supabase.from("users").select("email, name, surname, phone, created_at").eq("id", req.session.user.id).maybeSingle(),
    supabase.from("enrollments").select("course_id, status, created_at").eq("user_id", req.session.user.id),
    supabase.from("payments").select("order_number, course_id, amount, currency, status, paid_at").eq("user_id", req.session.user.id),
  ]);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="moje-dane-ceea.json"');
  res.send(JSON.stringify({ user, enrollments, payments }, null, 2));
});

router.get("/wyloguj", userOnly, (req, res) => {
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
      icon: resolveIcon(cat.icon),
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

// publiczny licznik odwiedzin strony (beacon z ceea.org.pl)
router.post("/api/track", express.text({ type: "*/*", limit: "2kb" }), async (req, res) => {
  res.set("Access-Control-Allow-Origin", "https://ceea.org.pl");
  try {
    const payload = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const path = String(payload.path || "").slice(0, 200);
    if (path.startsWith("/")) {
      const referrer = payload.referrer ? String(payload.referrer).slice(0, 300) : null;
      await supabase.from("page_views").insert([{ path, referrer }]);
    }
  } catch (err) {
    console.error("track:", err.message);
  }
  res.status(204).end();
});

module.exports = router;