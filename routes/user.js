const express = require("express");
const router = express.Router();
const MarkdownIt = require("markdown-it");
const supabase = require("../config/supabase");
const { userOnly, requireAuth } = require("../middleware/auth");
const { ICONS } = require("../config/user-icons");
const { getYearFromDate } = require("../utils/getYearFromDate");
const { resolveIcon } = require("../config/user-icons");


const rateLimit = require("express-rate-limit");
const { sendPasswordEmail, sendPasswordResetEmail } = require("../services/mailer");
const { generatePassword, hashPassword, verifyPassword } = require("../services/passwords");
const crypto = require("crypto");

// ── Reset hasła jednorazowym linkiem (audyt #7) ──
// W bazie trzymamy wyłącznie hash SHA-256 tokenu; link ważny 1 h.
const RESET_TOKEN_TTL = 60 * 60 * 1000;
const hashResetToken = (t) =>
  crypto.createHash("sha256").update(String(t)).digest("hex");

async function findUserByResetToken(email, token) {
  if (!email || !token) return null;
  const { data: user, error } = await supabase
    .from("users")
    .select("id, email, name, reset_token_hash, reset_token_expires")
    .ilike("email", String(email).toLowerCase().trim())
    .maybeSingle();
  if (error || !user?.reset_token_hash || !user.reset_token_expires) return null;
  if (new Date(user.reset_token_expires).getTime() <= Date.now()) return null;
  const given = Buffer.from(hashResetToken(token), "utf8");
  const stored = Buffer.from(user.reset_token_hash, "utf8");
  if (given.length !== stored.length || !crypto.timingSafeEqual(given, stored))
    return null;
  return user;
}
let inpost = null;
try { inpost = require("../services/inpost"); } catch { /* moduł opcjonalny */ }

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

const fmtDatePL = (v) => {
  if (!v) return "";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "" : fmtDayPL(d);
};

const fmtPLN = (v) => {
  const n = Number(v);
  if (Number.isNaN(n)) return "";
  return n.toFixed(2).replace(".", ",") + " zł";
};

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

// ═══════════════════════════════════════════════════════════════
// ── Zamówienia książek (tabela book_orders) ──
// ═══════════════════════════════════════════════════════════════
// Słowniki zgodne z realnymi wartościami w bazie:
//   status: awaiting_transfer, paid
//   delivery_method: paczkomat, courier
// Status przesyłki (inpost_status) przychodzi z InPost ShipX.

const ORDER_STATUS_PL = {
  awaiting_transfer: { label: "Oczekuje na płatność", tone: "amber" },
  paid: { label: "Opłacone", tone: "blue" },
  shipped: { label: "Wysłane", tone: "green" },
  canceled: { label: "Anulowane", tone: "gray" },
};

const DELIVERY_PL = {
  paczkomat: "Paczkomat InPost",
  courier: "Kurier InPost",
};

// Statusy ShipX → polski (nieznany status wyświetli się surowy)
const INPOST_PL = {
  created: "Przesyłka utworzona",
  confirmed: "Przesyłka potwierdzona",
  dispatched_by_sender: "Nadana przez nadawcę",
  collected_from_sender: "Odebrana od nadawcy",
  taken_by_courier: "Przejęta przez kuriera",
  adopted_at_source_branch: "W sortowni nadawczej",
  sent_from_source_branch: "Wysłana z sortowni",
  adopted_at_target_branch: "W sortowni docelowej",
  out_for_delivery: "W doręczeniu",
  ready_to_pickup: "Gotowa do odbioru",
  pickup_time_expired: "Upłynął czas odbioru",
  avizo: "Awizo — ponowna próba doręczenia",
  delivered: "Doręczona",
  returned_to_sender: "Zwrot do nadawcy",
  canceled: "Anulowana",
};
const INPOST_FINAL = ["delivered", "canceled", "returned_to_sender"];

// Timeline zamówienia: done / current / todo
function orderSteps(o) {
  const paid = o.status === "paid" || o.status === "shipped";
  // Wysłane = dopiero po akcji „Wysłane" w panelu admina (status/shipped_at).
  // Sam tracking_number pojawia się już przy utworzeniu przesyłki — za wcześnie.
  const shipped = o.status === "shipped" || !!o.shipped_at;
  const delivered = o.inpost_status === "delivered";
  const lastLabel = o.delivery_method === "paczkomat" ? "Do odbioru" : "Doręczenie";
  return [
    { label: "Złożone", at: o.created_at, state: "done" },
    { label: "Opłacone", state: paid ? "done" : "current" },
    { label: "Wysłane", at: o.shipped_at, state: delivered || shipped ? "done" : paid ? "current" : "todo" },
    { label: lastLabel, state: delivered ? "done" : shipped ? "current" : "todo" },
  ];
}

function mapBookOrder(o) {
  const items = Array.isArray(o.items) ? o.items : [];
  const st = ORDER_STATUS_PL[o.status] || { label: o.status || "—", tone: "gray" };
  return {
    ...o,
    items,
    itemsCount: items.reduce((sum, it) => sum + (Number(it.qty) || 1), 0),
    createdLabel: fmtDatePL(o.created_at),
    shippedLabel: fmtDatePL(o.shipped_at),
    amountLabel: fmtPLN(o.amount),
    statusLabel: st.label,
    statusTone: st.tone,
    deliveryLabel: DELIVERY_PL[o.delivery_method] || o.delivery_method || "—",
    addressLine: [o.street, [o.postcode, o.city].filter(Boolean).join(" ")].filter(Boolean).join(", "),
    inpostLabel: o.inpost_status ? (INPOST_PL[o.inpost_status] || o.inpost_status) : null,
    inpostFinal: INPOST_FINAL.includes(o.inpost_status),
    trackingUrl: o.tracking_number
      ? `https://inpost.pl/sledzenie-przesylek?number=${encodeURIComponent(o.tracking_number)}`
      : null,
    resumeUrl: o.resume_url || null,        // link dokończenia płatności (tpay)
    wantInvoice: !!o.want_invoice,          // faktura VAT z checkoutu
    _steps: orderSteps(o),
  };
}

// Okładki/autorzy pozycji — z tabeli products.
// Dopasowanie 1) po productId z items jsonb, 2) fallback po znormalizowanym
// tytule (na wypadek gdyby productId wskazywał np. datocms_id albo go brakło).
// Katalog książek jest mały, więc pobieramy go w całości (1 zapytanie).
// Błąd zapytania nigdy nie psuje strony — pozycje zostają bez miniaturek.
const _normTitle = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();

async function fetchProductsMap() {
  const empty = { byId: new Map(), byName: new Map() };
  const { data, error } = await supabase
    .from("products")
    .select("id, name, author, image_url")
    .limit(500);
  if (error) {
    console.error("user/ksiazki products:", error.message);
    return empty;
  }
  const byId = new Map();
  const byName = new Map();
  (data || []).forEach((p) => {
    byId.set(String(p.id), p);
    const n = _normTitle(p.name);
    if (n && !byName.has(n)) byName.set(n, p);
  });
  return { byId, byName };
}

// Odśwież status przesyłki z InPost — tylko gdy:
//  • zamówienie ma zapisane inpost_shipment_id (kolumna z SQL z paczki),
//  • status nie jest końcowy,
//  • ostatnie odświeżenie starsze niż 15 minut (cache w samej tabeli).
// Błąd API nigdy nie psuje strony — zostaje ostatni znany status.
async function refreshInPostStatus(o) {
  if (!inpost || !o.inpost_shipment_id) return;
  if (INPOST_FINAL.includes(o.inpost_status)) return;
  if (o.inpost_status_at && Date.now() - new Date(o.inpost_status_at).getTime() < 15 * 60 * 1000) return;
  try {
    const s = await inpost.getShipment(o.inpost_shipment_id);
    const patch = { inpost_status: s.status, inpost_status_at: new Date().toISOString() };
    if (s.tracking_number && !o.tracking_number) patch.tracking_number = s.tracking_number;
    await supabase.from("book_orders").update(patch).eq("id", o.id);
    Object.assign(o, patch);
  } catch (e) {
    console.error("inpost/status:", e.message);
  }
}

async function fetchBookOrders(email) {
  const { data, error } = await supabase
    .from("book_orders")
    .select("*")
    .ilike("email", String(email || "").trim())
    .order("created_at", { ascending: false });
  if (error) {
    console.error("user/ksiazki:", error.message);
    return [];
  }
  const orders = data || [];
  for (const o of orders) await refreshInPostStatus(o); // sekwencyjnie — zwykle 0–2 zamówienia
  const products = await fetchProductsMap();
  return orders.map((o) => {
    // wzbogać pozycje o okładkę/autora (image z checkoutu ma pierwszeństwo)
    const items = (Array.isArray(o.items) ? o.items : []).map((it) => {
      const p =
        products.byId.get(String(it && it.productId ? it.productId : "")) ||
        products.byName.get(_normTitle(it && (it.title || it.name)));
      return {
        ...it,
        image: it.image || (p && p.image_url) || null,
        author: it.author || (p && p.author) || null,
      };
    });
    return mapBookOrder({ ...o, items });
  });
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
      .select("id, email, name, password_hash")
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

    // Pierwszy raz albo reset — jednorazowy LINK do ustawienia hasła (audyt #7).
    // Dotychczas każdy znający adres e-mail mógł wymusić wygenerowanie nowego
    // hasła (mail-bombing + utrata dostępu). Teraz hasło zmieni się dopiero
    // po kliknięciu linku i ustawieniu nowego hasła przez właściciela skrzynki.
    const resetToken = crypto.randomBytes(32).toString("hex");

    const { error: updErr } = await supabase
      .from("users")
      .update({
        reset_token_hash: hashResetToken(resetToken),
        reset_token_expires: new Date(Date.now() + RESET_TOKEN_TTL).toISOString(),
      })
      .eq("id", user.id);

    if (updErr) {
      console.error("sprawdz/update:", updErr);
      return sent();
    }

    const resetLink = `${req.protocol}://${req.get("host")}/reset-hasla?token=${resetToken}&email=${encodeURIComponent(user.email)}`;
    try {
      await sendPasswordResetEmail(user.email, { resetLink, firstName: user.name });
    } catch (mailErr) {
      console.error("mail/reset:", mailErr.message);
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

// ===== KSIĄŻKI (zamówienia uczestnika) =====
router.get("/ksiazki", userOnly, requireAuth, async (req, res) => {
  try {
    const orders = await fetchBookOrders(req.session.user.email);
    res.render("user-ksiazki", {
      title: "Książki — CEEA",
      user: req.session.user,
      orders,
      shopUrl: `${MAIN_SITE_URL}/ksiazki`,
    });
  } catch (err) {
    console.error("Błąd serwera (ksiazki):", err);
    res.render("user-ksiazki", {
      title: "Książki — CEEA",
      user: req.session.user,
      orders: [],
      shopUrl: `${MAIN_SITE_URL}/ksiazki`,
    });
  }
});

// ===== PROFIL =====
router.get("/profil", userOnly, requireAuth, (req, res) => {
  res.render("user-profil", {
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
  res.render("user-ustawienia", {
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

// ===== USTAWIANIE HASŁA Z LINKU (audyt #7) =====
router.get("/reset-hasla", userOnly, async (req, res) => {
  const { token, email } = req.query;
  const user = await findUserByResetToken(email, token);
  res.render("reset-hasla", {
    title: "Ustaw nowe hasło — CEEA",
    valid: !!user,
    success: false,
    token: user ? String(token) : "",
    email: user ? String(email) : "",
    error: null,
  });
});

router.post("/reset-hasla", userOnly, passwordLimiter, async (req, res) => {
  const { token, email } = req.body;
  const password = String(req.body.password || "");

  const invalid = () =>
    res.status(400).render("reset-hasla", {
      title: "Ustaw nowe hasło — CEEA",
      valid: false,
      success: false,
      token: "",
      email: "",
      error: null,
    });

  const user = await findUserByResetToken(email, token);
  if (!user) return invalid();

  if (password.length < 8) {
    return res.status(400).render("reset-hasla", {
      title: "Ustaw nowe hasło — CEEA",
      valid: true,
      success: false,
      token: String(token || ""),
      email: String(email || ""),
      error: "Hasło musi mieć co najmniej 8 znaków.",
    });
  }

  const password_hash = await hashPassword(password);
  const { error: updErr } = await supabase
    .from("users")
    .update({
      password_hash,
      reset_token_hash: null, // token jednorazowy — kasujemy po użyciu
      reset_token_expires: null,
    })
    .eq("id", user.id);

  if (updErr) {
    console.error("reset-hasla/update:", updErr);
    return invalid();
  }

  // Unieważnij dotychczasowe sesje tego uczestnika (gdyby ktoś był zalogowany)
  try {
    await supabase
      .from("app_sessions")
      .delete()
      .filter("sess->user->>id", "eq", user.id);
  } catch (e) {
    console.error("reset-hasla/sessions:", e.message);
  }

  res.render("reset-hasla", {
    title: "Hasło zmienione — CEEA",
    valid: false,
    success: true,
    token: "",
    email: "",
    error: null,
  });
});

// ===== WYLOGOWANIE =====
// GET nie zmienia stanu (audyt #10). Właściwe wylogowanie tylko przez POST.
router.get("/wyloguj", userOnly, (req, res) => {
  res.redirect(req.session.user ? "/kursy" : "/");
});

router.post("/wyloguj", userOnly, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.redirect("/");
  });
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